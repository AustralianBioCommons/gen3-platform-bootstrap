import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { readRequired, readOptional, slug } from "../utils/ssm";
import { bucketSafeFromHostname } from "../utils/names";
import { BootstrapStackProps } from "../types";

export class Gen3IamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);

    const project = slug(props.project);
    const envName = slug(props.envTarget.name);
    const { hostname, namespace } = props.bootstrap;

    if (!hostname) throw new Error("Gen3IamStack: bootstrap.hostname is required");
    if (!namespace) throw new Error("Gen3IamStack: bootstrap.namespace is required");

    const base = `/gen3/${project}-${envName}`;

    // ---- Core SSM (required at synth time via lookup)
    const issuer = readRequired(this, `${base}/oidcIssuer`);
    const providerArn = readRequired(this, `${base}/oidcProviderArn`);
    const clusterName = readRequired(this, `${base}/clusterName`);

    // ---- Optional SSM
    const uploadsBucketName = readOptional(this, `${base}/s3/uploadsBucketName`);
    const manifestBucketName = readOptional(this, `${base}/s3/manifestBucketName`);
    const sqsQueueArn = readOptional(this, `${base}/sqs/ssjdispatcherQueueArn`);
    const esDomainArn = readOptional(this, `${base}/opensearch/domainArn`);
    const uploadsKmsKeyArn = readOptional(this, `${base}/kms/uploadsKeyArn`);
    const manifestKmsKeyArn = readOptional(this, `${base}/kms/manifestKeyArn`);

    // ---- Helpers
    const roleName = (svc: string) => `gen3-${project}-${envName}-${slug(svc)}-role`;

    const makeIrsaPrincipal = (sa: string) => {
      const idSafe = slug(`${project}-${envName}-${namespace}-${sa}`);
      const stringEquals = new cdk.CfnJson(this, `IrsaCond-${idSafe}`, {
        value: {
          [`${issuer}:aud`]: "sts.amazonaws.com",
          [`${issuer}:sub`]: `system:serviceaccount:${namespace}:${sa}`,
        },
      });
      return new iam.FederatedPrincipal(
        providerArn,
        { StringEquals: stringEquals } as any,
        "sts:AssumeRoleWithWebIdentity"
      );
    };

    const tagRole = (role: iam.Role, sa: string) => {
      cdk.Tags.of(role).add("Project", project);
      cdk.Tags.of(role).add("Environment", envName);
      cdk.Tags.of(role).add("KubernetesNamespace", namespace);
      cdk.Tags.of(role).add("KubernetesServiceAccount", sa);
      cdk.Tags.of(role).add("ClusterName", clusterName);
    };

    const kmsViaS3Stmt = (
      actions: string[],
      kmsArn: string,
      bucketName: string
    ): iam.PolicyStatement =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions,
        resources: [kmsArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": `s3.${cdk.Stack.of(this).region}.amazonaws.com`,
          },
          StringLike: {
            "kms:EncryptionContext:aws:s3:arn": `arn:${cdk.Stack.of(this).partition}:s3:::${bucketName}/*`,
          },
        },
      });

    // ---- Managed policies
    const managed: Partial<
      Record<
        "S3UploadsRW" | "ManifestRW" | "SqsConsume" | "EsHttp" | "ExternalSecretsRead",
        iam.ManagedPolicy
      >
    > = {};

    managed.ExternalSecretsRead = new iam.ManagedPolicy(this, "Gen3ExternalSecretsRead", {
      managedPolicyName: `Gen3-${project}-${envName}-ExternalSecretsRead`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            "kms:Decrypt",
            "secretsmanager:DescribeSecret",
            "secretsmanager:GetResourcePolicy",
            "secretsmanager:GetSecretValue",
            "secretsmanager:ListSecretVersionIds",
            "secretsmanager:ListSecrets",
            "ssm:DescribeParameters",
            "ssm:GetParameter",
            "ssm:GetParameterHistory",
            "ssm:GetParameters",
            "ssm:GetParametersByPath",
          ],
          resources: ["*"],
        }),
      ],
    });

    if (uploadsBucketName) {
      managed.S3UploadsRW = new iam.ManagedPolicy(this, "Gen3S3UploadsRW", {
        managedPolicyName: `Gen3-${project}-${envName}-S3UploadsRW`,
        statements: [
          new iam.PolicyStatement({
            actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
            resources: [`arn:${cdk.Stack.of(this).partition}:s3:::${uploadsBucketName}/*`],
            conditions: { Bool: { "aws:SecureTransport": "true" } },
          }),
          new iam.PolicyStatement({
            actions: ["s3:ListBucket"],
            resources: [`arn:${cdk.Stack.of(this).partition}:s3:::${uploadsBucketName}`],
            conditions: { StringLike: { "s3:prefix": ["uploads/*", "processed/*"] } },
          }),
        ],
      });
    }

    if (manifestBucketName) {
      managed.ManifestRW = new iam.ManagedPolicy(this, "Gen3ManifestRW", {
        managedPolicyName: `Gen3-${project}-${envName}-ManifestRW`,
        statements: [
          new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:PutObject"],
            resources: [`arn:${cdk.Stack.of(this).partition}:s3:::${manifestBucketName}/*`],
            conditions: { Bool: { "aws:SecureTransport": "true" } },
          }),
          new iam.PolicyStatement({
            actions: ["s3:ListBucket"],
            resources: [`arn:${cdk.Stack.of(this).partition}:s3:::${manifestBucketName}`],
          }),
        ],
      });
    }

    if (sqsQueueArn) {
      managed.SqsConsume = new iam.ManagedPolicy(this, "Gen3SqsConsume", {
        managedPolicyName: `Gen3-${project}-${envName}-SqsConsume`,
        statements: [
          new iam.PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
              "sqs:ListQueueTags",
              "sqs:ListDeadLetterSourceQueues",
            ],
            resources: [sqsQueueArn],
          }),
        ],
      });
    }

    if (esDomainArn) {
      managed.EsHttp = new iam.ManagedPolicy(this, "Gen3EsHttpAccess", {
        managedPolicyName: `Gen3-${project}-${envName}-EsHttpAccess`,
        statements: [
          new iam.PolicyStatement({
            actions: [
              "es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost",
              "es:ESHttpPut", "es:ESHttpDelete", "es:ESHttpPatch",
            ],
            resources: [`${esDomainArn}/*`],
          }),
          new iam.PolicyStatement({
            actions: ["es:DescribeDomain", "es:DescribeDomains", "es:ListDomainNames"],
            resources: ["*"],
          }),
        ],
      });
    }

    // ---- Role factory
    const mk = (
      svc: string,
      sa: string,
      attach: (iam.IManagedPolicy | undefined)[],
      inline: iam.PolicyStatement[] = []
    ) => {
      const role = new iam.Role(this, `${slug(svc)}Role`, {
        roleName: roleName(svc),
        path: `/gen3/${project}/${envName}/`,
        assumedBy: makeIrsaPrincipal(sa),
        description: `IRSA for ${namespace}/${sa} (${project}-${envName})`,
      });
      attach.filter(Boolean).forEach((m) => role.addManagedPolicy(m!));
      inline.forEach((stmt) => role.addToPolicy(stmt));
      tagRole(role, sa);
      return role;
    };

    // ---- Roles
    if (managed.S3UploadsRW && uploadsBucketName) {
      const inline: iam.PolicyStatement[] = [];
      if (uploadsKmsKeyArn) {
        inline.push(
          kmsViaS3Stmt(
            ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
            uploadsKmsKeyArn,
            uploadsBucketName
          )
        );
      }
      const fenceRole = mk("fence", "fence-sa", [managed.S3UploadsRW], inline);
      const rolePath = `/gen3/${project}/${envName}/`;
      const selfArnLiteral = `arn:${cdk.Stack.of(this).partition}:iam::${this.account}:role${rolePath}${roleName("fence")}`;
      fenceRole.assumeRolePolicy!.addStatements(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(selfArnLiteral)],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    if (managed.SqsConsume && managed.S3UploadsRW && uploadsBucketName) {
      const ssjInline: iam.PolicyStatement[] = [];
      if (uploadsKmsKeyArn) {
        ssjInline.push(
          kmsViaS3Stmt(["kms:Decrypt", "kms:DescribeKey"], uploadsKmsKeyArn, uploadsBucketName)
        );
      }
      mk("ssjdispatcher", "ssjdispatcher-service-account", [managed.SqsConsume, managed.S3UploadsRW], ssjInline);
      mk("ssjdispatcher-job", "ssjdispatcher-job-sa", [managed.SqsConsume, managed.S3UploadsRW], ssjInline);
    }

    if (managed.ManifestRW && manifestBucketName) {
      const manifestInline: iam.PolicyStatement[] = [];
      if (manifestKmsKeyArn) {
        manifestInline.push(
          kmsViaS3Stmt(
            ["kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
            manifestKmsKeyArn,
            manifestBucketName
          )
        );
      }
      mk("manifest", "manifest-service", [managed.ManifestRW], manifestInline);
    }

    if (managed.EsHttp) {
      mk("aws-es-proxy", "aws-es-proxy-sa", [managed.EsHttp]);
    }

    const nfUser = bucketSafeFromHostname(hostname);
    const nfList = new iam.ManagedPolicy(this, "Gen3NfListAccessKeys", {
      managedPolicyName: `Gen3-${project}-${envName}-NfListAccessKeys`,
      statements: [
        new iam.PolicyStatement({
          actions: ["iam:ListAccessKeys"],
          resources: [
            `arn:${cdk.Stack.of(this).partition}:iam::${this.account}:user/${nfUser}-nf-*`,
          ],
        }),
      ],
    });
    mk("hatchery", "hatchery-service-account", [nfList]);
    mk("external-secrets", "external-secrets-sa", [managed.ExternalSecretsRead]);
  }
}
