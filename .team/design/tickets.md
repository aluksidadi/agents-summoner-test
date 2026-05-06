# agents-summoner — Tickets (v1, Ifrit-first)

For PM. Ordered by dependency. Each ticket = 2–4 engineer hours.
Owner labels are suggestions; PM may rebalance.

Conventions:
- "Engineer-1" = primary engineer, "Engineer-2" = secondary (parallelizable work).
- Verification steps are commands to run or behaviour to observe. If a step requires the user (Alex) to act in a vendor UI, it says so.
- Tickets that touch design choices reference DESIGN.md sections.

---

## T01 — Probe Hermes CLI in a local Docker container

**Goal:** Verify `hermes discord` is the correct invocation and confirm what the Hermes container's working entrypoint expects, before we wrap it.

**Plan:**
1. Clone https://github.com/NousResearch/hermes-agent locally to a temp dir (do not add it to this repo).
2. Build the upstream image: `docker build -t hermes-probe .`.
3. Run interactively: `docker run --rm -it --entrypoint /bin/bash hermes-probe`.
4. Inside the container run: `hermes --help`, `hermes-agent --help`, `hermes discord --help`. Capture output.
5. Inspect `/opt/hermes/docker/entrypoint.sh` (the upstream one) to confirm what env it requires before exec'ing the command.
6. Check whether `ghcr.io/nousresearch/hermes-agent` has any published tags (`docker pull ghcr.io/nousresearch/hermes-agent:latest` and check GitHub packages page).
7. Write findings to `.team/research/hermes-probe.md`: confirmed CLI invocation, confirmed env contract, GHCR availability yes/no.

**Verification:**
- `.team/research/hermes-probe.md` exists and answers: (a) exact subcommand to launch the Discord gateway, (b) env vars Hermes will fail without, (c) is there a published image we can `FROM` instead of building from source.
- Architect (me) is messaged with the findings; confirms whether DESIGN §6 build strategy stands or needs revision.

**Suggested owner:** Engineer-1.

**Blocks:** T02, T03.

---

## T02 — Repo bootstrap: Bun project + tooling

**Goal:** Stand up the empty repo skeleton matching DESIGN §2 so subsequent tickets have somewhere to land code.

**Plan:**
1. `bun init -y` at repo root. Replace generated boilerplate.
2. Create directories: `agents/`, `hermes/`, `fly/`, `src/`, `src/commands/`, `src/lib/`.
3. `package.json`: add `smol-toml` (TOML parser) and dev deps `@types/bun`. Add scripts: `summon`, `deploy`, `secrets`, `logs`, `status`, `destroy`, `list`, `doctor` — all map to `bun src/cli.ts <name>`.
4. `tsconfig.json`: strict mode, target ES2022, module ESNext, moduleResolution bundler.
5. `bunfig.toml`: empty stub.
6. `.gitignore`: `node_modules`, `.env`, `.env.local`, `dist`, `*.log`.
7. `.env.example`: list all env var names referenced in DESIGN §5 / §9 (no values).
8. `src/cli.ts`: minimal subcommand dispatcher that prints "not implemented" for each command. Just enough that `bun run doctor` exits 0.
9. Commit.

**Verification:**
- `bun install` succeeds.
- `bun run doctor` exits 0 with stub output.
- `bun run summon ifrit` exits 0 with "not implemented" message (does not crash).
- `tsc --noEmit` passes (or `bun run typecheck` if scripted).

**Suggested owner:** Engineer-2 (parallel with T01).

**Blocks:** T04, T05, T06, T07, T08.

---

## T03 — Hermes-image build assets (Dockerfile, entrypoint, config)

**Goal:** Author the per-agent Hermes container image build assets — DESIGN §6 — using findings from T01.

