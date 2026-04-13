import * as fs from "fs";
import * as path from "path";
import {
  AppConfig,
  BootstrapConfig,
  EnvironmentTarget,
  ResolvedBootstrapConfig,
  ResolvedReplicationConfig,
  ResolvedSecretsConfig,
  ResolvedStageConfig,
  StageConfig,
} from "../types";
import { validateConfig } from "./schema";

export function loadAppConfig(configPath: string): AppConfig {
  const absolutePath = path.resolve(configPath);
  const config = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as AppConfig;
  validateConfig(config);
  return config;
}

function resolveEnvironmentTarget(
  environments: Record<string, EnvironmentTarget>,
  envKey: string
): EnvironmentTarget {
  const resolved = environments[envKey];
  if (!resolved) throw new Error(`Unknown envKey: ${envKey}`);
  return resolved;
}

function resolveSecretsConfig(
  b: BootstrapConfig,
  project: string,
  envName: string
): ResolvedSecretsConfig {
  return {
    dbMasterSecretName:
      b.secrets?.dbMasterSecretName ?? `${project}-master-${envName}-rds`,
    wtsOidcClientId: b.secrets?.wtsOidcClientId,
    wtsOidcClientSecret: b.secrets?.wtsOidcClientSecret,
  };
}

function resolveReplicationConfig(
  b: BootstrapConfig,
  hostname: string
): ResolvedReplicationConfig {
  const r = b.replication;
  const enabled = r?.enabled ?? false;
  const safeHost = hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/\./g, "-")
    .slice(0, 63);

  return {
    enabled,
    backupAccountId: r?.backupAccountId ?? "111122223333",
    destUploadsKmsKeyArn:
      r?.destUploadsKmsKeyArn ??
      "arn:aws:kms:ap-southeast-2:111122223333:key/REPLACE-WITH-REAL-KEY-ID",
    destManifestKmsKeyArn:
      r?.destManifestKmsKeyArn ??
      "arn:aws:kms:ap-southeast-2:111122223333:key/REPLACE-WITH-REAL-KEY-ID",
    destPelicanKmsKeyArn:
      r?.destPelicanKmsKeyArn ??
      "arn:aws:kms:ap-southeast-2:111122223333:key/REPLACE-WITH-REAL-KEY-ID",
    destUploadsBucketArn:
      r?.destUploadsBucketArn ?? `arn:aws:s3:::backup-uploads-${safeHost}`,
    destManifestBucketArn:
      r?.destManifestBucketArn ?? `arn:aws:s3:::backup-manifest-${safeHost}`,
    destPelicanBucketArn:
      r?.destPelicanBucketArn ?? `arn:aws:s3:::backup-pelican-${safeHost}`,
  };
}

function resolveBootstrapConfig(
  b: BootstrapConfig,
  project: string,
  envName: string
): ResolvedBootstrapConfig {
  return {
    hostname: b.hostname,
    namespace: b.namespace,
    features: {
      metadataG3auto: b.features?.metadataG3auto ?? false,
      wtsG3auto: b.features?.wtsG3auto ?? false,
      pelicanserviceG3auto: b.features?.pelicanserviceG3auto ?? false,
      manifestserviceG3auto: b.features?.manifestserviceG3auto ?? false,
      auditGen3auto: b.features?.auditGen3auto ?? false,
      ssjdispatcherCreds: b.features?.ssjdispatcherCreds ?? false,
      fenceJwtPrivateKey: b.features?.fenceJwtPrivateKey ?? false,
    },
    secrets: resolveSecretsConfig(b, project, envName),
    replication: resolveReplicationConfig(b, b.hostname),
  };
}

export function resolveStageConfig(
  appConfig: AppConfig,
  stage: StageConfig
): ResolvedStageConfig {
  const envTarget = resolveEnvironmentTarget(
    appConfig.environments,
    stage.envKey
  );

  return {
    id: stage.id,
    stageName: stage.stageName,
    envTarget,
    bootstrap: resolveBootstrapConfig(
      stage.bootstrap,
      appConfig.project,
      envTarget.name
    ),
    requireManualApproval: stage.approvals?.requireManualApproval ?? false,
  };
}
