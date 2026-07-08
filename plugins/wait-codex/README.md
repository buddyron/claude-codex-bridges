# wait-codex

`wait-codex` watches a GitHub pull request until Codex finishes reviewing it.

It follows the same signals as the original local Bash helper:

- `eyes` reaction: Codex is reviewing
- `+1` reaction: Codex finished with an LGTM
- bot review objects and inline comments: Codex left feedback

## Usage

```bash
wait-codex
wait-codex --pr 123 --repo owner/name
wait-codex --interval 5 --max-iterations 120
```

If `--pr` and `--repo` are omitted, the CLI uses `gh pr view` and `gh repo view` to auto-detect the current PR and repository.

## Output events

The CLI prints machine-friendly event lines:

- `STARTED: watching PR #123 in owner/name`
- `REVIEWING: eyes added by codex[bot]`
- `DONE:lgtm:codex[bot]`
- `DONE:review:<json>`

## Testing

```bash
npm test --workspace wait-codex
```
