# Infisical — Integration Dossier

Sources:
- https://infisical.com/docs/documentation/platform/identities/universal-auth
- https://infisical.com/docs/documentation/platform/identities/machine-identities
- https://infisical.com/docs/cli/commands/run
- https://infisical.com/docs/sdks/languages/node
- https://infisical.com/docs/documentation/platform/access-controls/additional-privileges

---

## Universal Auth — Token Exchange Flow

Machine identities authenticate via two credentials:

| Credential | Env var (conventional) | Sensitivity |
|---|---|---|
| Client ID | `INFISICAL_CLIENT_ID` | Non-sensitive (like a username) |
| Client Secret | `INFISICAL_CLIENT_SECRET` | Sensitive (like a password) |

Exchange flow:

```
POST https://app.infisical.com/api/v1/auth/universal-auth/login
Content-Type: application/x-www-form-urlencoded

clientId=<id>&clientSecret=<secret>
```

Response:
```json
{ "accessToken": "...", "expiresIn": 7200, "tokenType": "Bearer" }
```

The resulting access token is passed to API calls or the CLI via `INFISICAL_TOKEN`.
Tokens expire in 2 hours by default; configure "Access Token Period" on the identity
for auto-renewal.

---

## Folder-Level Scoping

**The standard docs do not describe folder-level scoping via roles alone.** What is
documented:

- Machine identities receive a **project-level role** (e.g., `viewer`, `developer`,
  `admin`, or a custom role).
