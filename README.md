# Claude Codex Bridges

Open-source bridge plugins and CLI packages that let Claude Code trigger Codex CLI workflows.

## Included packages

- `codex-imagegen`: runs Codex's local `imagegen` CLI, including multiple reference images.
- `wait-codex`: watches a GitHub PR until Codex finishes its review.

## Repository layout

```text
claude-codex-bridges/
├── .claude-plugin/marketplace.json
├── plugins/
│   ├── codex-imagegen/
│   └── wait-codex/
└── scripts/
```

Each plugin directory contains:

- a `.claude-plugin/plugin.json` manifest for Claude Code plugin packaging
- an npm package with a zero-dependency Node CLI
- an English `SKILL.md` file
- unit tests

## Local development

Run the full test suite:

```bash
npm test
```

Run smoke tests against the local environment:

```bash
npm run test:smoke
```

## Plugin install

Clone the repository and point Claude Code at the repo-local marketplace:

```bash
git clone <this-repo> ~/claude-codex-bridges
```

Then install the individual plugin you want from the repo's marketplace configuration.

## npm usage

Once published, both CLIs are intended to work through `npx`:

```bash
npx codex-imagegen --image refs/character.png --image refs/style.png "A cinematic hero shot"
npx wait-codex --pr 123 --repo owner/name
```
