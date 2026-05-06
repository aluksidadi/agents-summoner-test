import type { AgentConfig } from "../config";
import { tailLogs } from "../lib/fly";

export async function run(cfg: AgentConfig): Promise<void> {
  tailLogs(cfg.fly_app);
}
