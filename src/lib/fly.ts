export class FlyCommandError extends Error {
  constructor(
    public readonly cmd: string,
    public readonly stderrTail: string
  ) {
    super(`flyctl ${cmd} failed: ${stderrTail}`);
    this.name = "FlyCommandError";
  }
}

async function fly(
  args: string[],
  opts: { stdin?: "pipe" | "inherit" } = {}
): Promise<string> {
  const token = process.env.FLY_API_TOKEN;
  const proc = Bun.spawn(["flyctl", ...args], {
    env: { ...process.env, ...(token ? { FLY_API_TOKEN: token } : {}) },
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin ?? "inherit",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const tail = stderr.trim().split("\n").slice(-5).join("\n");
    throw new FlyCommandError(args[0] ?? "", tail);
  }

  return stdout;
}

function flyStream(args: string[]): never {
  const token = process.env.FLY_API_TOKEN;
  const proc = Bun.spawn(["flyctl", ...args], {
    env: { ...process.env, ...(token ? { FLY_API_TOKEN: token } : {}) },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  proc.exited.then((code) => process.exit(code));
  // This branch never returns — process exits when the child does.
  throw new Error("unreachable");
}

export async function appExists(name: string): Promise<boolean> {
  const out = await fly(["apps", "list", "--json"]);
  const apps: Array<{ Name: string }> = JSON.parse(out);
  return apps.some((a) => a.Name === name);
}

export async function createApp(name: string, org?: string): Promise<void> {
  const args = ["apps", "create", name];
  if (org) args.push("--org", org);
  await fly(args);
}

export async function volumeExists(
  app: string,
  name: string,
  region: string
): Promise<boolean> {
  const out = await fly(["volumes", "list", "--app", app, "--json"]);
  const vols: Array<{ Name: string; Region: string }> = JSON.parse(out);
  return vols.some((v) => v.Name === name && v.Region === region);
}

export async function createVolume(
  app: string,
  name: string,
  region: string,
  sizeGb: number
): Promise<void> {
  await fly([
    "volumes",
    "create",
    name,
    "--app",
    app,
    "--region",
    region,
    "--size",
    String(sizeGb),
    "--yes",
  ]);
}

export async function setSecrets(
  app: string,
  secrets: Record<string, string>,
  opts: { stage?: boolean } = {}
): Promise<void> {
  const pairs = Object.entries(secrets).map(([k, v]) => `${k}=${v}`);
  const args = ["secrets", "set", "--app", app, ...(opts.stage ? ["--stage"] : []), ...pairs];
  await fly(args);
}

export async function deploy(
  app: string,
  configPath: string,
  dockerfilePath: string,
  buildArgs: Record<string, string>
): Promise<void> {
  const buildArgFlags = Object.entries(buildArgs).flatMap(([k, v]) => [
    "--build-arg",
    `${k}=${v}`,
  ]);
  await fly([
    "deploy",
    "--app",
    app,
    "--config",
    configPath,
    "--dockerfile",
    dockerfilePath,
    "--strategy",
    "immediate",
    ...buildArgFlags,
  ]);
}

export async function status(app: string): Promise<{
  machines: Array<{
    id: string;
    state: string;
    region: string;
    last_restart_at: string;
  }>;
}> {
  const out = await fly(["status", "--app", app, "--json"]);
  const raw: {
    Machines?: Array<{
      id: string;
      state: string;
      region: string;
      updated_at: string;
    }>;
  } = JSON.parse(out);
  return {
    machines: (raw.Machines ?? []).map((m) => ({
      id: m.id,
      state: m.state,
      region: m.region,
      last_restart_at: m.updated_at,
    })),
  };
}

export function tailLogs(app: string): never {
  return flyStream(["logs", "--app", app]);
}

export async function destroyApp(app: string): Promise<void> {
  await fly(["apps", "destroy", app, "--yes"]);
}

export async function destroyVolume(
  app: string,
  volumeId: string
): Promise<void> {
  await fly(["volumes", "destroy", volumeId, "--app", app, "--yes"]);
}

export async function listVolumes(
  app: string
): Promise<Array<{ id: string; Name: string; Region: string }>> {
  const out = await fly(["volumes", "list", "--app", app, "--json"]);
  return JSON.parse(out);
}
