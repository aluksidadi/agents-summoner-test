import type { AgentConfig } from "../config";
import { setSecrets } from "../lib/fly";

export async function run(cfg: AgentConfig): Promise<void> {
  const upper = cfg.name.toUpperCase();
  const clientId = process.env[`INFISICAL_CLIENT_ID_${upper}`];
  const clientSecret = process.env[`INFISICAL_CLIENT_SECRET_${upper}`];
  const projectId = process.env.INFISICAL_PROJECT_ID;

  const missing: string[] = [];
  if (!clientId) missing.push(`INFISICAL_CLIENT_ID_${upper}`);
  if (!clientSecret) missing.push(`INFISICAL_CLIENT_SECRET_${upper}`);
  if (!projectId) missing.push("INFISICAL_PROJECT_ID");
  if (missing.length > 0) {
    process.stderr.write(`secrets: missing required env vars: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  await setSecrets(
    cfg.fly_app,
    {
      INFISICAL_CLIENT_ID: clientId!,
      INFISICAL_CLIENT_SECRET: clientSecret!,
      INFISICAL_PROJECT_ID: projectId!,
      INFISICAL_PATH: cfg.infisical_path,
      INFISICAL_ENV: cfg.infisical_env,
    },
    { stage: false }
  );

  process.stdout.write(`secrets pushed to ${cfg.fly_app}; machine restart triggered.\n`);
}
