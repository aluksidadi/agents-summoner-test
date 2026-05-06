# Fly.io — Integration Dossier

Sources:
- https://fly.io/docs/reference/configuration/
- https://fly.io/docs/launch/deploy/
- https://fly.io/docs/launch/create/
- https://fly.io/docs/apps/secrets/
- https://fly.io/docs/flyctl/logs/
- https://fly.io/docs/machines/overview/
- https://fly.io/docs/machines/guides-examples/machine-sizing/

---

## fly.toml for a Long-Running Discord Bot (No Public HTTP)

A Discord bot only makes outbound connections — no ingress required. Omit all
`[http_service]` and `[[services]]` sections. Fly will not assign a public IP or
hostname to the app.

```toml
app       = "hermes-ifrit"          # one app per agent
primary_region = "ord"              # or whichever region is cheapest / lowest latency

[build]
  # Use the Hermes Docker image built from source, or a pre-built image:
  # image = "ghcr.io/nousresearch/hermes-agent:latest"
  dockerfile = "Dockerfile"         # if building locally

[processes]
  worker = "hermes discord"         # the long-running gateway process

[env]
  PYTHONUNBUFFERED = "1"
  HERMES_HOME      = "/opt/data"

[[restart]]
  policy  = "on-failure"
  retries = 10
  processes = ["worker"]

[[vm]]
  size    = "shared-cpu-1x"
  memory  = "512mb"
  processes = ["worker"]

[[mounts]]
  source      = "hermes_data"       # volume name (must exist; see below)
  destination = "/opt/data"
  processes   = ["worker"]
```

**No `[[services]]` block = no public listener.** The machine has only outbound
internet access.
Source: https://fly.io/docs/reference/configuration/ — "Apps cannot be reached from
the public internet without a services or http_service section."

---

## Machine Sizing

| Size preset | vCPU | RAM | Notes |
|---|---|---|---|
| `shared-cpu-1x` | 1 shared | 256 MB default / up to 2 GB | Cheapest; fine for idle bots |
| `shared-cpu-2x` | 2 shared | 512 MB default / up to 4 GB | Good default for Hermes |
| `performance-1x` | 1 dedicated | 2 GB | Overkill for a Discord bot |

For a Hermes agent: **`shared-cpu-1x` with `memory = "512mb"`** is the recommended
starting point. Hermes is a Python process; memory usage depends on active tools and
model context size. Scale up if OOM-killed.

Source: https://fly.io/docs/machines/guides-examples/machine-sizing/

---

## Restart / Auto-Rollback Policy

```toml
[[restart]]
  policy  = "on-failure"   # always | never | on-failure
  retries = 10
  processes = ["worker"]
```

Fly restart policies follow Docker conventions. `on-failure` restarts only on non-zero
exit. `retries` caps consecutive restart attempts.

`auto_rollback` (in `fly deploy --strategy`) reverts to the previous image if the
new deployment doesn't pass health checks. For a process with no HTTP health check,
Fly considers the machine healthy once it starts without immediately crashing. Set
`retries` conservatively to avoid a crash-loop deploying bad code.

Source: https://fly.io/docs/reference/configuration/ (restart section)

---

## Secrets Injection

Fly encrypts secrets at the API layer; the host agent decrypts and injects them as
**environment variables at machine boot time**. The app never touches the encrypted
vault directly.

```
fly secrets set KEY=value [--app <app-name>]
```

Running `fly secrets set` **always triggers a machine restart** (new deployment).
Secrets cannot be updated without restarting the machine.

Source: https://fly.io/docs/apps/secrets/

### Infisical credentials stored as Fly secrets

For Option A (CLI wrapper entrypoint):
```bash
fly secrets set \
  INFISICAL_CLIENT_ID="<id>" \
  INFISICAL_CLIENT_SECRET="<secret>" \
  INFISICAL_PROJECT_ID="<proj-id>" \
  --app hermes-ifrit
```

