# Gen3 Infra Bootstrap

AWS CDK bootstrap for Gen3 platform infrastructure, IAM, and secrets initialization.

## What This Deploys

- Core infrastructure stack: S3 buckets, KMS keys, SNS/SQS wiring, and Gen3 secrets bootstrap
- IAM stack: roles and policies for Gen3 services
- Optional replication stack for cross-account S3 replication

## Prerequisites

- Node.js 18+ and npm
- AWS credentials with permissions to deploy CDK stacks
- Account already bootstrapped for CDK

## Configuration

Provide a JSON config via CDK context. Start from `config/example.public.json`.

Key fields:
- `project`, `application`, `owner`
- `naming` prefixes for SSM and Secrets Manager
- `environments` (account/region)
- `stages` (per-environment bootstrap settings)
- `bootstrap.features` toggles for which secrets are created
- `bootstrap.replication` settings (optional)

## Deploy

Install deps:
```bash
npm install
```

Synthesize:
```bash
npx cdk synth -c config=./config/example.public.json
```

Deploy all stacks:
```bash
npx cdk deploy -c config=./config/example.public.json
```

Deploy a single stack:
```bash
npx cdk deploy -c config=./config/example.public.json SampleTestBootstrapInfra
```

## Secrets Bootstrap Lambda

The `Gen3Secrets` construct invokes the lambda in `lambda/gen3-secrets/onEvent.ts` to create
Gen3 secrets when enabled via `bootstrap.features`.

Dry run (no AWS calls, for local testing):
- Set `DRY_RUN=1` in the lambda environment, or
- Pass `dryRun: true` in the custom resource props

## Tests

Run Jest:
```bash
npm test
```

## Notes

- Config is validated at runtime; invalid configs will fail fast with explicit errors.
- Replication is created only when `bootstrap.replication.enabled` is true.
