# agents-summoner — Tickets (v1, Ifrit-first)

For PM. Source of truth: `.team/design/DESIGN.md`. Each ticket = 2-4 engineer hours.

**Doc-on-learn rule** (`.team/team-norms.md` §1): when a ticket is marked `Doc-on-learn: YES`, the engineer messages **ax-engineer** with a one-liner of the non-obvious finding on completion. Ax decides where it lands (CLAUDE.md, a skill, or `.team/learnings.md`).

**Owner values:** `principal-engineer-1` | `principal-engineer-2` | `ax-engineer`. PM may rebalance.

---

## Phase A — De-risk (must complete before T7/T8 can finalize)

### T1: Hermes-probe-in-docker
**Goal:** Confirm the actual `hermes` CLI invocation and runtime env contract by building and probing the upstream image, before we wrap it.
**Plan:**
- `git clone https://github.com/NousResearch/hermes-agent /tmp/hermes-upstream` (do not add to this repo). Note the SHA.
- Inspect `Dockerfile` and `docker/entrypoint.sh` upstream. Note base image, install steps, what PID 1 actually exec's.
- `docker build -t hermes-probe /tmp/hermes-upstream`.
- `docker run --rm --entrypoint hermes hermes-probe --help`. Then probe `discord --help`, `hermes-agent --help` if `hermes` isn't on PATH; find the real entrypoint and probe it.
- Grep upstream source for `DISCORD_BOT_TOKEN`, `OPENROUTER_API_KEY`, `os.environ`, `getenv` to enumerate every env var Hermes reads.
- Check `ghcr.io/nousresearch/hermes-agent` for published tags (`docker pull` + GitHub packages page) — informs DESIGN §6 build-from-source vs. FROM-image.
**Verification:**
- Output captured: exact CLI invocation Hermes expects (e.g. `hermes discord` vs `python -m hermes.discord`), full list of env vars Hermes reads, GHCR availability yes/no, upstream SHA probed.
- Architect notified if findings invalidate DESIGN §6 build strategy or §5 entrypoint flow.
**Owner:** principal-engineer-1
**Blocked by:** none
**Doc-on-learn:** YES. Resolves DESIGN §10 risk #1 and `.team/research/hermes.md` Open Question #1. The CLI shape and env contract are load-bearing for T7/T8.

---

### T2: Infisical folder-scoped privilege spike
**Goal:** Prove that an Additional Privilege scoped to `secretPath: /ifrit` actually prevents a machine identity from reading other folders. If isolation fails, fall back to one Infisical project per agent (DESIGN §10 fallback).
**Plan:**
- In Infisical Cloud, create throwaway project `summoner-spike` with `prod` env.
- Create folders `/ifrit-test` and `/shiva-test`. Add `PROBE=ifrit-value` and `PROBE=shiva-value` respectively.
- Create machine identity `ifrit-spike` with Universal Auth, project role `viewer`.
- Add Additional Privilege: `read` scoped to `secretPath: /ifrit-test`. **Document the exact UI click-path** — this is the part the research dossier flagged as ambiguous.
- Generate client id + secret. Locally: `infisical login --method=universal-auth --client-id=… --client-secret=…`.
- Run `infisical secrets --projectId=<id> --env=prod --path=/ifrit-test` → expect success returning `PROBE=ifrit-value`.
- Run `infisical secrets --projectId=<id> --env=prod --path=/shiva-test` → expect 403 / permission denied.
- Also: `infisical run --projectId=<id> --env=prod --path=/shiva-test -- env` → expect failure.
**Verification:**
- Both expected outcomes reproduce; capture stdout/stderr.
- If isolation **fails**: do NOT proceed; message architect immediately. Architect will rev DESIGN §3 to add `infisical_project_id` per agent.
**Owner:** principal-engineer-2
**Blocked by:** none (parallel with T1)
**Doc-on-learn:** YES. Resolves `.team/research/infisical.md` Open Question #1 and DESIGN §10 risk #2. Capture the UI click-path for "Additional Privilege scoped to secretPath" — that's what a fresh teammate would have to re-discover.

