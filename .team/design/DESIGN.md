# agents-summoner — Design

Status: v1 (covers first-agent deployment only).
Author: architect.
Locked decisions live in `.claude/agents/architect.md`; do not relitigate.

---

## 1. Goals & non-goals

**Goals (v1):**
- One repo, one CLI, deploys `hermes-ifrit` to Fly.io reproducibly.
- Adding agent #3 = one new file in `agents/` plus one Infisical folder + machine identity.
- Per-agent secrets live in Infisical; Fly only holds the bootstrap creds (Infisical client id/secret + project id).
- Operator workflow is `bun run summon ifrit` → bot online in Discord.

**Non-goals (v1):**
- No web dashboard, no monitoring SLOs, no autoscaling, no multi-region.
- No personality/config divergence between agents. Identical Hermes config; only secrets + agent name differ.
- No GitHub Actions / CI deploys yet. Operator runs the launcher locally.
- No automated Infisical project bootstrapping (manual UI step, see §9).

---

## 2. Repo layout

```
agents-summoner-test/
├── agents/                          # one file per agent — the only thing that changes per agent
│   ├── ifrit.toml
│   └── shiva.toml                   # added in phase 2
├── hermes/                          # everything needed to build the Hermes container image
│   ├── Dockerfile                   # multi-stage build, pins Hermes git SHA from agent config
│   ├── entrypoint.sh                # exchanges Infisical creds → token, execs `infisical run -- hermes discord`
│   └── config.yaml                  # baked-in Hermes behavioural config (committed, identical across agents)
├── fly/
│   └── fly.toml.tmpl                # template — `{{APP_NAME}}` substituted at deploy time
├── src/                             # Bun launcher CLI
│   ├── cli.ts                       # entrypoint; subcommand dispatch
│   ├── config.ts                    # parse + validate agents/<name>.toml
│   ├── commands/
│   │   ├── summon.ts                # one-shot: provision + deploy (idempotent)
│   │   ├── deploy.ts                # rebuild + redeploy existing app
│   │   ├── secrets.ts               # push Fly bootstrap secrets from local env
│   │   ├── logs.ts                  # `fly logs` passthrough
│   │   ├── status.ts                # machine state + last restart
│   │   └── destroy.ts               # tear down (volume + app)
│   └── lib/
│       ├── fly.ts                   # thin shell wrappers around flyctl
│       └── render.ts                # render fly.toml.tmpl + Dockerfile args
├── package.json                     # bun, @types/bun, smol-toml
├── bunfig.toml
├── tsconfig.json
├── .env.example                     # FLY_API_TOKEN, INFISICAL_*, per-agent secret names
├── .gitignore
├── README.md
└── .team/                           # already present — research / design / tickets
```

Notes:
- No node_modules secrets, no per-agent Dockerfiles. The agent config drives every difference.
- `hermes/config.yaml` is committed and baked into the image. Hermes' entrypoint copies it onto the volume on first boot only; subsequent boots use the volume copy. To change defaults across agents, edit this file and redeploy.
- `fly.toml.tmpl` substitution is intentionally string-templated, not a real templating engine. Two tokens only: `{{APP_NAME}}`, `{{PRIMARY_REGION}}`.

---

## 3. Agent config schema

One TOML file per agent. This is **the only thing an operator edits to add an agent**.

`agents/ifrit.toml`:

```toml
# Identity
name           = "ifrit"             # also the suffix on the Fly app name → hermes-ifrit
display_name   = "Ifrit"             # used in logs / human-readable output

# Fly
fly_app        = "hermes-ifrit"
primary_region = "ord"
vm_size        = "shared-cpu-1x"
vm_memory_mb   = 512
volume_name    = "hermes_data"
volume_size_gb = 10

# Hermes
hermes_git_ref = "main"              # commit SHA preferred for repro; "main" acceptable in v1
hermes_model   = "openrouter/anthropic/claude-opus-4.6"

# Infisical (per-agent folder — must already exist + machine identity must be created)
infisical_env  = "prod"
infisical_path = "/ifrit"            # folder within the single shared project

# Secret keys we expect to find at infisical_path. Used for validation & error messages.
# These are the keys Hermes reads at runtime; their values live in Infisical, never in this repo.
required_secrets = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_HOME_CHANNEL",
  "DISCORD_ALLOWED_USERS",
  "OPENROUTER_API_KEY",
]
```

Adding agent #3:
1. Copy `ifrit.toml` → `<name>.toml`, change `name`, `fly_app`, `infisical_path`.
2. Create the Infisical folder + machine identity (manual UI, see §9).
3. `bun run summon <name>`.

That is the entire surface area for new-agent onboarding.

