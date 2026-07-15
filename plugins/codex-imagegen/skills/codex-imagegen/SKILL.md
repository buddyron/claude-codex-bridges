---
name: codex-imagegen
description: Generate images by driving Codex's built-in image_gen tool. Use this whenever the user wants Claude Code to trigger image generation through Codex, especially when one or more reference images should be attached.
---

# codex-imagegen

Use `codex-imagegen` when the user wants image output generated through the locally authenticated Codex CLI rather than through a prompt-only skill.

## What it does

- drives a `codex exec` session that calls Codex's built-in `image_gen` tool once
- extracts the generated PNG from the session rollout and writes it to `--out`
- supports one or many reference images
- works well for style transfer, character consistency, and composition guidance

Requires the `codex` CLI on `PATH`, signed in via `codex login`.

## Preferred command

If the package is installed:

```bash
codex-imagegen --out path/to/output.png --image ref-a.png --image ref-b.png "Prompt text"
```

If the package is not installed globally, use `npx`:

```bash
npx codex-imagegen --out path/to/output.png --image ref-a.png --image ref-b.png "Prompt text"
```

## Multiple reference images

Use either of these forms:

```bash
codex-imagegen --image ref-a.png --image ref-b.png "Prompt text"
codex-imagegen --images ref-a.png,ref-b.png "Prompt text"
```

Both forms can be mixed in the same call. The wrapper preserves the order.

## Workflow

1. Write a specific prompt.
2. Attach any reference images with `--image` or `--images`.
3. Pass through optional flags such as `--size`, `--quality`, `--style`, or `--dry-run`.
4. Return the generated file path or the final JSON line if `--json` was used.

Note: `--size` is only an aspect-ratio / framing hint. Codex's built-in
image_gen has no size control and rounds output to ~1.5MP (e.g. 1254×1254), so
exact pixel dimensions are not guaranteed — resize afterward if you need them.

## Examples

```bash
codex-imagegen --image refs/hero.png --image refs/lighting.png \
  --out assets/hero-poster.png \
  --size 1536x1024 \
  --quality high \
  "The same hero standing on a rooftop at sunrise, cinematic poster framing"
```

```bash
codex-imagegen --images refs/product.png,refs/background.png \
  --dry-run \
  "A clean product hero shot for an ecommerce landing page"
```
