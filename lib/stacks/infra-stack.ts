import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Gen3Secrets } from "../constructs/gen3-secrets";
import { bucketSafeFromHostname } from "../utils/names";
import { BootstrapStackProps } from "../types";

export class InfraStack extends cdk.Stack {
  public readonly uploadsBucket: s3.Bucket;
  public readonly manifestBucket: s3.Bucket;
  public readonly pelicanBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);

    const { project, application } = props;
    const envName = props.envTarget.name;
    const { hostname, features, secrets, replication } = props.bootstrap;

    // --- KMS keys ---
    const uploadsKey = new kms.Key(this, "UploadsKmsKey", {
      alias: `alias/${project}-${envName}-uploads-s3`,
      enableKeyRotation: true,
      description: `KMS key for uploads bucket (${project}/${envName})`,
    });

    const manifestKey = new kms.Key(this, "ManifestKmsKey", {
      alias: `alias/${project}-${envName}-manifest-s3`,
      enableKeyRotation: true,
      description: `KMS key for manifest bucket (${project}/${envName})`,
    });

    const pelicanKey = new kms.Key(this, "PelicanKmsKey", {
      alias: `alias/${project}-${envName}-pelican-s3`,
      enableKeyRotation: true,
      description: `KMS key for pelican bucket (${project}/${envName})`,
    });

    const safeHost = bucketSafeFromHostname(hostname);

    // --- S3 buckets ---
    this.pelicanBucket = new s3.Bucket(this, "PelicanBucket", {
      bucketName: `pelican-${safeHost}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: pelicanKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
    });

    this.manifestBucket = new s3.Bucket(this, "ManifestBucket", {
      bucketName: `manifest-${safeHost}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: manifestKey,
      versioned: true,
    });

    this.uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
      bucketName: `uploads-${safeHost}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: uploadsKey,
      versioned: true,
      eventBridgeEnabled: true,
    });

    new s3.Bucket(this, "SchemaBucket", {
      bucketName: `schema-${safeHost}`,
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // --- SNS / SQS ---
    const uploadTopic = new sns.Topic(this, "DataUploadTopic", {
      topicName: `dataupload-${project}-${envName}-uploads`,
    });

    const auditQueue = new sqs.Queue(this, "AuditQueue", {
      queueName: `audit-service-${project}-${envName}`,
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    const dataUploadQueue = new sqs.Queue(this, "DataUploadQueue", {
      queueName: `data-upload-${project}-${envName}`,
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    uploadTopic.addSubscription(new SqsSubscription(dataUploadQueue));
    this.uploadsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(uploadTopic)
    );

    // --- Secrets bootstrap ---
    new Gen3Secrets(this, "Gen3Secrets", {
      project,
      envName,
      forceRunToken: process.env.FORCE_RUN_TOKEN ?? undefined,
      masterSecretName: secrets.dbMasterSecretName,
      create: {
        metadataG3auto: features.metadataG3auto,
        wtsG3auto: features.wtsG3auto,
        pelicanserviceG3auto: features.pelicanserviceG3auto,
        manifestserviceG3auto: features.manifestserviceG3auto,
        auditGen3auto: features.auditGen3auto,
        ssjdispatcherCreds: features.ssjdispatcherCreds,
        fenceJwtPrivateKey: features.fenceJwtPrivateKey,
      },
      g3auto: {
        hostname,
        region: this.region,
        manifestBucketName: this.manifestBucket.bucketName,
        manifestPrefix: "",
        pelicanBucketName: this.pelicanBucket.bucketName,
        oidcClientId: secrets.wtsOidcClientId,
        oidcClientSecret: secrets.wtsOidcClientSecret,
        auditSqsUrl: `https://sqs.${this.region}.amazonaws.com/${this.account}/${auditQueue.queueName}`,
        ssjSqsUrl: `https://sqs.${this.region}.amazonaws.com/${this.account}/${dataUploadQueue.queueName}`,
        ssjDataPattern: `s3://${this.uploadsBucket.bucketName}/*`,
      },
      passwordLength: 24,
      tags: { app: application, env: envName, project },
    });

    // --- SSM parameters ---
    new ssm.StringParameter(this, "UploadsBucketNameParam", {
      parameterName: `/gen3/${project}-${envName}/s3/uploadsBucketName`,
      stringValue: this.uploadsBucket.bucketName,
    });
    new ssm.StringParameter(this, "ManifestBucketNameParam", {
      parameterName: `/gen3/${project}-${envName}/s3/manifestBucketName`,
      stringValue: this.manifestBucket.bucketName,
    });
    new ssm.StringParameter(this, "PelicanBucketNameParam", {
      parameterName: `/gen3/${project}-${envName}/s3/pelicanBucketName`,
      stringValue: this.pelicanBucket.bucketName,
    });
    new ssm.StringParameter(this, "SsjDispatcherQueueArnParam", {
      parameterName: `/gen3/${project}-${envName}/sqs/ssjdispatcherQueueArn`,
      stringValue: dataUploadQueue.queueArn,
    });
    new ssm.StringParameter(this, "UploadsKeyArnParam", {
      parameterName: `/gen3/${project}-${envName}/kms/uploadsKeyArn`,
      stringValue: uploadsKey.keyArn,
    });
    new ssm.StringParameter(this, "ManifestKeyArnParam", {
      parameterName: `/gen3/${project}-${envName}/kms/manifestKeyArn`,
      stringValue: manifestKey.keyArn,
    });
    new ssm.StringParameter(this, "PelicanKeyArnParam", {
      parameterName: `/gen3/${project}-${envName}/kms/pelicanKeyArn`,
      stringValue: pelicanKey.keyArn,
    });

    // --- S3 replication role (always created; replication rule applied by ReplicationStack) ---
    const replicationRole = new iam.Role(this, "S3ReplicationRole", {
      roleName: `gen3-${project}-${envName}-s3-replication-role`,
      path: `/gen3/${project}/${envName}/`,
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
      description: `S3 replication role for ${project}-${envName}`,
    });

    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"],
        resources: [
          this.uploadsBucket.bucketArn,
          this.manifestBucket.bucketArn,
          this.pelicanBucket.bucketArn,
        ],
      })
    );
    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging",
          "s3:GetObjectRetention",
          "s3:GetObjectLegalHold",
        ],
        resources: [
          `${this.uploadsBucket.bucketArn}/*`,
          `${this.manifestBucket.bucketArn}/*`,
          `${this.pelicanBucket.bucketArn}/*`,
        ],
      })
    );
    replicationRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt", "kms:DescribeKey"],
        resources: [uploadsKey.keyArn, manifestKey.keyArn, pelicanKey.keyArn],
      })
    );

    if (replication.enabled) {
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "kms:Decrypt",
            "kms:DescribeKey",
            "kms:Encrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
          ],
          resources: [
            replication.destUploadsKmsKeyArn,
            replication.destManifestKmsKeyArn,
            replication.destPelicanKmsKeyArn,
          ],
        })
      );
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "s3:ReplicateObject",
            "s3:ReplicateDelete",
            "s3:ReplicateTags",
            "s3:GetObjectVersionTagging",
            "s3:ObjectOwnerOverrideToBucketOwner",
          ],
          resources: [
            `${replication.destUploadsBucketArn}/*`,
            `${replication.destManifestBucketArn}/*`,
            `${replication.destPelicanBucketArn}/*`,
          ],
        })
      );
    }

    new cdk.CfnOutput(this, "ReplicationRoleArn", {
      value: replicationRole.roleArn,
      exportName: `${this.stackName}-ReplicationRoleArn`,
    });
  }
}
