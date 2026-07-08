# codex-imagegen

`codex-imagegen` is a small wrapper around Codex's local `imagegen` CLI.

It is designed for Claude Code workflows where Claude should trigger image generation through the locally authenticated Codex CLI.

## Features

- forwards prompts to `imagegen`
- supports multiple reference images
- keeps a zero-dependency runtime
- works as a standalone npm CLI and as a bundled skill

## Usage

```bash
codex-imagegen --image refs/character.png --image refs/style.png "A cinematic poster"
codex-imagegen --images refs/a.png,refs/b.png --dry-run "A moody landscape study"
codex-imagegen --out assets/hero.png --prompt "A product render on white"
```

## Multiple images

Use either:

- repeated `--image` flags
- a single `--images` flag with comma-separated or newline-separated paths

Both forms can be combined, and the wrapper preserves the order.

## Testing

```bash
npm test --workspace codex-imagegen
```
