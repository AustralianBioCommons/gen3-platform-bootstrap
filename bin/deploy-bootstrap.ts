#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { loadAppConfig, resolveStageConfig } from "../lib/config/loader";
import { InfraStack } from "../lib/stacks/infra-stack";
import { Gen3IamStack } from "../lib/stacks/gen3-iam-stack";
import { ReplicationStack } from "../lib/stacks/replication-stack";
import { bucketSafeFromHostname } from "../lib/utils/names";

const app = new cdk.App();

const configPath = app.node.tryGetContext("config");
if (!configPath) {
  throw new Error("Missing CDK context key: config. Pass with -c config=./path/to/bootstrap.json");
}

const config = loadAppConfig(configPath);

cdk.Tags.of(app).add("Project", config.project);
cdk.Tags.of(app).add("Application", config.application);
if (config.owner) cdk.Tags.of(app).add("Owner", config.owner);
for (const [k, v] of Object.entries(config.tags ?? {})) {
  cdk.Tags.of(app).add(k, v);
}

for (const stageConfig of config.stages) {
  const resolved = resolveStageConfig(config, stageConfig);
  const { envTarget, bootstrap } = resolved;

  const stackEnv = {
    account: envTarget.account,
    region: envTarget.region,
  };

  const stackProps = {
    env: stackEnv,
    project: config.project,
    application: config.application,
    namePrefix: config.naming.namePrefix,
    ssmPrefix: config.naming.ssmPrefix,
    secretPrefix: config.naming.secretPrefix,
    envTarget,
    bootstrap,
  };

  const infra = new InfraStack(app, `${stageConfig.id}Infra`, stackProps);

  const iamStack = new Gen3IamStack(app, `${stageConfig.id}Iam`, stackProps);
  iamStack.addDependency(infra);

  cdk.Tags.of(infra).add("Environment", envTarget.name);
  cdk.Tags.of(iamStack).add("Environment", envTarget.name);

  if (bootstrap.replication.enabled) {
    const safeHost = bucketSafeFromHostname(bootstrap.hostname);
    const { replication } = bootstrap;

    const repl = new ReplicationStack(app, `${stageConfig.id}Replication`, {
      env: stackEnv,
      backupAccountId: replication.backupAccountId,
      replicationRoleArn: cdk.Fn.importValue(`${infra.stackName}-ReplicationRoleArn`),
      rules: [
        {
          sourceBucket: infra.uploadsBucket,
          destBucketArn: replication.destUploadsBucketArn,
          destKmsKeyArn: replication.destUploadsKmsKeyArn,
          id: `uploads-${safeHost}-to-backup`,
          prefix: "",
        },
        {
          sourceBucket: infra.manifestBucket,
          destBucketArn: replication.destManifestBucketArn,
          destKmsKeyArn: replication.destManifestKmsKeyArn,
          id: `manifest-${safeHost}-to-backup`,
          prefix: "",
        },
        {
          sourceBucket: infra.pelicanBucket,
          destBucketArn: replication.destPelicanBucketArn,
          destKmsKeyArn: replication.destPelicanKmsKeyArn,
          id: `pelican-${safeHost}-to-backup`,
          prefix: "",
        },
      ],
    });
    repl.addDependency(infra);
    cdk.Tags.of(repl).add("Environment", envTarget.name);
  }
}
