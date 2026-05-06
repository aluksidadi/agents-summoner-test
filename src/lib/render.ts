import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentConfig } from "../config";

const TMPL_PATH = join(import.meta.dir, "../../fly/fly.toml.tmpl");
const HERMES_DIR = join(import.meta.dir, "../../hermes");

export function renderFlyToml(config: AgentConfig): string {
  const text = readFileSync(TMPL_PATH, "utf-8");
  return text
    .replace(/\{\{APP_NAME\}\}/g, config.fly_app)
    .replace(/\{\{PRIMARY_REGION\}\}/g, config.primary_region);
}

export async function stageBuildContext(
  config: AgentConfig
): Promise<{ dir: string; flyTomlPath: string; dockerfilePath: string }> {
  const dir = mkdtempSync(join(tmpdir(), "hermes-deploy-"));

  const flyTomlPath = join(dir, "fly.toml");
  writeFileSync(flyTomlPath, renderFlyToml(config), "utf-8");

  const dockerfilePath = join(dir, "Dockerfile");
  copyFileSync(join(HERMES_DIR, "Dockerfile"), dockerfilePath);
  copyFileSync(join(HERMES_DIR, "entrypoint.sh"), join(dir, "entrypoint.sh"));
  copyFileSync(join(HERMES_DIR, "config.yaml"), join(dir, "config.yaml"));

  return { dir, flyTomlPath, dockerfilePath };
}
