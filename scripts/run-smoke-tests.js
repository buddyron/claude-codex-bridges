#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");

  run("node", [path.join(repoRoot, "plugins/wait-codex/bin/wait-codex.js"), "--help"]);

  if (!commandExists("imagegen")) {
    console.log("Skipping codex-imagegen smoke test because imagegen is not installed.");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-smoke-"));
  const firstRef = path.join(tmpDir, "ref-a.png");
  const secondRef = path.join(tmpDir, "ref-b.png");
  fs.writeFileSync(firstRef, "placeholder");
  fs.writeFileSync(secondRef, "placeholder");

  run("node", [
    path.join(repoRoot, "plugins/codex-imagegen/bin/codex-imagegen.js"),
    "--dry-run",
    "--image",
    firstRef,
    "--image",
    secondRef,
    "--prompt",
    "Smoke test prompt"
  ]);
}

main();