---

## Phase B — Skeleton & build (dependency-ordered)

### T3: Repo bootstrap (Bun project + tooling)
**Goal:** Stand up the empty repo skeleton matching DESIGN §2 so subsequent tickets have somewhere to land.
**Plan:**
- `bun init` at repo root. Replace boilerplate.
- Create dirs/files matching DESIGN §2: `agents/`, `hermes/`, `fly/`, `src/cli.ts`, `src/config.ts`, `src/commands/{summon,deploy,secrets,logs,status,destroy,list,doctor}.ts`, `src/lib/{fly,render}.ts`.
- `package.json`: add `smol-toml`, dev dep `@types/bun`. Add scripts: `summon`, `deploy`, `secrets`, `logs`, `status`, `destroy`, `list`, `doctor` — each maps to `bun src/cli.ts <name>`.
- `tsconfig.json`: strict, target ES2022, module ESNext, moduleResolution bundler.
- `bunfig.toml`: stub.
- `.gitignore`: `node_modules`, `.env`, `.env.local`, `dist`, `*.log`, `.fly`.
- `.env.example`: every env var name from DESIGN §5 / §9 step 7, no values.
- `src/cli.ts`: subcommand dispatcher. Each command file exports `async function run(...)` that throws `not implemented`. With no args / `--help`, prints the help block from DESIGN §4.
**Verification:**
- `bun install` succeeds.
- `bun run summon` (no args) prints the help block, exits non-zero.
- `bun src/cli.ts summon ifrit` throws `not implemented` from `commands/summon.ts`.
- `tsc --noEmit` passes.
**Owner:** principal-engineer-2
**Blocked by:** none (parallel with T1, T2)
**Doc-on-learn:** no.

---

### T4: Agent config schema + parser
**Goal:** Implement DESIGN §3 — TOML-driven agent config with strict validation. Every command consumes the parsed object.
**Plan:**
- Author `agents/ifrit.toml` matching DESIGN §3 exactly. Placeholder values are fine for IDs the user hasn't generated yet.
- `src/config.ts`: `loadAgentConfig(name: string): AgentConfig`. Reads `agents/${name}.toml` via `smol-toml`. Validate every field's type + presence. Reject unknown extra keys (typo guard). Throws with `agents/<name>.toml: missing/invalid field "<field>"` messages.
- Export `AgentConfig` type matching DESIGN §3.
- Wire `src/cli.ts` so each command receives the parsed `AgentConfig` (or `null` for command `list`/`doctor`).
- Implement `src/commands/list.ts`: glob `agents/*.toml`, parse each, print one-line summary (`name | fly_app | infisical_path | env`).
**Verification:**
- `bun run list` prints `ifrit  hermes-ifrit  /ifrit  prod`.
- Delete `fly_app` from `ifrit.toml` → `bun run list` exits non-zero with `agents/ifrit.toml: missing required field "fly_app"`. Restore.
- Add `bogus_key = "x"` → `bun run list` errors with `unknown key "bogus_key"`.
- `bun src/cli.ts status ifrit` parses the config and throws `not implemented` from inside `status.ts` (proves loader runs in the dispatch path).
**Owner:** principal-engineer-1
**Blocked by:** T3
**Doc-on-learn:** no.

---

### T5: `doctor` command
**Goal:** `bun run doctor` validates local environment before any deploy attempt (DESIGN §4).
**Plan:**
- `src/commands/doctor.ts`:
  - `flyctl --version` works (PATH check). FAIL with install instructions if missing.
  - `FLY_API_TOKEN` set + non-empty.
  - `INFISICAL_PROJECT_ID` set.
  - For each `agents/*.toml`: parse it; check `INFISICAL_CLIENT_ID_<NAME_UPPERCASE>` and `INFISICAL_CLIENT_SECRET_<NAME_UPPERCASE>` set. Missing = WARN per-agent (not fatal — operator may not have all agents set up).
  - Print a table: each check → OK / FAIL / WARN. Exit non-zero on any FAIL.
