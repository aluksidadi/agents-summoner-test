import type { AgentConfig } from "../config";
import { listVolumes, destroyVolume, destroyApp } from "../lib/fly";

export async function run(cfg: AgentConfig): Promise<void> {
  process.stdout.write(
    `\nWARNING: This will permanently destroy the Fly app "${cfg.fly_app}" and all its volumes.\n` +
      `Infisical folder and machine identity are NOT touched.\n\n` +
      `Type the agent name to confirm: `
  );

  const confirmation = await readLine();

  if (confirmation.trim() !== cfg.name) {
    process.stderr.write(`Aborted \u2014 confirmation did not match "${cfg.name}".\n`);
    process.exit(1);
  }

  const volumes = await listVolumes(cfg.fly_app);
  for (const vol of volumes) {
    process.stdout.write(`Destroying volume ${vol.id} (${vol.Name})...\n`);
    await destroyVolume(cfg.fly_app, vol.id);
  }

  process.stdout.write(`Destroying app ${cfg.fly_app}...\n`);
  await destroyApp(cfg.fly_app);

  process.stdout.write(`\n${cfg.fly_app} destroyed.\n`);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.resume();
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.pause();
        resolve(buf.slice(0, nl));
      }
    });
  });
}
