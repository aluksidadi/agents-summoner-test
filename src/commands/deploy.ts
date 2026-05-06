import type { AgentConfig } from "../config";
import { deploy } from "../lib/fly";
import { stageBuildContext } from "../lib/render";

export async function run(cfg: AgentConfig): Promise<void> {
  process.stdout.write(`[deploy 1/2] staging build context for ${cfg.fly_app}\n`);
  const { flyTomlPath, dockerfilePath } = await stageBuildContext(cfg);

  process.stdout.write(`[deploy 2/2] deploying ${cfg.fly_app}\n`);
  await deploy(cfg.fly_app, flyTomlPath, dockerfilePath, {
    HERMES_IMAGE_TAG: cfg.hermes_image_tag,
  });

  process.stdout.write(`\ndeploy complete \u2014 ${cfg.fly_app} redeployed.\n`);
}
