import { run as runSummon } from "./commands/summon";
import { run as runDeploy } from "./commands/deploy";
import { run as runSecrets } from "./commands/secrets";
import { run as runLogs } from "./commands/logs";
import { run as runStatus } from "./commands/status";
import { run as runDestroy } from "./commands/destroy";
import { run as runList } from "./commands/list";
import { run as runDoctor } from "./commands/doctor";

const HELP = `agents-summoner — control plane for Hermes agents

USAGE
  bun run <command> <agent>           # <agent> is the basename of agents/<agent>.toml

COMMANDS
  summon  <agent>     One-shot: ensure Fly app + volume exist, push bootstrap secrets,
                      build image, deploy. Idempotent — safe to re-run.
  deploy  <agent>     Rebuild and redeploy an already-summoned app. No secret changes.
  secrets <agent>     Push the Infisical bootstrap creds to Fly secrets. Reads
                      INFISICAL_CLIENT_ID_<NAME>, INFISICAL_CLIENT_SECRET_<NAME>, and
                      INFISICAL_PROJECT_ID from the local environment / .env.
                      Triggers a machine restart (Fly default).
  logs    <agent>     Tail \`fly logs --app <fly_app>\`.
  status  <agent>     Show machine state, last restart, region, volume attachment.
  destroy <agent>     Destroy Fly app + volume. Confirms with the agent's name typed back.
                      Does NOT touch Infisical.
  list                List all agents/*.toml, with provisioning status from Fly.
  doctor              Verify FLY_API_TOKEN, flyctl installed, Infisical bootstrap creds
                      present in env, every agent config parseable.
`;

const [, , command, agent] = process.argv;

if (!command || command === "--help" || command === "-h") {
  process.stdout.write(HELP);
  process.exit(1);
}

async function main() {
  switch (command) {
    case "summon":
      await runSummon(agent);
      break;
    case "deploy":
      await runDeploy(agent);
      break;
    case "secrets":
      await runSecrets(agent);
      break;
    case "logs":
      await runLogs(agent);
      break;
    case "status":
      await runStatus(agent);
      break;
    case "destroy":
      await runDestroy(agent);
      break;
    case "list":
      await runList();
      break;
    case "doctor":
      await runDoctor();
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