**Verification:**
- Complete `.env`: `bun run doctor` exits 0, all OKs.
- Unset `FLY_API_TOKEN`: exits non-zero, points at the missing var.
- With only Ifrit creds set but a `shiva.toml` present: exits 0 with WARN about Shiva.
**Owner:** principal-engineer-2
**Blocked by:** T4
**Doc-on-learn:** no.

---

### T6: flyctl shell wrappers (`src/lib/fly.ts`)
**Goal:** Type-safe wrappers over flyctl so commands compose typed function calls instead of raw shellouts.
**Plan:**
- `src/lib/fly.ts` exports:
  - `appExists(name): Promise<boolean>` — `flyctl apps list --json` + filter.
  - `createApp(name, org?): Promise<void>`.
  - `volumeExists(app, name, region): Promise<boolean>` — `flyctl volumes list --app <app> --json`.
  - `createVolume(app, name, region, sizeGb): Promise<void>` — `flyctl volumes create … --yes`.
  - `setSecrets(app, secrets, opts?: { stage?: boolean }): Promise<void>` — `flyctl secrets set … [--stage]`.
  - `deploy(app, configPath, dockerfilePath, buildArgs): Promise<void>` — `flyctl deploy --app … --config … --dockerfile … --build-arg KEY=VAL --strategy immediate`.
  - `status(app): Promise<{ machines: Array<{ id, state, region, last_restart_at }> }>` — `flyctl status --app <app> --json`.
  - `tailLogs(app): never` — execs `flyctl logs --app <app>` foreground passthrough.
  - `destroyApp(app): Promise<void>`, `destroyVolume(app, volumeId): Promise<void>`.
- All functions: `Bun.spawn` with `FLY_API_TOKEN` injected via env. Stream stdout/stderr to console for visibility. Non-zero exit → throw structured `FlyCommandError(cmd, stderrTail)`.
**Verification:**
- `bun -e 'import { appExists } from "./src/lib/fly"; appExists("nonexistent-app-xyz").then(console.log)'` returns `false` against a real Fly account.
- `appExists("hermes-ifrit")` returns whatever the current truth is (likely `false` pre-deploy).
- Error path: `setSecrets` against unauthenticated token throws `FlyCommandError` with the flyctl error message.
- `tsc --noEmit` passes.
**Owner:** principal-engineer-2
**Blocked by:** T3 (does NOT need T4 — pure flyctl wrappers, no agent-config types)
**Doc-on-learn:** no.

---

### T7: Hermes container build assets (`hermes/Dockerfile`)
**Goal:** Reproducible per-agent image build (DESIGN §6) using the real Hermes invocation T1 surfaced.
**Plan:**
- Read T1's findings before starting. If T1 found a stable upstream GHCR tag, base `FROM` it. Otherwise build from source per DESIGN §6 sketch.
- Write `hermes/Dockerfile`:
  - `ARG HERMES_GIT_REF` (default `main`).
  - Install Infisical CLI (`curl … cloudsmith.io … setup.deb.sh`), `jq`, `curl`, `ca-certificates`, `tini`.
  - Copy `entrypoint.sh` to `/usr/local/bin/agent-entrypoint.sh`, `chmod +x`.
  - Copy `config.yaml` to `/opt/hermes-defaults/config.yaml`.
  - `ENV INFISICAL_DISABLE_UPDATE_CHECK=true PYTHONUNBUFFERED=1`.
  - `ENTRYPOINT ["tini","--","/usr/local/bin/agent-entrypoint.sh"]`.
  - `CMD` reflects T1's actual hermes invocation.
