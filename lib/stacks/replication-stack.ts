import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";

export interface ReplicationRuleInput {
  sourceBucket: s3.Bucket;
  destBucketArn: string;
  destKmsKeyArn: string;
  id?: string;
  prefix?: string;
}

export interface ReplicationStackProps extends cdk.StackProps {
  backupAccountId: string;
  replicationRoleArn: string;
  rules: ReplicationRuleInput[];
}

export class ReplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReplicationStackProps) {
    super(scope, id, props);

    for (const r of props.rules) {
      const cfn = r.sourceBucket.node.defaultChild as s3.CfnBucket;

      const rule: s3.CfnBucket.ReplicationRuleProperty = {
        id: r.id ?? `${r.sourceBucket.bucketName}-to-backup`,
        status: "Enabled",
        priority: 1,
        filter: { prefix: r.prefix ?? "" },
        deleteMarkerReplication: { status: "Disabled" },
        sourceSelectionCriteria: {
          sseKmsEncryptedObjects: { status: "Enabled" },
        },
        destination: {
          bucket: r.destBucketArn,
          account: props.backupAccountId,
          accessControlTranslation: { owner: "Destination" },
          encryptionConfiguration: { replicaKmsKeyId: r.destKmsKeyArn },
          metrics: { status: "Enabled" },
        },
      };

      cfn.replicationConfiguration = {
        role: props.replicationRoleArn,
        rules: [rule],
      } as s3.CfnBucket.ReplicationConfigurationProperty;
    }
  }
}
