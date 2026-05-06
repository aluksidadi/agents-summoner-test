export async function run(agent: string): Promise<void> {
  if (!agent) {
    process.stderr.write("Usage: bun run deploy <agent>\n");
    process.exit(1);
  }
  throw new Error("not implemented");
}
