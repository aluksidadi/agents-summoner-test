# Team norms

Read this before your first turn. Updates land here, not in role prompts.

## 1. Doc-on-learn

If you discover something **non-obvious** about how Hermes / Infisical / Fly / Discord actually behave — especially when an "open question" from `.team/research/` gets resolved during implementation — message **ax-engineer** with a one-liner. They decide the home: CLAUDE.md, a project-scope skill under `.claude/skills/`, or `.team/learnings.md`.

Don't document trivia. Document things a fresh teammate would have to re-discover.

## 2. Workspace

- `.team/research/` — integration-expert dossiers (read-only for everyone else)
- `.team/design/` — architect's DESIGN.md and tickets.md (read-only for engineers)
- `.team/tickets/` — PM working area
- `.team/learnings.md` — running log; ax-engineer curates

## 3. Communication

- Refer to teammates by name (`team-lead`, `architect`, `integration-expert`, `project-manager`, `principal-engineer`, `ax-engineer`, `logs-watcher`).
- Plain text in SendMessage. Don't send structured JSON status.
- For architectural questions, message `architect`. For Hermes/Infisical/Fly specifics, message `integration-expert`. For harness/docs/skills questions, message `ax-engineer`.

## 4. Escalation

- Engineer hits plan deviation → message `architect`. After resolution, `architect` notifies `project-manager` so the ticket reflects reality, and `ax-engineer` if a doc/skill update is warranted.
- Anything blocking the user → message `team-lead`.
