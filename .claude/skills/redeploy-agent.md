---
description: Rebuild and redeploy an already-summoned Hermes agent. Use after changing hermes_git_ref, hermes/config.yaml, or hermes/entrypoint.sh. Does not re-provision the Fly app or volume.
---

- [ ] Confirm the agent is already provisioned: `bun run status <name>` shows a machine.
- [ ] If you changed `hermes_git_ref` in `agents/<name>.toml`, update it before running.
- [ ] If you need to rotate bootstrap secrets first, run `bun run secrets <name>` and wait for machine restart before proceeding.

Run:

```
bun run deploy <name>
```

This rebuilds the image with the current `hermes_git_ref` and rolls it via `--strategy immediate`.

Post-deploy check: `bun run logs <name>` — look for Discord connection line. If the machine crash-loops, compare the new `hermes_git_ref` against the previously working SHA and roll back by restoring the old value in `agents/<name>.toml` and re-running `bun run deploy <name>`.
