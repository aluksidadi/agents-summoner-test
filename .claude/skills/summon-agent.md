---
description: First-time provision and deploy of a Hermes agent to Fly.io. Run this when adding a new agent or recovering a destroyed one.
---

Pre-flight (run `bun run doctor` first — it checks all of the below):

- [ ] `agents/<name>.toml` exists and all fields are populated (`name`, `fly_app`, `primary_region`, `vm_size`, `vm_memory_mb`, `volume_name`, `volume_size_gb`, `hermes_git_ref`, `hermes_model`, `infisical_env`, `infisical_path`, `required_secrets`)
- [ ] `.env` (or shell env) contains `FLY_API_TOKEN`, `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID_<NAME>`, `INFISICAL_CLIENT_SECRET_<NAME>` (uppercase agent name)
- [ ] `flyctl` is on PATH and authenticated (`flyctl auth whoami`)
- [ ] Infisical project has folder `/<name>` in env `prod` with all `required_secrets` populated
- [ ] Infisical machine identity `<name>-machine-id` exists with an Additional Privilege scoped to `secretPath: /<name>` (read). See `.team/design/DESIGN.md §9 step 5`.

Run:

```
bun run summon <name>
```

Watch for `Discord` connection line in log tail. If absent after 60 s, run `bun run logs <name>` and check for secret-fetch or import errors.

Post-deploy smoke test: send `@<AgentName> hello` in `DISCORD_HOME_CHANNEL`. Expect a reply within 30 s.
