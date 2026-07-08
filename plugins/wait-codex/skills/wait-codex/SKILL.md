---
name: wait-codex
description: Watch a GitHub PR until Codex finishes reviewing it. Use this whenever the user asks Claude Code to wait for Codex PR review completion.
---

# wait-codex

Use `wait-codex` when the user wants Claude Code to monitor a GitHub pull request for Codex review completion.

## Signals

- `eyes` reaction: Codex is actively reviewing
- `+1` reaction: Codex finished with no blocking issues
- bot reviews and inline comments: Codex left review feedback

## Preferred command

If the package is installed:

```bash
wait-codex --pr 123 --repo owner/name
```

If it is not installed globally, use `npx`:

```bash
npx wait-codex --pr 123 --repo owner/name
```

If the current branch already has an open PR, both `--pr` and `--repo` can be omitted and the CLI will auto-detect them through `gh`.

## Output events

The CLI prints event lines that are easy for an agent to watch:

- `STARTED: watching PR #123 in owner/name`
- `REVIEWING: eyes added by codex[bot]`
- `DONE:lgtm:codex[bot]`
- `DONE:review:<json>`

The review JSON matches this shape:

```json
{
  "reviews": [{ "user": "...", "state": "...", "body": "...", "submitted_at": "..." }],
  "comments": [{ "user": "...", "path": "...", "body": "..." }],
  "stale": false
}
```

## Workflow

1. Resolve the PR number and repository.
2. Start the watcher.
3. Surface `REVIEWING` once if it appears.
4. Report `DONE:lgtm` or summarize `DONE:review` when the CLI finishes.
