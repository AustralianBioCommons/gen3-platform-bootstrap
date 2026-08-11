import * as cdk from "aws-cdk-lib";

// ---------------------------------------------------------------------------
// Shared / top-level
// ---------------------------------------------------------------------------

export interface EnvironmentTarget {
  name: string;
  account: string;
  region: string;
}

export interface NamingConfig {
  namePrefix: string;
  ssmPrefix: string;
  secretPrefix: string;
}

export interface AppConfig {
  project: string;
  application: string;
  owner?: string;
  tags?: Record<string, string>;
  naming: NamingConfig;
  environments: Record<string, EnvironmentTarget>;
  stages: StageConfig[];
}

// ---------------------------------------------------------------------------
// Per-stage (raw JSON shape)
// ---------------------------------------------------------------------------

export interface StageConfig {
  id: string;
  stageName: string;
  envKey: string;
  approvals?: ApprovalConfig;
  bootstrap: BootstrapConfig;
}

export interface ApprovalConfig {
  requireManualApproval?: boolean;
}

// ---------------------------------------------------------------------------
// Bootstrap config (raw JSON shape)
// ---------------------------------------------------------------------------

export interface BootstrapConfig {
  hostname: string;
  namespace: string;
  replication?: ReplicationConfig;
  features?: FeaturesConfig;
  secrets?: SecretsConfig;
  clusterInfoSsmPrefix?: string;   // optional; see JSDoc
  searchDomainArnSsmPath?: string;  // optional; see JSDoc
}

export interface ReplicationConfig {
  enabled: boolean;
  backupAccountId?: string;
  destUploadsKmsKeyArn?: string;
  destManifestKmsKeyArn?: string;
  destPelicanKmsKeyArn?: string;
  destUploadsBucketArn?: string;
  destManifestBucketArn?: string;
  destPelicanBucketArn?: string;
}

export interface FeaturesConfig {
  metadataG3auto?: boolean;
  wtsG3auto?: boolean;
  pelicanserviceG3auto?: boolean;
  manifestserviceG3auto?: boolean;
  auditGen3auto?: boolean;
  ssjdispatcherCreds?: boolean;
  fenceJwtPrivateKey?: boolean;
}

export interface SecretsConfig {
  dbMasterSecretName?: string;
  wtsOidcClientId?: string;
  wtsOidcClientSecret?: string;
}

// ---------------------------------------------------------------------------
// Resolved shapes (post-loader, passed to stacks)
// ---------------------------------------------------------------------------

export interface ResolvedStageConfig {
  id: string;
  stageName: string;
  envTarget: EnvironmentTarget;
  bootstrap: ResolvedBootstrapConfig;
  requireManualApproval: boolean;
}

export interface ResolvedBootstrapConfig {
  hostname: string;
  namespace: string;
  features: Required<FeaturesConfig>;
  secrets: ResolvedSecretsConfig;
  replication: ResolvedReplicationConfig;
  clusterInfoSsmPrefix: string;
  searchDomainArnSsmPath: string;
}

export interface ResolvedSecretsConfig {
  dbMasterSecretName: string;
  wtsOidcClientId?: string;
  wtsOidcClientSecret?: string;
}

export interface ResolvedReplicationConfig {
  enabled: boolean;
  backupAccountId: string;
  destUploadsKmsKeyArn: string;
  destManifestKmsKeyArn: string;
  destPelicanKmsKeyArn: string;
  destUploadsBucketArn: string;
  destManifestBucketArn: string;
  destPelicanBucketArn: string;
}

// ---------------------------------------------------------------------------
// Stack props
// ---------------------------------------------------------------------------

export interface BaseNamingProps {
  project: string;
  application: string;
  namePrefix: string;
  ssmPrefix: string;
  secretPrefix: string;
}

export interface BootstrapStackProps extends cdk.StackProps, BaseNamingProps {
  envTarget: EnvironmentTarget;
  bootstrap: ResolvedBootstrapConfig;
  envKey: string;
}
