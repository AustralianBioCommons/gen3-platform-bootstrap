import { AppConfig } from "../types";

export function validateConfig(config: AppConfig): void {
  if (!config.project) throw new Error("project is required");
  if (!config.application) throw new Error("application is required");

  if (!config.naming?.namePrefix) throw new Error("naming.namePrefix is required");
  if (!config.naming?.ssmPrefix) throw new Error("naming.ssmPrefix is required");
  if (!config.naming?.secretPrefix) throw new Error("naming.secretPrefix is required");

  if (!config.environments || Object.keys(config.environments).length === 0) {
    throw new Error("environments is required");
  }

  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new Error("at least one stage is required");
  }

  for (const stage of config.stages) {
    if (!stage.id) throw new Error("each stage requires id");
    if (!stage.stageName) throw new Error(`stage ${stage.id}: stageName is required`);
    if (!stage.envKey) throw new Error(`stage ${stage.id}: envKey is required`);

    if (!config.environments[stage.envKey]) {
      throw new Error(
        `stage ${stage.id}: envKey '${stage.envKey}' not found in environments`
      );
    }

    if (!stage.bootstrap) {
      throw new Error(`stage ${stage.id}: bootstrap is required`);
    }
    if (!stage.bootstrap.hostname) {
      throw new Error(`stage ${stage.id}: bootstrap.hostname is required`);
    }
    if (!stage.bootstrap.namespace) {
      throw new Error(`stage ${stage.id}: bootstrap.namespace is required`);
    }
  }
}
