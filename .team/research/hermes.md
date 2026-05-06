# Hermes Agent — Integration Dossier

Sources: https://github.com/NousResearch/hermes-agent,
https://raw.githubusercontent.com/NousResearch/hermes-agent/main/Dockerfile,
https://raw.githubusercontent.com/NousResearch/hermes-agent/main/docker/entrypoint.sh,
https://raw.githubusercontent.com/NousResearch/hermes-agent/main/pyproject.toml

---

## Runtime Shape

Hermes is a **Python 3.11+ application** (not a binary, not Node). The repo ships a
`Dockerfile` and `docker-compose.yml`. The recommended way to run it in containers is
the provided Docker image.

### Base image (Dockerfile, final stage)

```
debian:13.4
```

Multi-stage build pulls from:
- `ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie` (Python / uv layer)
- `tianon/gosu:1.19-trixie` (privilege-dropping helper)

System packages installed: `build-essential curl nodejs npm python3 ripgrep ffmpeg gcc
python3-dev libffi-dev procps git openssh-client docker-cli tini`

Image is therefore **not small** — Debian base + Node + ffmpeg + Python build tools.
Expect compressed image > 600 MB. Plan accordingly for cold-start times.

### Entrypoint

```
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/opt/hermes/docker/entrypoint.sh"]
```

`tini` reaps zombie subprocesses (MCP stdio, git, bun) that accumulate when Hermes
runs as PID 1. Do not replace the entrypoint.

The `entrypoint.sh` script:
1. Remaps UID/GID if started as root (via `gosu`)
2. Creates data dirs under `HERMES_HOME` (`/opt/data` by default)
3. Copies `.env.example` → `.env` and `cli-config.yaml.example` → `config.yaml` if
   those files do not exist yet
4. Syncs bundled skills
5. Optionally starts a dashboard process
6. Execs the requested command (e.g., `hermes discord`)

### CLI entry points (from `pyproject.toml`)

| Command | Purpose |
|---|---|
| `hermes` | Main CLI / TUI |
| `hermes-agent` | Run agent directly (headless) |
| `hermes-acp` | ACP adapter (Agent Client Protocol) |

To run the Discord gateway: `hermes discord`

### Working directory / volume

- App lives at `/opt/hermes`
- **Persistent data volume:** `/opt/data` — stores skills, sessions, memories,
  conversation history, config, logs. **Requires a Fly volume or equivalent persistent
  storage.**

---

## Required Environment Variables

### Discord (all three are required for a Discord bot)

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_ALLOWED_USERS` | Comma-separated Discord user IDs permitted to interact |
| `DISCORD_HOME_CHANNEL` | Channel ID for cron job / notification delivery |

Optional Discord tuning:

| Variable | Description |
|---|---|
| `DISCORD_HOME_CHANNEL_NAME` | Human-readable name (display only) |
| `DISCORD_REPLY_TO_MODE` | `off` / `first` / `all` — threading behavior |

### LLM Provider — OpenRouter

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

No additional base-URL override is needed; Hermes natively supports OpenRouter as a
first-class provider. In `cli-config.yaml` set:

```yaml
model: "openrouter/anthropic/claude-opus-4.6"  # or any openrouter/* model string
provider: auto   # credential-based detection picks OpenRouter automatically
```

Alternatively, force it with the `--model openrouter/<model>` flag when invoking
`hermes discord`.

### Runtime / container vars (set by Docker image, usually leave as-is)

| Variable | Default | Purpose |
|---|---|---|
| `HERMES_HOME` | `/opt/data` | Data directory root |
| `HERMES_UID` / `HERMES_GID` | `10000` | UID remapping at start |
| `HERMES_DASHBOARD` | unset | Set to `1` to enable web dashboard |
| `HERMES_DASHBOARD_PORT` | `9119` | Dashboard port if enabled |
| `PYTHONUNBUFFERED` | `1` | Ensures log lines are flushed immediately |

---

## Config Files

Two files are read from `HERMES_HOME` at startup. The entrypoint bootstraps them from
examples if absent:

- **`.env`** — environment variable overrides (dotenv format). All `DISCORD_*`,
  `OPENROUTER_API_KEY`, etc. can go here **or** in the container environment. Container
  env takes precedence.
- **`config.yaml`** — behavioural tuning. Discord-specific section:

```yaml
discord:
  require_mention: true           # require @bot in server channels
  free_response_channels: ""      # channel IDs that bypass mention check
  allowed_channels: ""            # whitelist; empty = all channels
  auto_thread: false
  reactions: true                 # 👀/✅/❌ reaction indicators
  reply_to_mode: "all"            # off | first | all
```

The config file lives on the **persistent volume** (`/opt/data/config.yaml`). For
ephemeral Fly deployments, either bake a custom `config.yaml` into the image or
inject it at runtime via an environment variable indirection.

---

## Persistent State

| Path | Contents | Required? |
|---|---|---|
| `/opt/data/skills/` | Learned skills | Yes — loses all learned behaviour on wipe |
| `/opt/data/.sessions/` | Conversation history + FTS index | Yes — loses memory |
| `/opt/data/.memories/` | User profile data | Yes |
| `/opt/data/.env` | Runtime config overrides | Bootstrapped from example |
| `/opt/data/config.yaml` | Behavioural config | Bootstrapped from example |

**A Fly volume mounted at `/opt/data` is required.** Without it the container is
stateless and Hermes loses all learned context on each deploy/restart.

---

## Health Check Endpoint

The Dockerfile **exposes no ports** and the Discord gateway process has no HTTP health
endpoint by default. The optional dashboard listens on `HERMES_DASHBOARD_PORT` (9119)
but is a web UI, not a health probe.

**Fly health check recommendation:** use the process-based `fly.toml` restart policy
(`on-failure`) instead of an HTTP check. There is no documented `/health` or
`/readyz` endpoint.

---

## Open Questions

1. **Discord gateway command** — the `hermes discord` subcommand was inferred from
   CLI structure and config; the raw `discord_gateway.py` file returned 404 from
   GitHub, so the exact invocation is not verified from source. Confirm with
   `hermes --help` inside the container.

2. **Image on GHCR** — the repo references a Docker image but the canonical
   published image tag (e.g., `ghcr.io/nousresearch/hermes-agent:latest`) was not
   confirmed. If no pre-built image exists, you must build from source. Check
   `docker/` directory and the repo's GitHub Actions workflows.

3. **Config on ephemeral container** — because `config.yaml` lives on the volume,
   first-boot configuration (model selection, Discord channel whitelist) needs either
   a pre-populated volume snapshot or a startup script that writes the file before
   `hermes discord` runs.