**Plan:**
1. In `hermes/`, create `Dockerfile` that:
   - Takes `ARG HERMES_GIT_REF` (default `main`).
   - Either `FROM ghcr.io/nousresearch/hermes-agent:<ref>` if T01 confirms a published image exists, OR follows the multi-stage clone+build pattern in DESIGN §6.
   - Installs `infisical` CLI, `jq`, `curl`.
   - Sets `INFISICAL_DISABLE_UPDATE_CHECK=true`.
   - Copies `entrypoint.sh` to `/usr/local/bin/agent-entrypoint.sh`, `chmod +x`.
   - Copies `config.yaml` to `/opt/hermes-defaults/config.yaml`.
   - `ENTRYPOINT ["/usr/local/bin/agent-entrypoint.sh"]`, `CMD ["hermes", "discord"]` (subcommand from T01).
2. Author `hermes/entrypoint.sh`:
   - Validate `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`, `INFISICAL_PATH`, `INFISICAL_ENV` are set; fail fast with a clear log if not.
   - POST to `https://app.infisical.com/api/v1/auth/universal-auth/login` with curl, parse `accessToken` with `jq`, export as `INFISICAL_TOKEN`.
   - On first boot only, copy `/opt/hermes-defaults/config.yaml` to `$HERMES_HOME/config.yaml` if absent.
   - Exec: `exec infisical run --token "$INFISICAL_TOKEN" --projectId "$INFISICAL_PROJECT_ID" --env "$INFISICAL_ENV" --path "$INFISICAL_PATH" -- /opt/hermes/docker/entrypoint.sh "$@"`.
3. Author `hermes/config.yaml`: minimal Hermes behavioural config. Set `model: openrouter/anthropic/claude-opus-4.6`, `provider: auto`, and the `discord:` block from `.team/research/hermes.md` §3 with `require_mention: true`, `reactions: true`, `reply_to_mode: "all"`.
4. Local smoke test: build the image with a dummy `HERMES_GIT_REF`, run with fake Infisical creds — confirm it fails on the universal-auth POST with a clean error message rather than an obscure crash.

**Verification:**
- `docker build --build-arg HERMES_GIT_REF=main -t hermes-test hermes/` succeeds.
- `docker run --rm hermes-test 2>&1 | head -5` fails on missing `INFISICAL_CLIENT_ID` with a one-line error (proves entrypoint validation works).
- With dummy creds, fails on universal-auth login with a one-line error (proves the POST happens before exec).

**Suggested owner:** Engineer-1 (continuing from T01).

**Blocks:** T07.

---

## T04 — Agent config schema + parser

**Goal:** Implement DESIGN §3 — TOML-driven agent config with strict validation.

**Plan:**
1. Author `agents/ifrit.toml` matching DESIGN §3 exactly. Use placeholder values for IDs the user hasn't generated yet (or leave the file as a worked example with comments).
2. In `src/config.ts`:
   - `parseAgentConfig(name: string): AgentConfig` — reads `agents/<name>.toml` via `smol-toml`.
   - Validate every field's type and presence. Reject extra unknown keys (typo guard).
   - Export an `AgentConfig` type matching the schema.
3. In `src/cli.ts`, wire `bun run list` to enumerate `agents/*.toml`, parse each, print a one-line summary (name, fly_app, infisical_path).
4. Unit-test the parser: a valid config parses, a malformed one (missing field) errors with a useful message, an unknown extra key errors.

**Verification:**
- `bun run list` prints `ifrit  hermes-ifrit  /ifrit  prod`.
- Test: edit `ifrit.toml` to remove `fly_app`; `bun run list` exits non-zero with `agents/ifrit.toml: missing required field "fly_app"`.
- Test: add `bogus_key = "x"`; `bun run list` errors with `unknown key "bogus_key"`.

**Suggested owner:** Engineer-2.

**Blocks:** T05, T06, T07, T08.

---

## T05 — `doctor` command

**Goal:** Implement DESIGN §4 — `bun run doctor` validates local environment before any deploy attempt.

