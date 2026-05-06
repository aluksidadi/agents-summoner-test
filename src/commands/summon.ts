import { spawnSync } from "child_process";
import type { AgentConfig } from "../config";
import { appExists, createApp, volumeExists, createVolume, setSecrets, deploy, status } from "../lib/fly";
import { stageBuildContext } from "../lib/render";

function step(n: number, total: number, msg: string): void {
  process.stdout.write(`[summon ${n}/${total}] ${msg}\n`);
}

function preflight(cfg: AgentConfig): void {
  const upper = cfg.name.toUpperCase();
  const missing: string[] = [];

  if (!process.env.FLY_API_TOKEN) missing.push("FLY_API_TOKEN");
  if (!process.env[`INFISICAL_CLIENT_ID_${upper}`]) missing.push(`INFISICAL_CLIENT_ID_${upper}`);
  if (!process.env[`INFISICAL_CLIENT_SECRET_${upper}`]) missing.push(`INFISICAL_CLIENT_SECRET_${upper}`);
  if (!process.env.INFISICAL_PROJECT_ID) missing.push("INFISICAL_PROJECT_ID");

  if (missing.length > 0) {
    process.stderr.write(`summon: missing required env vars: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  const flyCheck = spawnSync("flyctl", ["--version"], { encoding: "utf-8" });
  if (flyCheck.error || flyCheck.status !== 0) {
    process.stderr.write(
      "summon: flyctl not found on PATH — install via https://fly.io/docs/hands-on/install-flyctl/\n"
    );
    process.exit(1);
  }
}

async function waitUntilStarted(app: string, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { machines } = await status(app);
      if (machines.length > 0 && machines.every((m) => m.state === "started")) {
        return true;
      }
    } catch {
      // status may transiently fail right after deploy
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function tailLogsFor(app: string, durationMs = 30_000): Promise<void> {
  const token = process.env.FLY_API_TOKEN;
  const proc = Bun.spawn(["flyctl", "logs", "--app", app], {
    env: { ...process.env, ...(token ? { FLY_API_TOKEN: token } : {}) },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await Promise.race([
    proc.exited,
    new Promise<void>((r) => setTimeout(r, durationMs)),
  ]);
  proc.kill();
}

export async function run(cfg: AgentConfig): Promise<void> {
  const TOTAL = 8;
  const upper = cfg.name.toUpperCase();

  step(1, TOTAL, `config loaded for ${cfg.name}`);

  step(2, TOTAL, "preflight checks");
  preflight(cfg);

  step(3, TOTAL, "staging build context");
  const buildDir = await stageBuildContext(cfg);

  step(4, TOTAL, `ensuring Fly app ${cfg.fly_app} exists`);
  if (!(await appExists(cfg.fly_app))) {
    await createApp(cfg.fly_app);
  }

  step(5, TOTAL, `ensuring volume ${cfg.volume_name} exists in ${cfg.primary_region}`);
  if (!(await volumeExists(cfg.fly_app, cfg.volume_name, cfg.primary_region))) {
    await createVolume(cfg.fly_app, cfg.volume_name, cfg.primary_region, cfg.volume_size_gb);
  }

  step(6, TOTAL, "staging bootstrap secrets");
  await setSecrets(
    cfg.fly_app,
    {
      INFISICAL_CLIENT_ID: process.env[`INFISICAL_CLIENT_ID_${upper}`]!,
      INFISICAL_CLIENT_SECRET: process.env[`INFISICAL_CLIENT_SECRET_${upper}`]!,
      INFISICAL_PROJECT_ID: process.env.INFISICAL_PROJECT_ID!,
      INFISICAL_PATH: cfg.infisical_path,
      INFISICAL_ENV: cfg.infisical_env,
    },
    { stage: true }
  );

  step(7, TOTAL, `deploying ${cfg.fly_app} (image: nousresearch/hermes-agent:${cfg.hermes_git_ref})`);
  await deploy(cfg.fly_app, buildDir, {
    HERMES_GIT_REF: cfg.hermes_git_ref,
  });

  step(8, TOTAL, "waiting for machine to reach started state (90s timeout)");
  const started = await waitUntilStarted(cfg.fly_app);
  if (!started) {
    process.stderr.write(
      `summon: machine did not reach started state within 90s — run 'bun run logs ${cfg.name}' to investigate\n`
    );
    process.exit(1);
  }
  process.stdout.write("machine started — tailing logs for 30s\n\n");
  await tailLogsFor(cfg.fly_app, 30_000);

  process.stdout.write(`\nsummon complete — ${cfg.fly_app} deployed.\n`);
}