- **Additional Privileges** (https://infisical.com/docs/documentation/platform/access-controls/additional-privileges)
  allow layering fine-grained permissions on top of a role, including restricting to a
  specific secret path.
- Custom roles can restrict access to "specific secrets, folders, and environments"
  but the UI/API mechanics of folder-path conditions are not fully documented in the
  public docs.

**Practical approach for the `/ifrit` / `/shiva` isolation requirement:**

1. Create one machine identity per agent (e.g., `ifrit-machine-id`, `shiva-machine-id`).
2. Assign each a low-privilege project role (e.g., `viewer` with no write access).
3. Add an **Additional Privilege** scoped to `secretPath: "/ifrit"` (or `/shiva`)
   for read access.

This is partially documented and may require verification in the Infisical dashboard.
Flag to the architect as a risk item.

---

## Option A — Infisical CLI `infisical run` as container entrypoint

### How it works

The CLI wraps your process, injects fetched secrets as env vars, then execs your
command:

```bash
infisical run --token="$INFISICAL_TOKEN" --projectId="$INFISICAL_PROJECT_ID" \
  --env=prod --path=/ifrit -- hermes discord
```

The `INFISICAL_TOKEN` value is obtained by first exchanging client ID + secret (below).

### Install in Dockerfile

```dockerfile
# Debian/Ubuntu
RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' \
      | bash \
  && apt-get install -y infisical
```

Source: https://infisical.com/docs/cli/overview (installation section)

### Required env vars at container startup

| Variable | Source | Purpose |
|---|---|---|
| `INFISICAL_TOKEN` | Fly secret or bootstrap script | Pre-exchanged universal-auth access token |
| `INFISICAL_PROJECT_ID` | Fly secret | Infisical project ID |

Because `infisical run` needs the **access token** (not client ID+secret), you have
two sub-options:

- **Sub-option A1:** Store the access token directly as a Fly secret and refresh it
  periodically (token TTL = 2 h by default). Operationally brittle.
- **Sub-option A2 (recommended):** Write a small entrypoint wrapper that exchanges
  `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET` (stored as Fly secrets) for an
  access token, exports it, then calls `infisical run`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TOKEN=$(curl -sf -X POST https://app.infisical.com/api/v1/auth/universal-auth/login \
  -d "clientId=${INFISICAL_CLIENT_ID}&clientSecret=${INFISICAL_CLIENT_SECRET}" \
  | jq -r .accessToken)
exec infisical run \
  --token="$TOKEN" \
  --projectId="$INFISICAL_PROJECT_ID" \
  --env=prod \
  --path=/ifrit \
  -- hermes discord
```

### Pros / Cons

| | CLI wrapper |
|---|---|
| + | No SDK code; secrets become env vars automatically; works with any process |
| + | Secret rotation: each container restart re-fetches current values |
| - | Adds `curl + jq` dependency (or a token-exchange step) |
| - | Adds ~1 s cold start per fetch |
| - | No in-process re-fetch without restart |

---

## Option B — Bun/TypeScript SDK fetch at boot

### Install

```bash
bun add @infisical/sdk
```

Requires Node.js 20+ (the SDK package note); Bun is compatible.

### Initialization + secret fetch

```typescript
import { InfisicalSDK } from "@infisical/sdk";

const client = new InfisicalSDK();

await client.auth().universalAuth.login({
  clientId: process.env.INFISICAL_CLIENT_ID!,
  clientSecret: process.env.INFISICAL_CLIENT_SECRET!,
});

const secrets = await client.secrets().listSecrets({
  environment: "prod",
  projectId: process.env.INFISICAL_PROJECT_ID!,
  secretPath: "/ifrit",          // folder path for this agent
  viewSecretValue: true,
  expandSecretReferences: true,
});

// Convert to a plain object for the child process env
const agentEnv: Record<string, string> = {};
for (const s of secrets.secrets) {
  agentEnv[s.secretKey] = s.secretValue;
}
```

Source: https://infisical.com/docs/sdks/languages/node

### Dockerfile addition

```dockerfile
# Install Bun (already available in Hermes base? No — Hermes uses Python.)
# For the launcher CLI container:
RUN npm install -g bun   # or use the official Bun installer
RUN bun add @infisical/sdk
```

### Required Fly secrets

| Secret | Purpose |
|---|---|
| `INFISICAL_CLIENT_ID` | Machine identity client ID |
| `INFISICAL_CLIENT_SECRET` | Machine identity client secret |
| `INFISICAL_PROJECT_ID` | Infisical project ID |

### Pros / Cons

| | TS SDK |
|---|---|
| + | Direct control in launcher code; no extra process |
| + | Can handle partial failure, retry, structured logging |
| + | Secrets can be written to child process env without touching container env |
| - | More code to write and maintain |
| - | SDK adds a dependency to the launcher |

---

## Architect's Recommendation

For the **Hermes container itself** (Python process, not the launcher): Option A
(CLI wrapper entrypoint script) avoids modifying the Hermes image.

For the **Bun launcher CLI** that orchestrates deploys: Option B (SDK) gives
programmatic control and better error handling.

---

## Secret Rotation Behavior

Infisical does not push secret updates to running processes. A process started with
`infisical run` received the values at launch time; they are static env vars for the
lifetime of that process.

To pick up rotated secrets, the container must be restarted. On Fly.io, `fly secrets
set` triggers a machine restart, which re-runs the entrypoint and re-fetches.

If a secret is changed in Infisical directly (not via `fly secrets set`), you must
manually restart the machine (`fly machine restart <id>`) or redeploy.

---

## Open Questions

1. **Folder-scoped machine identity** — The exact UI/API steps to create an additional
   privilege scoped to `/ifrit` for `ifrit-machine-id` are not fully documented. Needs
   hands-on verification in the Infisical dashboard. See:
   https://infisical.com/docs/documentation/platform/access-controls/additional-privileges

2. **`INFISICAL_DISABLE_UPDATE_CHECK=true`** — Set this in production containers
   to skip CLI version checks on every `infisical run` call. Documented at
   https://infisical.com/docs/cli/commands/run.

3. **SDK version compatibility with Bun** — The npm page for `@infisical/sdk` returned
   403. Version compatibility with Bun (vs Node 20+) should be tested before committing
   to Option B.