---

## 4. Launcher CLI surface

Run via `bun run` (or `bun src/cli.ts ...`). Help-style listing:

```
agents-summoner — control plane for Hermes agents

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
  logs    <agent>     Tail `fly logs --app <fly_app>`.
  status  <agent>     Show machine state, last restart, region, volume attachment.
  destroy <agent>     Destroy Fly app + volume. Confirms with the agent's name typed back.
                      Does NOT touch Infisical.
  list                List all agents/*.toml, with provisioning status from Fly.
  doctor              Verify FLY_API_TOKEN, flyctl installed, Infisical bootstrap creds
                      present in env, every agent config parseable.
```

`summon` is the headline workflow. `deploy` exists for the iterate-on-config / rebuild-image case. `secrets` is broken out so an operator can rotate the Infisical machine identity without redeploying.

`<agent>` always resolves to `agents/<agent>.toml`. No flags, no other selection mechanism.

---

## 5. Secrets flow

Two distinct stores; do not confuse them.

```
                    ┌──────────────────────────────────────┐
                    │   Operator's local machine           │
                    │   .env: FLY_API_TOKEN,               │
                    │         INFISICAL_CLIENT_ID_IFRIT,   │
                    │         INFISICAL_CLIENT_SECRET_     │
                    │           IFRIT,                     │
                    │         INFISICAL_PROJECT_ID         │
                    └──────────────┬───────────────────────┘
                                   │ bun run summon ifrit
                                   │ (launcher reads .env, calls flyctl)
                                   ▼
                    ┌──────────────────────────────────────┐
                    │   Fly app: hermes-ifrit              │
                    │   Fly secrets (env vars at boot):    │
                    │     INFISICAL_CLIENT_ID              │
                    │     INFISICAL_CLIENT_SECRET          │
                    │     INFISICAL_PROJECT_ID             │
                    └──────────────┬───────────────────────┘
                                   │ container starts, runs entrypoint.sh
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │   entrypoint.sh                                   │
              │     1. POST /api/v1/auth/universal-auth/login    │
              │        (clientId+secret → INFISICAL_TOKEN)       │
              │     2. exec infisical run \                      │
              │          --token "$INFISICAL_TOKEN" \            │
              │          --projectId "$INFISICAL_PROJECT_ID" \   │
              │          --env=prod --path=/ifrit \              │
              │          -- /opt/hermes/docker/entrypoint.sh \   │
              │             hermes discord                       │
              └──────────────┬───────────────────────────────────┘
                             │ infisical run injects:
                             │   DISCORD_BOT_TOKEN
                             │   DISCORD_HOME_CHANNEL
                             │   DISCORD_ALLOWED_USERS
                             │   OPENROUTER_API_KEY
                             ▼
                    ┌──────────────────────────────────────┐
                    │   Hermes process (PID 1, via tini)   │
                    └──────────────────────────────────────┘
```

Key properties:
- The repo never sees per-agent runtime secrets. Discord token, OpenRouter key, etc. only exist in Infisical.
- Fly only holds three values per app: the Infisical machine identity creds + project id. Compromise of the Fly app surfaces only the scoped Infisical identity, which can read only `/<agent>`.
- Secret rotation: rotate in Infisical → `fly machine restart -a hermes-ifrit` → entrypoint re-fetches. No redeploy needed.
- Bootstrap rotation: regenerate Infisical machine identity → `bun run secrets ifrit` → Fly auto-restarts.

**Decision (Q4):** Infisical CLI wrapper inside the container, not the Bun SDK. Reasoning: keeps the launcher minimal (it only orchestrates Fly), keeps Hermes' image self-contained (one entrypoint owns the secret fetch), and matches the integration-expert's recommendation. Revisit the SDK approach if we need (a) partial-failure semantics, (b) in-process rotation without restart, or (c) the launcher to lint Infisical secret completeness against `required_secrets` before deploy. Item (c) is appealing — log it as a future ticket.

---

## 6. Container build strategy (Q2 decision)

**Decision: build from source via multi-stage Dockerfile, pinning the Hermes git ref from the agent config.**

`hermes/Dockerfile` (sketch):

```dockerfile
# Stage 1: clone Hermes at the pinned ref
FROM debian:13.4-slim AS source
ARG HERMES_GIT_REF=main
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/NousResearch/hermes-agent /src \
  && cd /src && git checkout "$HERMES_GIT_REF"

# Stage 2: build the upstream Hermes image, but using our cloned source
FROM debian:13.4
COPY --from=source /src /opt/hermes
# Reproduce the upstream Dockerfile's apt/uv setup here, OR docker build the upstream
# Dockerfile directly via `fly deploy --build-arg` — see entrypoint discussion below.

# Add Infisical CLI
RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash \
  && apt-get install -y infisical jq curl \
  && rm -rf /var/lib/apt/lists/*

ENV INFISICAL_DISABLE_UPDATE_CHECK=true

COPY entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY config.yaml /opt/hermes-defaults/config.yaml
RUN chmod +x /usr/local/bin/agent-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]
CMD ["hermes", "discord"]
```

