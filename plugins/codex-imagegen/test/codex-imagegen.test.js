const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  buildImagegenArgs,
  commandExistsOnPath,
  normalizeImageInputs,
  parseArgs,
  resolvePrompt,
  runCli,
  splitImageList
} = require("../lib/codex-imagegen");

test("splitImageList supports comma-separated and newline-separated values", () => {
  assert.deepEqual(splitImageList("a.png, b.png\nc.png"), ["a.png", "b.png", "c.png"]);
});

test("parseArgs collects repeated --image and grouped --images flags", () => {
  const parsed = parseArgs([
    "--image",
    "a.png",
    "--images=b.png,c.png",
    "--quality",
    "high",
    "prompt",
    "text"
  ]);

  assert.deepEqual(parsed.imageValues, ["a.png"]);
  assert.deepEqual(parsed.imageGroups, ["b.png,c.png"]);
  assert.equal(parsed.quality, "high");
  assert.deepEqual(parsed.positionals, ["prompt", "text"]);
});

test("normalizeImageInputs preserves order across image flags", () => {
  const images = normalizeImageInputs({
    imageValues: ["a.png", "b.png"],
    imageGroups: ["c.png,d.png"]
  });

  assert.deepEqual(images, ["a.png", "b.png", "c.png", "d.png"]);
});

test("buildImagegenArgs repeats --image for each reference", () => {
  const args = buildImagegenArgs({
    out: "out.png",
    images: ["a.png", "b.png"],
    size: "1536x1024",
    quality: "high",
    style: "comic",
    model: "gpt-5.5",
    sandbox: "workspace-write",
    timeout: "30",
    bypass: true,
    json: true,
    keepSession: true,
    verbose: true,
    dryRun: true,
    prompt: "hello"
  });

  assert.deepEqual(args, [
    "--out",
    "out.png",
    "--image",
    "a.png",
    "--image",
    "b.png",
    "--size",
    "1536x1024",
    "--quality",
    "high",
    "--style",
    "comic",
    "--model",
    "gpt-5.5",
    "--sandbox",
    "workspace-write",
    "--timeout",
    "30",
    "--bypass",
    "--json",
    "--keep-session",
    "--verbose",
    "--dry-run",
    "--prompt",
    "hello"
  ]);
});

test("resolvePrompt prefers explicit prompt and rejects ambiguous input", () => {
  assert.equal(
    resolvePrompt({ prompt: "explicit", positionals: [] }, ""),
    "explicit"
  );

  assert.throws(
    () => resolvePrompt({ prompt: "explicit", positionals: ["positional"] }, ""),
    /either with --prompt or as a positional/
  );
});

test("runCli forwards stdin prompt and multiple images to imagegen", async () => {
  const calls = [];

  const status = await runCli(["--image", "a.png", "--images", "b.png,c.png"], {
    readStdinImpl: async () => "Prompt from stdin",
    existsSyncImpl: () => true,
    commandExistsImpl: () => true,
    spawnSyncImpl(command, args) {
      calls.push({ command, args });
      return { status: 0 };
    }
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "imagegen");
  assert.deepEqual(calls[0].args, [
    "--image",
    "a.png",
    "--image",
    "b.png",
    "--image",
    "c.png",
    "--prompt",
    "Prompt from stdin"
  ]);
});

test("runCli rejects missing reference image paths", async () => {
  await assert.rejects(
    () =>
      runCli(["--image", "missing.png", "prompt"], {
        existsSyncImpl: () => false,
        commandExistsImpl: () => true
      }),
    /Reference image not found/
  );
});

test("runCli reports a clear error when the imagegen CLI is missing from PATH", async () => {
  await assert.rejects(
    () =>
      runCli(["prompt"], {
        existsSyncImpl: () => true,
        commandExistsImpl: () => false
      }),
    /Codex's `imagegen` CLI was not found on PATH/
  );
});

test("commandExistsOnPath finds an executable in one of the PATH directories", () => {
  const found = commandExistsOnPath("imagegen", {
    env: { PATH: ["/no/such/dir", "/usr/bin"].join(require("node:path").delimiter) },
    platform: "darwin",
    existsSyncImpl: (candidate) => candidate === "/usr/bin/imagegen"
  });

  assert.equal(found, true);

  const notFound = commandExistsOnPath("imagegen", {
    env: { PATH: "/usr/bin" },
    platform: "darwin",
    existsSyncImpl: () => false
  });

  assert.equal(notFound, false);
});

test("CLI entrypoint works with a fake imagegen binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-test-"));
  const fakeBinDir = path.join(tempDir, "bin");
  fs.mkdirSync(fakeBinDir);

  const logPath = path.join(tempDir, "imagegen-log.json");
  const fakeImagegen = path.join(fakeBinDir, "imagegen");
  fs.writeFileSync(
    fakeImagegen,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.FAKE_IMAGEGEN_LOG, JSON.stringify(process.argv.slice(2)));
`,
    { mode: 0o755 }
  );

  const firstRef = path.join(tempDir, "first.png");
  const secondRef = path.join(tempDir, "second.png");
  fs.writeFileSync(firstRef, "x");
  fs.writeFileSync(secondRef, "x");

  const result = spawnSync(
    "node",
    [
      path.resolve(__dirname, "../bin/codex-imagegen.js"),
      "--image",
      firstRef,
      "--images",
      secondRef,
      "--prompt",
      "Integration prompt"
    ],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        FAKE_IMAGEGEN_LOG: logPath
      },
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const loggedArgs = JSON.parse(fs.readFileSync(logPath, "utf8"));
  assert.deepEqual(loggedArgs, [
    "--image",
    firstRef,
    "--image",
    secondRef,
    "--prompt",
    "Integration prompt"
  ]);
});