**Plan:**
1. In `src/commands/doctor.ts`:
   - Check `flyctl` is on PATH (`which flyctl` or `flyctl version`). Fail with install instructions if missing.
   - Check `FLY_API_TOKEN` is set and non-empty.
   - Check `INFISICAL_PROJECT_ID` is set.
   - For each `agents/*.toml`: parse it, then check `INFISICAL_CLIENT_ID_<NAME_UPPERCASE>` and `INFISICAL_CLIENT_SECRET_<NAME_UPPERCASE>` are set. Missing → warning per-agent (not fatal — operator may not have set up all agents yet).
   - Print a table: each check → OK / FAIL / WARN.
2. Wire to `bun run doctor` in `src/cli.ts`.

**Verification:**
- With a complete `.env`, `bun run doctor` exits 0 and prints all OKs.
- With `FLY_API_TOKEN` unset, exits non-zero, points at the missing var.
- With only Ifrit creds set but a `shiva.toml` present, exits 0 with a warning about Shiva.

**Suggested owner:** Engineer-2.

**Blocks:** —. Useful for everyone going forward.

---

## T06 — `flyctl` shell wrappers

**Goal:** Implement `src/lib/fly.ts` so the rest of the launcher commands compose typed function calls instead of raw shellouts.

**Plan:**
1. Author `src/lib/fly.ts` exporting:
   - `appExists(name): Promise<boolean>` — `flyctl apps list --json` + filter.
   - `createApp(name, org): Promise<void>` — `flyctl apps create`.
   - `volumeExists(app, name, region): Promise<boolean>` — `flyctl volumes list --app <app> --json`.
   - `createVolume(app, name, region, sizeGb): Promise<void>` — `flyctl volumes create … --yes`.
   - `setSecrets(app, secrets: Record<string,string>, opts?: { stage?: boolean }): Promise<void>` — `flyctl secrets set … --stage?`.
   - `deploy(app, configPath, dockerfilePath, buildArgs: Record<string,string>): Promise<void>` — `flyctl deploy --app … --config … --dockerfile … --build-arg KEY=VAL --strategy immediate`.
   - `status(app): Promise<{ machines: Array<{ id, state, region, last_restart_at }> }>` — `flyctl status --app <app> --json`.
   - `tailLogs(app, opts?: { since?: string }): AsyncIterable<string>` — spawn `flyctl logs --app <app>`, yield lines.
   - `destroy(app): Promise<void>` — `flyctl apps destroy <app> --yes`.
2. Each function uses `Bun.spawn` with `FLY_API_TOKEN` injected into env.
3. Each function checks the child exit code and throws a structured `FlyCommandError` with stdout/stderr captured.

**Verification:**
- A small local script (or unit test with mocked `Bun.spawn`) calls `appExists("nonexistent-app-123")` → returns `false`. Calls `appExists` on a real app the user owns → returns `true`. (Engineer needs `FLY_API_TOKEN` to run live tests; pair with PM if not available.)
- Error path: `setSecrets` with an unauthenticated token throws `FlyCommandError` with the flyctl error message.

**Suggested owner:** Engineer-2.

**Blocks:** T07, T08, T09, T10, T11.

---

## T07 — `summon` command (the headline workflow)

**Goal:** Implement DESIGN §7 — one command does the full provision-and-deploy.

**Plan:**
1. Render helper in `src/lib/render.ts`:
   - `renderFlyToml(config): string` — read `fly/fly.toml.tmpl`, substitute `{{APP_NAME}}` and `{{PRIMARY_REGION}}`.
   - `prepareBuildContext(config): Promise<string>` — make a tempdir, copy `hermes/` contents in, write rendered fly.toml, return tempdir path.
2. Author `fly/fly.toml.tmpl` matching `.team/research/fly.md` §1, with `{{APP_NAME}}` and `{{PRIMARY_REGION}}` placeholders. Include the `[[mounts]]` block, `[[restart]]` with on-failure + retries=10, `[[vm]]` with shared-cpu-1x.
3. In `src/commands/summon.ts` execute the 8 steps from DESIGN §7 in order:
   - parseAgentConfig → doctor (subset relevant to this agent) → render context → ensure app → ensure volume → stage secrets → deploy → verify.
