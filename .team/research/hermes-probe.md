# T01 — Hermes CLI Probe Results

**Date:** 2026-05-06
**Upstream SHA probed:** `b62a82e0c3fbcdf219824c1512de180bae8a125c`
**Upstream version:** Hermes Agent v0.12.0 (2026.4.30)

---

## 1. CLI Invocation — DESIGN §10 risk #1 RESOLVED

**Finding: `hermes discord` does NOT exist. The correct command is `hermes gateway run`.**

The upstream `hermes --help` lists these subcommands:
```
{chat,model,fallback,gateway,setup,whatsapp,slack,...}
```

There is no `discord` subcommand. Discord is one of several platforms handled by the unified **gateway**. The correct foreground invocation (confirmed in `docker-compose.yml` and `hermes gateway --help`) is:

```
hermes gateway run
```

The upstream `docker-compose.yml` gateway service uses exactly:
```yaml
command: ["gateway", "run"]
```

Since the upstream `docker/entrypoint.sh` ends with `exec hermes "$@"`, passing `gateway run` as the CMD to `docker run` results in:
```
exec hermes gateway run
```

**Impact on DESIGN §5 / entrypoint.sh:** The `CMD` in our `hermes/Dockerfile` and the final `exec` line in `hermes/entrypoint.sh` must use `hermes gateway run`, not `hermes discord`. This is a plan deviation — see §6 below.

---

## 2. Published Image — DESIGN §6 open question RESOLVED

**Finding: Image is published to Docker Hub, NOT GHCR. GHCR returns `denied`.**

- `docker pull nousresearch/hermes-agent:latest` — **SUCCESS** (public)
- `docker pull ghcr.io/nousresearch/hermes-agent:latest` — `denied` (private or absent)

The CI workflow (`.github/workflows/docker-publish.yml`) confirms:
- Pushes to Docker Hub on every `main` branch push and on releases
- Tags: `nousresearch/hermes-agent:latest` (main) and `nousresearch/hermes-agent:<version-tag>` (release)
- No GHCR push step exists

**Impact on DESIGN §6:** We can use `FROM nousresearch/hermes-agent:latest` (or a pinned version tag) instead of building from source. This eliminates the multi-minute cold-start build. However, we cannot pin to an immutable SHA digest without a release tag — `latest` is mutable. Recommendation: pin to a version tag (e.g. `nousresearch/hermes-agent:v0.12.0`) and track upstream releases.

---

## 3. Base Image & Entrypoint Contract

From the upstream `Dockerfile`:
- **Final base:** `debian:13.4`
- **PID 1:** `/usr/bin/tini -g -- /opt/hermes/docker/entrypoint.sh`
- **Do not override** `ENTRYPOINT` — `tini` is required for zombie-process reaping (MCP stdio, git, bun subprocesses)

The upstream entrypoint (`docker/entrypoint.sh`):
1. Drops root to `hermes` user (UID 10000) via `gosu`
2. Creates `$HERMES_HOME` directory structure
3. Bootstraps `$HERMES_HOME/.env` from `.env.example` if absent
4. Bootstraps `$HERMES_HOME/config.yaml` from `cli-config.yaml.example` if absent
5. Bootstraps `$HERMES_HOME/SOUL.md` from `docker/SOUL.md` if absent
6. Syncs bundled skills
7. Optionally starts dashboard as background process
8. `exec hermes "$@"`

**Key invariant:** The entrypoint bootstraps `config.yaml` only if absent. Our `hermes/entrypoint.sh` wrapper runs **before** upstream's entrypoint, so we cannot write `config.yaml` after the gosu drop. Options:
- Pre-populate `$HERMES_HOME/config.yaml` on the volume before first boot via a separate init step
- Or use environment variables for all configuration (env vars override `config.yaml`)
- Or inject via our wrapper by writing before calling upstream's entrypoint

---

## 4. Required Environment Variables (Discord mode)

All confirmed from source (`gateway/config.py`, `gateway/platforms/discord.py`):

### Required (bot will not start without these)
| Variable | Source | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | `gateway/config.py:1119` | Bot token from Discord Developer Portal |
| `OPENROUTER_API_KEY` | `agent/credential_pool.py:1406` | LLM provider key |

### Required for intended behavior (warn-but-start if absent)
| Variable | Source | Notes |
|---|---|---|
| `DISCORD_HOME_CHANNEL` | `gateway/config.py:1126` | Channel ID for cron/notifications |
| `DISCORD_ALLOWED_USERS` | `gateway/platforms/discord.py:573` | Comma-separated user IDs; empty = all users |

