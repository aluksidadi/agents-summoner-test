import { readdirSync } from "fs";
import { join, basename } from "path";
import { loadAgentConfig } from "../config";

export async function run(): Promise<void> {
  const agentsDir = join(process.cwd(), "agents");
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".toml"));

  if (files.length === 0) {
    process.stdout.write("No agents configured.\n");
    return;
  }

  for (const file of files) {
    const name = basename(file, ".toml");
    const cfg = loadAgentConfig(name);
    process.stdout.write(
      `${cfg.name}  ${cfg.fly_app}  ${cfg.infisical_path}  ${cfg.infisical_env}\n`
    );
  }
}