4. Each step prints one line of progress (e.g., `[3/8] Rendering build context …`).
5. On success, print: app name, region, machine id, "tail logs with `bun run logs <name>`".

**Verification:**
- Dry-run path: with `--dry-run` (optional flag), prints what it would do without calling flyctl.
- End-to-end: with a real Ifrit setup (post-T13 user setup), `bun run summon ifrit` provisions the app, deploys, and the bot comes online in Discord home channel.
- Idempotency: running `bun run summon ifrit` a second time finishes successfully (app/volume detected, deploy is a redeploy).

**Suggested owner:** Engineer-1.

**Blocks:** T13.

**Blocked by:** T03, T04, T06.

---

## T08 — `secrets`, `logs`, `status`, `destroy` commands

**Goal:** Round out DESIGN §4 with the supporting commands. Smaller scope than T07.

**Plan:**
1. `src/commands/secrets.ts`: parse config → resolve `INFISICAL_CLIENT_ID_<NAME>` / `_SECRET_<NAME>` / `INFISICAL_PROJECT_ID` / `INFISICAL_PATH` / `INFISICAL_ENV` → `setSecrets(app, …, { stage: false })`. Print "secrets pushed; machine restart triggered".
2. `src/commands/logs.ts`: thin wrapper around `tailLogs`. Stream to stdout. `Ctrl-C` exits cleanly.
3. `src/commands/status.ts`: `status(app)` → table of machines with state, region, last_restart_at.
4. `src/commands/destroy.ts`: parse config → prompt operator to type the agent name back → on match, `flyctl apps destroy <app> --yes`. Print warning that Infisical folder + machine identity are NOT touched.

**Verification:**
- `bun run secrets ifrit` (post-deploy) succeeds and triggers a restart visible in `bun run status ifrit`.
- `bun run logs ifrit` streams Hermes stdout.
- `bun run status ifrit` shows one machine, state `started`.
- `bun run destroy ifrit` requires typing `ifrit` to proceed; aborts on mismatch.

**Suggested owner:** Engineer-2.

**Blocked by:** T06, T04.

---

## T09 — Manual setup checklist walkthrough (paired with user)

**Goal:** Execute DESIGN §9 with the user (Alex). This is the only ticket that involves vendor-UI clicks.