### Optional tuning (all have defaults)
| Variable | Default | Notes |
|---|---|---|
| `DISCORD_REQUIRE_MENTION` | `true` (from config.yaml) | Require @bot in server channels |
| `DISCORD_REPLY_TO_MODE` | `all` (from config.yaml) | `off` / `first` / `all` |
| `DISCORD_REACTIONS` | `true` (from config.yaml) | 👀/✅/❌ reaction indicators |
| `DISCORD_AUTO_THREAD` | `false` (from config.yaml) | Auto-create threads |
| `DISCORD_FREE_RESPONSE_CHANNELS` | unset | Channel IDs bypassing mention check |
| `DISCORD_ALLOWED_CHANNELS` | unset | Whitelist; empty = all channels |
| `DISCORD_HOME_CHANNEL_NAME` | `"Home"` | Human-readable name |
| `DISCORD_ALLOWED_ROLES` | unset | Role-based access control |
| `HERMES_HOME` | `/opt/data` | Data directory root |
| `HERMES_UID` / `HERMES_GID` | `10000` | UID remapping |
| `PYTHONUNBUFFERED` | `1` | Log flushing (set in Dockerfile) |

**The four secrets in `required_secrets` (`DISCORD_BOT_TOKEN`, `DISCORD_HOME_CHANNEL`, `DISCORD_ALLOWED_USERS`, `OPENROUTER_API_KEY`) are correct and sufficient for a functioning bot.**

### Model configuration
Model is NOT read from env vars at runtime — it is read from `$HERMES_HOME/config.yaml`. The relevant stanza:
```yaml
model:
  default: "openrouter/anthropic/claude-opus-4.6"
  provider: "auto"
  base_url: "https://openrouter.ai/api/v1"
```
This means our `hermes/config.yaml` must set the model here, not via an env var. The config is bootstrapped to `$HERMES_HOME/config.yaml` by the upstream entrypoint on first boot only — subsequent boots use the volume copy.

---

## 5. Persistent Volume

- Mount point: `/opt/data` (`HERMES_HOME`)
- Required contents: `skills/`, `.sessions/`, `.memories/`, `.env`, `config.yaml`, `SOUL.md`
- All bootstrapped by upstream entrypoint on first boot
- **The Fly volume at `/opt/data` is mandatory** — confirmed

---

## 6. Plan Deviations from DESIGN

### Deviation 1 — CLI command: `hermes discord` → `hermes gateway run`
**Affects:** `hermes/Dockerfile` CMD, `hermes/entrypoint.sh` final exec line, DESIGN §5 diagram, DESIGN §10 risk #1

The entrypoint.sh `exec infisical run ... -- /opt/hermes/docker/entrypoint.sh hermes discord` must become:
```bash
exec infisical run ... -- /opt/hermes/docker/entrypoint.sh gateway run
```
Because upstream's entrypoint does `exec hermes "$@"`, passing `gateway run` yields `hermes gateway run`.

### Deviation 2 — Image source: build-from-source → `FROM nousresearch/hermes-agent`
**Affects:** `hermes/Dockerfile`, DESIGN §6

A stable published image exists at `nousresearch/hermes-agent:latest` (and versioned tags like `v0.12.0`). Using it as the `FROM` base eliminates multi-minute build times and the risk of shadowing the upstream Dockerfile. Our Dockerfile becomes a thin layer that only adds the Infisical CLI and our entrypoint wrapper on top.

**Proposed Dockerfile sketch (replaces DESIGN §6 multi-stage):**
```dockerfile
FROM nousresearch/hermes-agent:0.12.0

# Add Infisical CLI on top of upstream image
RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash \
  && apt-get install -y infisical \
  && rm -rf /var/lib/apt/lists/*

ENV INFISICAL_DISABLE_UPDATE_CHECK=true

COPY entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY config.yaml /opt/hermes-defaults/config.yaml
RUN chmod +x /usr/local/bin/agent-entrypoint.sh

# Override upstream ENTRYPOINT to inject our Infisical wrapper first.
# tini is preserved — our entrypoint execs upstream's entrypoint.sh.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/agent-entrypoint.sh"]
CMD ["gateway", "run"]
```

Note: `tini` is already in the upstream image. Our entrypoint should call through to `/opt/hermes/docker/entrypoint.sh` after injecting secrets via `infisical run`.

### Impact on T7 and T8
- **T7 (Dockerfile):** Use `FROM nousresearch/hermes-agent:<tag>` as base; add Infisical CLI only
- **T8 (entrypoint.sh):** Final exec becomes `infisical run ... -- /opt/hermes/docker/entrypoint.sh gateway run`
- Both are strictly simpler than the DESIGN §6 sketch

---

## 7. Verification Checklist

- [x] Upstream SHA noted: `b62a82e0c3fbcdf219824c1512de180bae8a125c`
- [x] CLI invocation confirmed: `hermes gateway run` (NOT `hermes discord`)
- [x] Docker Hub image confirmed: `nousresearch/hermes-agent:latest` (public)
- [x] GHCR image status: `denied` / not publicly available
- [x] Full env var list enumerated from source
- [x] Plan deviations identified and documented
- [ ] Architect notified of deviations (see §6) — **pending**
