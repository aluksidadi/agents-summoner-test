export async function run(agent: string): Promise<void> {
  if (!agent) {
    process.stderr.write("Usage: bun run summon <agent>\n");
    process.exit(1);
  }
  process.stdout.write(`summon ${agent}: not implemented\n`);
}
