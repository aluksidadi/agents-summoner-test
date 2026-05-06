import { spawnSync } from "child_process";
import { readdirSync } from "fs";
import { join, basename } from "path";
import { loadAgentConfig } from "../config";

type Status = "OK" | "FAIL" | "WARN";

interface Check {
  label: string;
  status: Status;
  detail?: string;
}

function check(label: string, status: Status, detail?: string): Check {
  return { label, status, detail };
}

export async function run(): Promise<void> {
  const checks: Check[] = [];

  const flyResult = spawnSync("flyctl", ["--version"], { encoding: "utf-8" });
  if (flyResult.error || flyResult.status !== 0) {
    checks.push(check("flyctl on PATH", "FAIL", "install via https://fly.io/docs/hands-on/install-flyctl/"));
  } else {
    checks.push(check("flyctl on PATH", "OK", flyResult.stdout.trim().split("\n")[0]));
  }

  const flyToken = process.env.FLY_API_TOKEN;
  if (!flyToken) {
    checks.push(check("FLY_API_TOKEN", "FAIL", "not set"));
  } else {
    checks.push(check("FLY_API_TOKEN", "OK"));
  }

  const infisicalProject = process.env.INFISICAL_PROJECT_ID;
  if (!infisicalProject) {
    checks.push(check("INFISICAL_PROJECT_ID", "FAIL", "not set"));
  } else {
    checks.push(check("INFISICAL_PROJECT_ID", "OK"));
  }

  const agentsDir = join(process.cwd(), "agents");
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".toml"));

  for (const file of files) {
    const name = basename(file, ".toml");
    const upper = name.toUpperCase();

    try {
      loadAgentConfig(name);
      checks.push(check(`agents/${name}.toml parseable`, "OK"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push(check(`agents/${name}.toml parseable`, "FAIL", msg));
    }

    const clientId = process.env[`INFISICAL_CLIENT_ID_${upper}`];
    const clientSecret = process.env[`INFISICAL_CLIENT_SECRET_${upper}`];

    if (!clientId || !clientSecret) {
      const missing = [
        !clientId && `INFISICAL_CLIENT_ID_${upper}`,
        !clientSecret && `INFISICAL_CLIENT_SECRET_${upper}`,
      ]
        .filter(Boolean)
        .join(", ");
      checks.push(check(`${name} Infisical creds`, "WARN", `not set: ${missing}`));
    } else {
      checks.push(check(`${name} Infisical creds`, "OK"));
    }
  }

  const width = Math.max(...checks.map((c) => c.label.length)) + 2;
  for (const c of checks) {
    const pad = c.label.padEnd(width);
    const detail = c.detail ? `  ${c.detail}` : "";
    process.stdout.write(`${pad}${c.status}${detail}\n`);
  }

  const failed = checks.some((c) => c.status === "FAIL");
  if (failed) {
    process.exit(1);
  }
}
