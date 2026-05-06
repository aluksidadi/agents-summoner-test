import type { AgentConfig } from "../config";
import { deploy } from "../lib/fly";
import { stageBuildContext } from "../lib/render";

export async function run(cfg: AgentConfig): Promise<void> {
  process.stdout.write(`[deploy 1/2] staging build context for ${cfg.fly_app}\n`);
  const buildDir = await stageBuildContext(cfg);

  process.stdout.write(`[deploy 2/2] deploying ${cfg.fly_app}\n`);
  await deploy(cfg.fly_app, buildDir, {
    HERMES_GIT_REF: cfg.hermes_git_ref,
  });

  process.stdout.write(`\ndeploy complete — ${cfg.fly_app} redeployed.\n`);
}