**Plan:**
1. Engineer-1 schedules a 60-min pairing session with Alex.
2. Walk through each numbered step of DESIGN §9, in order.
3. Pay special attention to step 5e (Infisical Additional Privilege scoped to `/ifrit`). After creation, **verify isolation**:
   - From a local shell with Ifrit's machine identity creds, run `infisical secrets --token <ifrit-token> --projectId <id> --env=prod --path=/ifrit` → expect success.
   - Same command with `--path=/shiva` (folder doesn't exist yet, but try `--path=/`) → expect 403 / permission error.
   - If isolation does **not** hold, escalate to architect immediately. Fallback per DESIGN §10 is one Infisical project per agent.
4. Capture `.env` values into Alex's local file (do not commit, do not paste in chat — Alex types them).
5. Document any UI gotchas / screenshots into `.team/research/setup-notes.md` for future agents.

**Verification:**
- Alex's local `.env` contains all required keys.
- `bun run doctor` shows all OKs for Ifrit.
- The folder-isolation check above produces the expected 200 / 403 split.

**Suggested owner:** Engineer-1, paired with user.

**Blocks:** T10.

**Blocked by:** T05 (need `doctor` to validate the result).

---

## T10 — End-to-end first deploy of Ifrit

**Goal:** Run `bun run summon ifrit` for real, confirm the Discord bot is alive.

**Plan:**
1. Verify T01–T09 are done.
2. Engineer-1 runs `bun run doctor` — green.
3. Run `bun run summon ifrit`. Capture timing of each step.
4. When deploy completes, run `bun run logs ifrit` and watch for Hermes "Discord client connected" / equivalent log line.
5. Alex sends `@Ifrit hello` in the Discord home channel. Bot replies.
6. Run `bun run status ifrit` — one machine, started, expected region.
7. Restart smoke test: `flyctl machine restart <id> -a hermes-ifrit`. Confirm in logs that entrypoint re-fetches Infisical token, Hermes restarts cleanly.
8. Document any rough edges / surprises in `.team/research/first-deploy-notes.md`.

**Verification:**
- Bot online in Discord, responds to mention.
- Machine state `started`, no restart loop.
- Restart smoke test succeeds.

**Suggested owner:** Engineer-1.

**Blocked by:** T07, T08, T09.

---

## T11 — README + quickstart

**Goal:** Operator-facing docs sufficient for Alex to re-run the workflow without coaching.

**Plan:**
1. `README.md` covers:
   - One-paragraph what-this-is.
   - Prerequisites (flyctl, bun, accounts).
   - The §9 manual checklist, condensed and linked back to DESIGN.md.
   - The launcher CLI command list (copy from DESIGN §4).
   - "Adding a new agent" — the 4-step phase-2 recipe from DESIGN §11.
   - Troubleshooting: how to read `flyctl logs`, how to check secrets, how to force a restart.
2. Mention but do not duplicate `.team/design/DESIGN.md` for full architecture.

**Verification:**
- A peer (Engineer-2) reads only README.md and successfully runs `bun run doctor` against a fresh checkout, including correctly populating `.env`.

**Suggested owner:** Engineer-2 (AX engineer if available — this is operator UX).

**Blocked by:** T07, T08.

---

## T12 — Phase 2: Shiva

**Goal:** Validate that adding a second agent is genuinely a config-only change.

**Plan:**
1. `cp agents/ifrit.toml agents/shiva.toml`. Edit `name`, `display_name`, `fly_app=hermes-shiva`, `infisical_path=/shiva`.
2. User-paired session: repeat DESIGN §9 step 2 (Discord bot for Shiva) and step 5 (Infisical folder + machine identity).
3. Add Shiva env vars to local `.env`.
4. `bun run doctor` — green for both agents.
5. `bun run summon shiva`.
6. Both agents online in same Discord channel; verify they don't talk over each other (mention-required is on by default per `hermes/config.yaml`).
7. If anything other than the 4 steps above was needed, **file a follow-up ticket** — that is the design failing.

**Verification:**
- Both `bun run status ifrit` and `bun run status shiva` show running machines.
- Both bots respond to their respective mentions in the channel.

**Suggested owner:** Engineer-1, paired with user.

**Blocked by:** T10.

---

## T13 — (Stretch / post-v1) Pre-deploy Infisical secret completeness check

**Goal:** Add SDK-based linting so missing Infisical keys surface before deploy, not at runtime.

**Plan:**
1. `bun add @infisical/sdk`.
2. New step in `summon`: between "stage secrets" and "deploy", fetch `/<agent>` via SDK, verify every key in `required_secrets` exists. Fail with a list of missing keys.
3. Verify Bun + SDK compatibility per `.team/research/infisical.md` Open Question #3.

**Verification:**
- Remove `OPENROUTER_API_KEY` from Infisical `/ifrit`, run `bun run summon ifrit` → fails before deploy with a clean "missing required secrets: OPENROUTER_API_KEY" message.

**Suggested owner:** Engineer-2.

**Blocked by:** T07. **Schedule for after T12.**

---

## Ticket dependency graph (for PM)

```
T01 ──┐
      ├─→ T03 ──┐
T02 ──┤         ├─→ T07 ──┐
      ├─→ T04 ──┤         ├─→ T10 ──→ T12
      ├─→ T05 ──┤         │
      └─→ T06 ──┴─→ T08 ──┘
                          │
T05 ──→ T09 ──────────────┘
T07, T08 ──→ T11
T07 ──→ T13 (stretch)
```

Critical path: T01/T02 → T03/T04/T06 → T07 → T09 → T10. Everything else is parallelizable.

**Total: 13 tickets** (12 in v1 path, 1 stretch).