**Verification:**
- `docker build --build-arg HERMES_GIT_REF=<sha-from-T1> -t hermes-ifrit:local hermes/` succeeds.
- `docker run --rm --entrypoint sh hermes-ifrit:local -c 'which hermes && which infisical && which jq'` prints three paths.
- `docker run --rm --entrypoint sh hermes-ifrit:local -c 'hermes --help'` matches T1's reference output.
**Owner:** principal-engineer-1
**Blocked by:** T1
**Doc-on-learn:** YES if any forced deviation from DESIGN §6 (different base image, extra apt package, multi-stage workaround) — message ax-engineer with the diff.

---

### T8: Hermes entrypoint + baseline config (`hermes/entrypoint.sh`, `hermes/config.yaml`)
**Goal:** Container entrypoint exchanges Infisical creds for a token and execs Hermes with secrets injected (DESIGN §5).
**Plan:**
- `hermes/entrypoint.sh` (`#!/usr/bin/env bash`, `set -euo pipefail`):
  - Validate `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`, `INFISICAL_PATH`, `INFISICAL_ENV` are set; fail fast with a clear one-line error per missing var.
  - On first boot only (`/opt/data/config.yaml` absent): copy `/opt/hermes-defaults/config.yaml` → `/opt/data/config.yaml`. Subsequent boots use the volume copy (DESIGN §2 note).
  - POST `https://app.infisical.com/api/v1/auth/universal-auth/login` with curl, parse `accessToken` with `jq` → `INFISICAL_TOKEN`.
  - `exec infisical run --token "$INFISICAL_TOKEN" --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" --path "$INFISICAL_PATH" -- <hermes invocation from T1>`.
- `hermes/config.yaml`: minimal Hermes behavioural config. Set `model: openrouter/anthropic/claude-opus-4.6` and the discord block from `.team/research/hermes.md` §3 (`require_mention: true`, `reactions: true`, `reply_to_mode: "all"`). If T1 finds Hermes reads everything from env, this file may be near-empty — commit a stub.
**Verification:**
- `docker run --rm hermes-ifrit:local 2>&1 | head -5` fails on missing `INFISICAL_CLIENT_ID` with a one-line error (entrypoint validation).
- With dummy creds: fails on the universal-auth POST with a clean error (not `jq: parse error`). Proves the POST happens before exec.
- With real creds (use a throwaway machine identity, NOT `ifrit-machine-id` yet): entrypoint succeeds, reaches `exec infisical run`, Hermes process launches; may fail on missing Discord token if `/ifrit` not yet populated — that's the expected boundary.
- `shellcheck hermes/entrypoint.sh` passes.
**Owner:** principal-engineer-2
**Blocked by:** T1, T2 (T2 confirms the auth + scoped read flow works as documented)
**Doc-on-learn:** YES if the Infisical universal-auth login endpoint or `infisical run` flag set differs from DESIGN §5 — message ax-engineer.

---

### T9: `summon` command + `fly.toml.tmpl` + render helpers
**Goal:** `bun run summon ifrit` executes DESIGN §7 steps 1-7 idempotently. Step 8 (verify) lands in T11.
**Plan:**
- Author `fly/fly.toml.tmpl`: `app = "{{APP_NAME}}"`, `primary_region = "{{PRIMARY_REGION}}"`, `[build]` Dockerfile-driven, `[[mounts]]` binding `hermes_data` → `/opt/data`, `[[vm]]` shared-cpu-1x / 512MB, `[[restart]]` on-failure retries=10, no `[[services]]` (no inbound HTTP). Two tokens only.
- `src/lib/render.ts`:
  - `renderFlyToml(config): string` — token replacement (`{{APP_NAME}}`, `{{PRIMARY_REGION}}`).
  - `stageBuildContext(config): Promise<{ dir, flyTomlPath, dockerfilePath }>` — tempdir, write rendered `fly.toml`, copy `hermes/Dockerfile`, `entrypoint.sh`, `config.yaml`.
