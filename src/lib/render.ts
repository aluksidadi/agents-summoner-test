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

export async function stageBuildContext(config: AgentConfig): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hermes-deploy-"));

  writeFileSync(join(dir, "fly.toml"), renderFlyToml(config), "utf-8");
  copyFileSync(join(HERMES_DIR, "Dockerfile"), join(dir, "Dockerfile"));
  copyFileSync(join(HERMES_DIR, "entrypoint.sh"), join(dir, "entrypoint.sh"));
  copyFileSync(join(HERMES_DIR, "config.yaml"), join(dir, "config.yaml"));

  return dir;
}
