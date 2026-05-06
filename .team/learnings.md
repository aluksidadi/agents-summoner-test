# Hermes Integration Learnings

## T01: Hermes CLI probe (2026-05-06)

Upstream SHA probed: `b62a82e0c3fbcdf219824c1512de180bae8a125c`

### CLI invocation

**`hermes discord` does NOT exist.** The research dossier and DESIGN.md §5/§10 are wrong.

The correct command to run the Discord gateway in a container (foreground, for Docker / Fly) is:

```
hermes gateway run
```

- `hermes gateway` manages the messaging gateway (Discord, Telegram, WhatsApp, etc.).
- `hermes gateway run` runs it in foreground — the correct mode for containers.
- `hermes gateway start/stop/install` are for systemd/launchd service management on a host; not applicable to Docker.

The upstream `entrypoint.sh` ends with `exec hermes "$@"`, so passing `gateway run` as CMD args is correct:

```dockerfile
CMD ["gateway", "run"]
```

### Environment variables (Discord)

All read via `os.getenv` from the process environment or `$HERMES_HOME/.env` (dotenv):

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Read by `gateway/config.py:1119` |
| `DISCORD_ALLOWED_USERS` | Yes | Comma-separated user IDs; read by `gateway/platforms/discord.py` |
| `DISCORD_HOME_CHANNEL` | Yes | Read by `gateway/config.py:1126`; used for cron delivery |
| `OPENROUTER_API_KEY` | Yes | Read by `cli.py`; also falls back to `OPENAI_API_KEY` |
| `DISCORD_HOME_CHANNEL_NAME` | No | Display label (default "Home") |
| `DISCORD_HOME_CHANNEL_THREAD_ID` | No | Thread ID if home channel is a thread |
| `DISCORD_REQUIRE_MENTION` | No | Overrides config.yaml `require_mention` |
| `DISCORD_FREE_RESPONSE_CHANNELS` | No | Channels that bypass mention check |
| `DISCORD_AUTO_THREAD` | No | Overrides config.yaml `auto_thread` |
| `DISCORD_REACTIONS` | No | Overrides config.yaml `reactions` |
| `DISCORD_IGNORED_CHANNELS` | No | Channel IDs to ignore |
| `DISCORD_ALLOWED_CHANNELS` | No | Whitelist; empty = all |
| `DISCORD_ALLOWED_ROLES` | No | Role IDs that bypass user allowlist |

### Docker Hub image availability

Image is **published on Docker Hub** as `nousresearch/hermes-agent:latest` (not GHCR).

- Workflow: `.github/workflows/docker-publish.yml` pushes to Docker Hub on push to `main` and on release tags.
- GHCR (`ghcr.io/nousresearch/hermes-agent`) is **not published** — pull returns 403.
- Image size: ~6.3 GB uncompressed. Build from source matches Docker Hub image (Debian 13.4 + Python 3.13 + uv + Node + ffmpeg + Playwright chromium).

### Build strategy implication (DESIGN §6)

Since `nousresearch/hermes-agent:latest` exists on Docker Hub, the `FROM nousresearch/hermes-agent:<tag>` path is viable for `hermes/Dockerfile`. This avoids re-deriving the upstream build. Our Dockerfile only needs to add Infisical CLI and our `entrypoint.sh` on top.

Recommended Dockerfile structure:
```dockerfile
FROM nousresearch/hermes-agent:<sha-pinned-tag>
RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash \
  && apt-get install -y infisical && rm -rf /var/lib/apt/lists/*
ENV INFISICAL_DISABLE_UPDATE_CHECK=true
COPY entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY config.yaml /tmp/hermes-config-default.yaml
RUN chmod +x /usr/local/bin/agent-entrypoint.sh
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/agent-entrypoint.sh"]
CMD ["gateway", "run"]
```

### Startup log line to watch for

When the gateway connects to Discord, look for a log line containing `Discord` and `connected` or `logged in`. The `PYTHONUNBUFFERED=1` env var (set in upstream Dockerfile) ensures immediate log flushing.

### Design deviations found

1. **`hermes discord` → `hermes gateway run`** — load-bearing change for `entrypoint.sh` and `hermes/Dockerfile` CMD. Architect must be notified.
2. **GHCR → Docker Hub** — `FROM ghcr.io/nousresearch/hermes-agent` in DESIGN §6 sketch is wrong; correct registry is `docker.io/nousresearch/hermes-agent`.