- `src/commands/summon.ts`:
  1. Load config (T4).
  2. Doctor preflight: `FLY_API_TOKEN`, `INFISICAL_CLIENT_ID_<NAME>`, `INFISICAL_CLIENT_SECRET_<NAME>`, `INFISICAL_PROJECT_ID` in env. `flyctl --version`. Reuse logic from T5.
  3. `stageBuildContext(config)`.
  4. `appExists` → `createApp` if missing (T6).
  5. `volumeExists` → `createVolume` if missing (T6).
  6. `setSecrets({ INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID, INFISICAL_PATH, INFISICAL_ENV }, { stage: true })`. Per-agent client id/secret looked up via `process.env[\`INFISICAL_CLIENT_ID_${name.toUpperCase()}\`]`.
  7. `deploy({ configPath, dockerfilePath, buildArgs: { HERMES_GIT_REF: config.hermes_git_ref } })`.
- Each step prints `[summon N/7] <description>` for operator visibility.
**Verification:**
- Dry-run with `FLY_API_TOKEN` unset: `bun run summon ifrit` exits non-zero at step 2 with a clear message.
- `bun -e 'import { renderFlyToml } from "./src/lib/render"; import { loadAgentConfig } from "./src/config"; console.log(renderFlyToml(loadAgentConfig("ifrit")))'` prints valid fly.toml. `flyctl config validate -c <rendered>` passes.
- Real run (post-T10 manual setup): reaches step 7, `flyctl deploy` is invoked. Build success/failure verified in T11.
- Idempotence: re-running on already-provisioned agent → steps 4/5 detect existing resources, step 6 stages identical secrets (no-op), step 7 redeploys.
**Owner:** principal-engineer-1
**Blocked by:** T4, T5, T6, T7, T8
**Doc-on-learn:** no.

---

### T10: Operator-side commands — `secrets`, `logs`, `status`, `destroy`, `deploy`
**Goal:** Round out the CLI surface (DESIGN §4) so an operator can manage a deployed agent without leaving the launcher.
**Plan:**
- `src/commands/secrets.ts`: parse config → resolve `INFISICAL_CLIENT_ID_<NAME>` / `_SECRET_<NAME>` / `INFISICAL_PROJECT_ID` / `INFISICAL_PATH` / `INFISICAL_ENV` → `setSecrets(app, …, { stage: false })`. Print "secrets pushed; machine restart triggered".
- `src/commands/logs.ts`: thin wrapper around `tailLogs`. Stream to stdout. Ctrl-C exits cleanly.
- `src/commands/status.ts`: `status(app)` → table of machines with state, region, last_restart_at, volume attachment from `flyctl volumes list`.
- `src/commands/destroy.ts`: prompt operator to type the agent name back. On match → list volumes for app, destroy each, then `destroyApp`. Print warning that Infisical folder + machine identity are NOT touched.
- `src/commands/deploy.ts`: re-stage build context, `flyctl deploy`. No app/volume/secrets work — for the iterate-on-config / rebuild-image case.
**Verification:**
- `bun run secrets ifrit` post-deploy succeeds; restart visible in `bun run status ifrit`.
- `bun run logs ifrit` streams Hermes stdout.
- `bun run status ifrit` shows one machine, state `started`.
- `bun run destroy ifrit`: wrong confirmation aborts; correct confirmation removes app + volume (`flyctl apps list` confirms).
- `bun run deploy ifrit` rebuilds and rolls without re-creating resources.
**Owner:** principal-engineer-2
**Blocked by:** T6, T9 (T9 produces a deployed app to test against; commands themselves only need T6)
**Doc-on-learn:** no.

---

