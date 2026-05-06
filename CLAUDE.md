# agents-summoner

A TypeScript + Bun control plane that deploys [Hermes](https://github.com/NousResearch/hermes-agent) Discord bots to Fly.io. Each agent gets its own Fly app, volume, and Infisical secret folder. Adding a new agent requires one config file and no code changes.

---

## Repo layout

```
agents-summoner/
├── agents/            # one TOML file per agent — the only thing that changes
│   ├── ifrit.toml
│   └── shiva.toml
├── hermes/
│   ├── Dockerfile     # multi-stage; pins Hermes git SHA from agent config
│   ├── entrypoint.sh  # exchanges Infisical creds → token, execs hermes discord
│   └── config.yaml    # committed Hermes behavioural config; baked into image
├── fly/
│   └── fly.toml.tmpl  # {{APP_NAME}} and {{PRIMARY_REGION}} substituted at deploy
├── src/
│   ├── cli.ts         # entrypoint; subcommand dispatch
│   ├── config.ts      # parses agents/<name>.toml
│   └── commands/      # summon.ts, deploy.ts, secrets.ts, logs.ts, status.ts, destroy.ts
├── .env.example       # FLY_API_TOKEN, INFISICAL_* — copy to .env before first run
└── .team/             # research/ + design/ — read-only for engineers
```

---

## Launcher commands

All commands: `bun run <cmd> <agent>` where `<agent>` is the basename of `agents/<agent>.toml`.

| Command | What it does | Source |
|---|---|---|
| `summon <agent>` | Provision + deploy from scratch. Idempotent, safe to re-run. | `src/commands/summon.ts` |
| `deploy <agent>` | Rebuild and redeploy an already-summoned app. No secret changes. | `src/commands/deploy.ts` |
| `secrets <agent>` | Push Infisical bootstrap creds to Fly. Triggers machine restart. | `src/commands/secrets.ts` |
| `logs <agent>` | Tail `fly logs --app <fly_app>`. | `src/commands/logs.ts` |
| `status <agent>` | Machine state, last restart, region, volume. | `src/commands/status.ts` |
| `destroy <agent>` | Tear down Fly app + volume. Prompts confirmation. | `src/commands/destroy.ts` |
| `list` | List all `agents/*.toml` with Fly provisioning status. | `src/commands/` |
| `doctor` | Verify `FLY_API_TOKEN`, `flyctl` on PATH, env vars, configs parseable. | `src/commands/` |

---

## Agent config (`agents/<name>.toml`)

```toml
name           = "ifrit"
fly_app        = "hermes-ifrit"
primary_region = "ord"
vm_size        = "shared-cpu-1x"
vm_memory_mb   = 512
volume_name    = "hermes_data"
volume_size_gb = 10
hermes_git_ref = "main"
hermes_model   = "openrouter/anthropic/claude-opus-4.6"
infisical_env  = "prod"
infisical_path = "/ifrit"
required_secrets = ["DISCORD_BOT_TOKEN","DISCORD_HOME_CHANNEL","DISCORD_ALLOWED_USERS","OPENROUTER_API_KEY"]
```

Full schema: `.team/design/DESIGN.md §3`.

---

## Deploy flow — `bun run summon ifrit`

1. Parse `agents/ifrit.toml`. Fail fast on missing fields.
2. Doctor checks: `FLY_API_TOKEN`, `INFISICAL_CLIENT_ID_IFRIT`, `INFISICAL_CLIENT_SECRET_IFRIT`, `INFISICAL_PROJECT_ID`, `flyctl` on PATH.
3. Render `fly/fly.toml.tmpl` → tempdir with `{{APP_NAME}}` and `{{PRIMARY_REGION}}` substituted.
4. Ensure Fly app exists; create if absent (`flyctl apps create hermes-ifrit`).
5. Ensure volume exists in `primary_region`; create if absent.
6. Stage bootstrap secrets: `flyctl secrets set --stage INFISICAL_CLIENT_ID=… INFISICAL_CLIENT_SECRET=… INFISICAL_PROJECT_ID=… INFISICAL_PATH=/ifrit`.
7. Build + deploy: `flyctl deploy --dockerfile … --build-arg HERMES_GIT_REF=<ref> --strategy immediate`.
8. Verify: poll `flyctl status` until `started`; tail logs ~30 s for Discord connection line.

Details: `.team/design/DESIGN.md §7`.

---

## Key invariants

- Each agent's runtime secrets live in its own Infisical folder (`/ifrit`, `/shiva`). The repo never holds them.
- Fly holds only three bootstrap secrets per app: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`.
- One Fly app per agent; one Fly volume per agent mounted at `/opt/data`.
- Adding agent #3 = one new `agents/<name>.toml` + one Infisical folder + one machine identity. No code changes.
- Secret rotation: change in Infisical → `fly machine restart`. No redeploy needed.
- Bootstrap rotation: regenerate Infisical identity → `bun run secrets <agent>`.
- `destroy` must remove the volume to avoid orphan storage charges and zone-affinity issues.

---

## Team workflow

This repo is developed by an agent team. Role definitions live in `.claude/agents/`. Roles: `architect`, `integration-expert`, `project-manager`, `principal-engineer`, `ax-engineer`, `logs-watcher`. New work flows architect → PM → engineers. The AX engineer owns `CLAUDE.md` and `.claude/` structure. Do not implement product code from this file — open a task or message `principal-engineer`.

---

## Manual setup (first time only)

See `.team/design/DESIGN.md §9` for the full checklist: Fly/Infisical/Discord/OpenRouter account setup, per-agent Infisical folder + machine identity creation, and local `.env` population. Complete §9 before running `bun run summon`.