For Option B (SDK in launcher), the same three secrets are used by the launcher
before spawning the Hermes container.

---

## flyctl Command Reference

### Create a new app (without immediate deploy)

```bash
fly apps create hermes-ifrit --org <org-slug>
# or interactively:
fly launch --name hermes-ifrit --no-deploy
```

`fly launch` scans for a Dockerfile and generates a `fly.toml`. Use `--no-deploy` to
review/edit before first deploy.

### Create a persistent volume

Volumes must be created before the first deploy referencing them:

```bash
fly volumes create hermes_data \
  --app hermes-ifrit \
  --region ord \
  --size 10    # GB
```

### Deploy

```bash
fly deploy --app hermes-ifrit
# or from a directory with fly.toml:
fly deploy
```

Standard pattern: run from the directory containing the `fly.toml` and `Dockerfile`.
Override app name with `--app <name>` if deploying to a different app than the
`fly.toml` declares.

Deploy strategies: `--strategy immediate` (default for workers), `--strategy rolling`,
`--strategy canary`, `--strategy bluegreen`.

### Set / update secrets

```bash
fly secrets set KEY=value KEY2=value2 --app hermes-ifrit
# Stage without restart (batch multiple changes):
fly secrets set KEY=value --app hermes-ifrit --stage
fly secrets deploy --app hermes-ifrit   # apply staged secrets
```

### Tail logs

```bash
fly logs --app hermes-ifrit
fly logs --app hermes-ifrit --machine <machine-id>   # filter by machine
fly logs --app hermes-ifrit --region ord              # filter by region
fly logs --app hermes-ifrit --no-tail                # dump buffered only
```

Source: https://fly.io/docs/flyctl/logs/

### List machines

```bash
fly machine list --app hermes-ifrit
```

### Restart a machine (e.g., to pick up new Infisical secrets)

```bash
fly machine restart <machine-id> --app hermes-ifrit
```

---

## Deploying from a Directory vs Other Patterns

**Standard pattern:** `fly deploy` from the directory containing `fly.toml` +
`Dockerfile`. This is the documented approach for `fly launch`-based apps.

**Alternative:** `fly machine run <image>` for one-off machines without a `fly.toml`.
Not recommended for managed, long-running services — harder to update and lacks
rollback.

**CI/CD:** `fly deploy` is designed to be called from CI (GitHub Actions, etc.) using
a `FLY_API_TOKEN` environment variable for authentication.

---

## Per-Agent App Pattern

Each Hermes agent (`hermes-ifrit`, `hermes-shiva`) is a **separate Fly app** with its
own:
- `fly.toml` (different `app` name)
- Fly secrets (`INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`)
- Fly volume (`hermes_data` scoped to its app)
- Machine

This matches the project's design decision (one Fly app per agent).

---

## Open Questions

1. **Hermes Docker image availability** — If `ghcr.io/nousresearch/hermes-agent` is
   not published with a stable tag, the launcher must build from source on every
   deploy (`fly deploy --dockerfile Dockerfile`). Build times will be significant
   given the image size. Consider caching or a pre-build step in CI.

2. **Volume + deploy interaction** — Fly volumes are zone-affine. A volume in `ord`
   binds the machine to that zone. If the machine is destroyed and recreated in a
   different zone, the volume may not attach. Use `fly volumes list` to verify zone
   consistency.

3. **Health check for process restart** — With no HTTP endpoint, Fly's default health
   check is process-alive only. A crashed Hermes that stays running (e.g., stuck in
   an infinite retry loop) will not be detected. Consider instrumenting a simple TCP
   or HTTP keepalive in the Hermes `HERMES_DASHBOARD` or a sidecar if uptime SLAs
   matter.

4. **`flyctl` auth in launcher** — The Bun launcher CLI will call `fly` commands. It
   needs `FLY_API_TOKEN` set, not the interactive `fly auth login` flow. Document this
   in the launcher's README / CLAUDE.md.