### T11: First Ifrit deploy — end-to-end smoke test
**Goal:** `bun run summon ifrit` + Discord ping works for real. This is the v1 acceptance test.
**Plan:**
- Pre-req: operator has completed DESIGN §9 manual checklist. Engineer pairs through it on the user's machine if not done. Pay special attention to §9 step 5e (Infisical Additional Privilege scoped to `/ifrit`); use the verified UI path from T2's learning.
- Add DESIGN §7 step 8 (verify) inside `summon.ts`: poll `status` until `state === "started"` (90s timeout), then tail logs for 30s and exit. Small addition to T9, scoped here so T9 doesn't expand.
- `bun run doctor` clean.
- `bun run summon ifrit`. Capture step timings. Tolerate one Fly remote-builder cold start (5-10 min, DESIGN §10).
- `bun run logs ifrit` — wait up to 30s for an Infisical token-fetch line and a Discord-connect line. Capture both verbatim.
- Discord home channel: `@Ifrit hello`. Bot replies with non-empty Hermes-generated reply.
- Restart smoke test: `flyctl machine restart <id> -a hermes-ifrit`. Confirm entrypoint re-fetches Infisical token in logs.
- Cold-path test: `bun run destroy ifrit` then `bun run summon ifrit` succeeds.
**Verification:**
- Bot online in Discord, responds to mention.
- Machine state `started`, no restart loop.
- Restart smoke test succeeds.
- Idempotent re-summon succeeds.
- Cold-path destroy + summon succeeds.
**Owner:** principal-engineer-1
**Blocked by:** T9, T10
**Doc-on-learn:** YES if anything surprised the engineer during the live deploy (build time, log line shape, volume mount path, Discord intent surprises). Whatever a fresh teammate would have to re-discover — message ax-engineer.

---

### T12: README + quickstart
**Goal:** A new operator can summon Ifrit from a blank machine using only README + DESIGN.md.
**Plan:**
- `README.md` covers:
  - One-paragraph what-this-is.
  - Prerequisites (Bun, flyctl, Docker, accounts: Fly / Infisical / Discord / OpenRouter).
  - DESIGN §9 manual checklist condensed to a runbook, linking back to DESIGN.md for rationale.
  - CLI surface from DESIGN §4 with one example each.
  - Adding a new agent — the 4-step phase-2 recipe from DESIGN §11.
  - Troubleshooting: failed Infisical auth, Fly build timeout, missing Discord intent, how to force a restart.
  - Pointers: `.team/design/DESIGN.md` for "why", `.team/learnings.md` for known gotchas.
- Do not duplicate DESIGN.md.
**Verification:**
- A peer reads only README.md and successfully runs `bun run doctor` against a fresh checkout, including correctly populating `.env`. Anything missing → patch README.
**Owner:** ax-engineer
**Blocked by:** T11 (so README reflects what actually worked)
**Doc-on-learn:** no — ax owns docs by definition.

---

## Parallelism map

- **T1, T2, T3 fully parallel at session start.** principal-engineer-1 takes T1, principal-engineer-2 takes T2 + T3 (T3 is purely scaffolding, doesn't depend on Phase A learnings).
- **T4 + T6 parallel** once T3 lands. pe1 = T4, pe2 = T6.
- **T5 follows T4** (needs config types). Quick — pe2 picks it up after T6.
- **T7 + T8 parallel** once T1 + T2 land. pe1 = T7, pe2 = T8.
- **T9 is the join point** — needs T4, T5, T6, T7, T8. Whichever engineer is free claims it (likely pe1).
- **T10 in parallel with T11**: T10 is independent of the Discord smoke test once T6/T9 land. pe2 builds T10 while pe1 drives T11.
- **T12** is last and owned by ax-engineer.

Critical path: **T1 → T7 → T8 → T9 → T11 → T12**. Phase A (T1, T2) gates T7/T8; everything else runs concurrent until T9.

## Out of scope for v1 (do not pull in)
- Phase 2 (Shiva) — DESIGN §11. Spin tickets after T11 ships.
- Pre-deploy Infisical secret-completeness check (DESIGN §5 + §10 risk #5).
- Upstream-Hermes-tracking automation (DESIGN §6 con #2).
- HTTP healthcheck / metrics / log aggregation (DESIGN §8 deferred list).
