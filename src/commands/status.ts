import type { AgentConfig } from "../config";
import { status, listVolumes } from "../lib/fly";

export async function run(cfg: AgentConfig): Promise<void> {
  const [{ machines }, volumes] = await Promise.all([
    status(cfg.fly_app),
    listVolumes(cfg.fly_app),
  ]);

  if (machines.length === 0) {
    process.stdout.write(`${cfg.fly_app}: no machines found.\n`);
    return;
  }

  const volById = new Map(volumes.map((v) => [v.id, v.Name]));

  process.stdout.write(`\nStatus \u2014 ${cfg.fly_app}\n`);
  process.stdout.write("\u2500".repeat(72) + "\n");

  const header =
    pad("ID", 14) + pad("STATE", 12) + pad("REGION", 8) + pad("LAST RESTART", 28) + "VOLUME\n";
  process.stdout.write(header);
  process.stdout.write("\u2500".repeat(72) + "\n");

  for (const m of machines) {
    const volName = volById.get(m.id) ?? "\u2014";
    const row =
      pad(m.id.slice(0, 13), 14) +
      pad(m.state, 12) +
      pad(m.region, 8) +
      pad(m.last_restart_at ? new Date(m.last_restart_at).toISOString() : "\u2014", 28) +
      volName +
      "\n";
    process.stdout.write(row);
  }
  process.stdout.write("\n");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width - 1) + " " : s + " ".repeat(width - s.length);
}