Operationally, the cleanest path is to **use upstream's Dockerfile as the base** rather than re-derive it: a one-liner stage that does `git clone … && docker build` won't work, but we can `FROM ghcr.io/nousresearch/hermes-agent:<tag>` if the image gets published, **or** copy the upstream Dockerfile into our repo and add our entrypoint + Infisical CLI on top. The first ticket (Hermes-probe-in-docker) will resolve which path is real.

**Tradeoff documented:**
- Pro: reproducible (SHA-pinned), no dependency on an unverified GHCR tag, full control of base image + Infisical CLI install.
- Con: first deploy is multi-minute (Debian + Python + uv layers compile). Mitigation: Fly remote builder caches layers; per-agent rebuild only fires when `hermes_git_ref` changes.
- Con: we shadow upstream's Dockerfile. If upstream changes their build, our copy drifts. Mitigation: Track upstream weekly via dependabot-equivalent ticket; for v1 we accept drift.

**Open: revisit if upstream publishes a stable image.** Probing this is ticket #1.

---

## 7. Deploy flow — `bun run summon ifrit`

Numbered steps the launcher executes. Each is idempotent on its own.

1. **Parse config.** `agents/ifrit.toml` → typed object. Fail fast on missing fields.
2. **Doctor checks.** `FLY_API_TOKEN`, `INFISICAL_CLIENT_ID_IFRIT`, `INFISICAL_CLIENT_SECRET_IFRIT`, `INFISICAL_PROJECT_ID` present in env. `flyctl` on PATH.
3. **Render fly.toml.** Substitute `{{APP_NAME}}` and `{{PRIMARY_REGION}}` from config into `fly/fly.toml.tmpl`, write to a tempdir alongside `hermes/Dockerfile`, `entrypoint.sh`, `config.yaml`.
4. **Ensure app exists.** `flyctl apps list --json | jq` for `hermes-ifrit`. If missing: `flyctl apps create hermes-ifrit --org <org>`.
5. **Ensure volume exists.** `flyctl volumes list --app hermes-ifrit --json`. If no volume named `hermes_data` in `primary_region`: `flyctl volumes create hermes_data --app hermes-ifrit --region ord --size 10 --yes`.
6. **Push bootstrap secrets.** `flyctl secrets set --app hermes-ifrit --stage INFISICAL_CLIENT_ID=… INFISICAL_CLIENT_SECRET=… INFISICAL_PROJECT_ID=… INFISICAL_PATH=/ifrit INFISICAL_ENV=prod`. (Stage so the next step's deploy applies them atomically.)
7. **Build + deploy.** `flyctl deploy --app hermes-ifrit --config <tempdir>/fly.toml --dockerfile <tempdir>/Dockerfile --build-arg HERMES_GIT_REF=<ref> --strategy immediate`.
8. **Verify.** `flyctl status --app hermes-ifrit --json` until machine state is `started`. Tail `flyctl logs --app hermes-ifrit` for ~30 seconds, look for `Discord` connection log line. Print summary.

Re-running `summon` on an already-deployed agent is safe: steps 4 and 5 detect existing resources, step 6 stages identical secrets (no-op restart), step 7 rebuilds and rolls.

---

## 8. Observability

**v1 is deliberately minimal — no metrics, no alerting.** The story is:

- **Logs:** `bun run logs ifrit` → `flyctl logs --app hermes-ifrit`. Hermes' `PYTHONUNBUFFERED=1` ensures stdout is line-buffered. Discord connection events, model calls, errors all surface here.
- **Restart visibility:** `bun run status ifrit` shows machine state and `last_restart_at`. Crash-loops are visible as repeated restarts in `fly status`.
- **Discord ping:** the agent itself is the smoke test. If Ifrit responds in `DISCORD_HOME_CHANNEL`, it's healthy.

Explicitly deferred:
- HTTP healthcheck endpoint. Hermes ships none; adding a sidecar is overkill for v1. Restart-on-failure (`retries=10`) is the safety net.
- Structured log aggregation (Logtail, Datadog, etc.).
- Metrics on token usage / OpenRouter spend.

---

## 9. Manual setup checklist (for the operator, in order)

This is what the user does **once** before any `summon` command works. Engineer-1 should pair through this.

1. **Sign up / log in:**
   - Fly.io account, install `flyctl`, `flyctl auth login`.
   - Infisical Cloud account.
   - Discord developer account.
   - OpenRouter account, top up credits.

2. **Discord — per agent:**
   - Discord Developer Portal → New Application → name "Ifrit".
   - Bot tab → reset token → copy `DISCORD_BOT_TOKEN`.
   - Bot tab → enable `MESSAGE CONTENT INTENT`.
   - OAuth2 → URL Generator → scopes `bot`, permissions `Send Messages`, `Read Message History`, `Add Reactions`.
   - Open generated URL in browser, install bot into the shared server.
   - Copy the home channel ID (Discord → Settings → Advanced → Developer Mode → right-click channel → Copy ID) → `DISCORD_HOME_CHANNEL`.
   - Note your own user ID → `DISCORD_ALLOWED_USERS` (comma-separated for multiple).

3. **OpenRouter:**
   - Generate API key → `OPENROUTER_API_KEY`. Same key works for both agents (single billing account).

4. **Infisical — once:**
   - Create one project (e.g., "agents-summoner").
   - Note the project ID → `INFISICAL_PROJECT_ID` (this is shared across all agents).
   - Confirm `prod` environment exists (default).

5. **Infisical — per agent:**
   - Create folder `/ifrit` in the `prod` environment.
   - Add four secrets in `/ifrit`: `DISCORD_BOT_TOKEN`, `DISCORD_HOME_CHANNEL`, `DISCORD_ALLOWED_USERS`, `OPENROUTER_API_KEY`.
   - Settings → Access Control → Machine Identities → create `ifrit-machine-id` with auth method = Universal Auth.
   - Assign it the lowest project role available (`viewer`).
   - **Add an Additional Privilege scoped to `secretPath: /ifrit`** with `read` permission. (UI mechanics partially documented; see `.team/research/infisical.md` Open Question #1. Engineer-1 verifies during ticket walk-through.)
   - Generate client secret → copy `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`.

6. **Fly API token (for the launcher):**
   - `flyctl tokens create deploy` (or via the dashboard) → set as `FLY_API_TOKEN` in local `.env`. The launcher reads this; it does not use the interactive `flyctl auth login` session.

7. **Local `.env`:**
   ```
   FLY_API_TOKEN=...
   INFISICAL_PROJECT_ID=...
   INFISICAL_CLIENT_ID_IFRIT=...
   INFISICAL_CLIENT_SECRET_IFRIT=...
   ```
   Per-agent suffix lets `bun run summon shiva` later read `INFISICAL_CLIENT_ID_SHIVA` from the same `.env` without confusion.

8. **First run:** `bun run summon ifrit`. Watch logs. Send `@Ifrit hello` in Discord home channel.

---

## 10. Risks & open items

- **Hermes CLI invocation.** `hermes discord` is inferred, not source-confirmed. Ticket #1 probes the actual subcommand inside the upstream image before we finalize `entrypoint.sh`. Reading research file `.team/research/hermes.md` Open Question #1.
- **Infisical folder-scoped privilege.** The exact UI/API path for an Additional Privilege scoped to a `secretPath` is partially documented. Risk that we discover during setup that the privilege model can't enforce per-folder isolation as described. Mitigation: ticket #4 includes a verification step (try to read `/shiva` with the `ifrit-machine-id` token; expect 403). If it fails, fallback is one Infisical project per agent — minor refactor of `agents/<name>.toml` to add `infisical_project_id`.
- **Build time.** First `summon` may take 5–10 min on a remote builder. Subsequent deploys cache.
- **Volume zone affinity.** A volume in `ord` pins the machine to `ord`. If we destroy the machine, the new one must come up in the same region. Launcher's `destroy` command must remove the volume explicitly to avoid orphan storage charges.
- **No SDK-side secret completeness check.** Today, missing `OPENROUTER_API_KEY` in Infisical surfaces only when Hermes errors at runtime. Future ticket: launcher uses Infisical SDK to list `/<agent>` and verify `required_secrets` pre-deploy. Worth doing before Shiva to catch typos.

---

## 11. Phase 2 (Shiva) — what's different

Literally:
1. `cp agents/ifrit.toml agents/shiva.toml`, edit `name`, `fly_app`, `infisical_path`.
2. Repeat checklist §9 step 2 (Discord bot per agent) and §9 step 5 (Infisical folder + machine identity per agent).
3. Add `INFISICAL_CLIENT_ID_SHIVA` and `INFISICAL_CLIENT_SECRET_SHIVA` to local `.env`.
4. `bun run summon shiva`.

If anything else has to change, the design failed. Treat that as a bug.
