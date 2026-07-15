# codex-imagegen

`codex-imagegen` generates images through Codex's built-in `image_gen` tool.

It is designed for Claude Code workflows where Claude should trigger image
generation through the locally authenticated Codex CLI. It is self-contained:
it drives a fresh non-interactive `codex exec` session, makes the agent call
`image_gen` exactly once, extracts the generated PNG from the session rollout,
and writes it to `--out`.

## Requirements

- the `codex` CLI on your `PATH`, signed in via `codex login` (no `OPENAI_API_KEY` needed)
- Node.js >= 20

## Features

- forwards prompts to Codex's `image_gen` tool
- supports multiple reference images
- extracts the image directly from the Codex session rollout (works across codex schema versions)
- zero-dependency runtime
- works as a standalone npm CLI and as a bundled skill

## Usage

```bash
codex-imagegen --out assets/hero.png "A product render on white"
codex-imagegen --image refs/character.png --image refs/style.png "A cinematic poster"
codex-imagegen --images refs/a.png,refs/b.png --dry-run "A moody landscape study"
```

The final line printed to stdout is the absolute path of the written PNG (or a
JSON object with `--json`), so it is safe to capture:

```bash
IMG=$(codex-imagegen "a red fox")
```

## Multiple images

Use either:

- repeated `--image` flags
- a single `--images` flag with comma-separated or newline-separated paths

Both forms can be combined, and the wrapper preserves the order.

## Environment

- `CODEX_HOME` — Codex home dir (default `~/.codex`)
- `IMAGEGEN_MODEL` — overrides the default model (`gpt-5.5`)
- `IMAGEGEN_SANDBOX` — overrides the default sandbox (`workspace-write`)
- `IMAGEGEN_TIMEOUT` — overrides the default timeout (`360` seconds)
- `IMAGEGEN_BYPASS=1` — same as `--bypass`

## Testing

```bash
npm test --workspace codex-imagegen
```
