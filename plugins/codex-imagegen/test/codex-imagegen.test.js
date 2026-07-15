const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  buildCodexArgs,
  commandExistsOnPath,
  composePrompt,
  decodePng,
  extractImageFromRollout,
  locateRollout,
  normalizeImageInputs,
  parseArgs,
  parseSessionId,
  resolveOutPath,
  resolvePrompt,
  resolveRuntimeOptions,
  runCli,
  slugify,
  splitImageList
} = require("../lib/codex-imagegen");

// A minimal 1x1 PNG used across extraction tests.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
  "base64"
);
const ONE_PX_PNG_B64 = ONE_PX_PNG.toString("base64");

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

test("composePrompt instructs a single generation and switches wording for references", () => {
  const plain = composePrompt({ prompt: "a red fox", images: [], size: "1024x1024" });
  assert.match(plain, /image_gen tool exactly once/);
  assert.match(plain, /Do NOT save files/);
  assert.match(plain, /SPEC:\na red fox/);
  // Size is phrased as an instruction to call image_gen with that size.
  assert.match(plain, /Call image_gen with a size of 1024x1024/);

  const withRefs = composePrompt({ prompt: "same fox", images: ["ref.png"] });
  assert.match(withRefs, /only as references/);
  assert.match(withRefs, /generate ONE new image/);
});

test("buildCodexArgs enables image_gen, adds the gen dir, and places the prompt correctly", () => {
  const genDir = "/home/user/.codex/generated_images";
  const codexCwd = "/tmp/imagegen-cwd";

  const plain = buildCodexArgs(
    { model: "gpt-5.5", sandbox: "workspace-write", bypass: false, images: [], composedPrompt: "PROMPT" },
    { codexCwd, genDir }
  );
  assert.deepEqual(plain, [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--cd",
    codexCwd,
    "--model",
    "gpt-5.5",
    "--enable",
    "image_generation",
    "--add-dir",
    genDir,
    "--sandbox",
    "workspace-write",
    "PROMPT"
  ]);

  const withRefs = buildCodexArgs(
    { model: "gpt-5.5", sandbox: "workspace-write", bypass: true, images: ["a.png", "b.png"], composedPrompt: "PROMPT" },
    { codexCwd, genDir }
  );
  // bypass replaces --sandbox; refs are attached; no trailing positional prompt.
  assert.ok(withRefs.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!withRefs.includes("--sandbox"));
  assert.deepEqual(withRefs.slice(-4), ["-i", "a.png", "-i", "b.png"]);
  assert.ok(!withRefs.includes("PROMPT"));
});

test("resolveRuntimeOptions applies defaults, env overrides, and CLI precedence", () => {
  assert.deepEqual(resolveRuntimeOptions({ model: null, sandbox: null, timeout: null, bypass: false }, {}), {
    model: "gpt-5.5",
    sandbox: "workspace-write",
    timeout: 360,
    bypass: false
  });

  assert.deepEqual(
    resolveRuntimeOptions(
      { model: null, sandbox: null, timeout: null, bypass: false },
      { IMAGEGEN_MODEL: "gpt-x", IMAGEGEN_SANDBOX: "danger-full-access", IMAGEGEN_TIMEOUT: "90", IMAGEGEN_BYPASS: "1" }
    ),
    { model: "gpt-x", sandbox: "danger-full-access", timeout: 90, bypass: true }
  );

  // Explicit CLI values win over env.
  assert.equal(
    resolveRuntimeOptions({ model: "cli-model", sandbox: null, timeout: null, bypass: false }, { IMAGEGEN_MODEL: "env-model" }).model,
    "cli-model"
  );
});

test("resolveOutPath appends .png and falls back to a slug + timestamp", () => {
  assert.equal(resolveOutPath("assets/hero", "x"), "assets/hero.png");
  assert.equal(resolveOutPath("assets/hero.PNG", "x"), "assets/hero.PNG");

  const fixed = new Date(2026, 6, 16, 9, 8, 7);
  assert.equal(resolveOutPath(null, "A Red Fox!", fixed), "./a-red-fox-20260716-090807.png");
});

test("slugify normalizes and truncates prompts", () => {
  assert.equal(slugify("A Red Fox!"), "a-red-fox");
  assert.equal(slugify("!!!"), "image");
});

test("resolvePrompt prefers explicit prompt and rejects ambiguous input", () => {
  assert.equal(resolvePrompt({ prompt: "explicit", positionals: [] }, ""), "explicit");

  assert.throws(
    () => resolvePrompt({ prompt: "explicit", positionals: ["positional"] }, ""),
    /either with --prompt or as a positional/
  );
});

test("parseSessionId returns the last session id found in codex output", () => {
  const log = "session id: 019f0000-aaaa\nnoise\nsession id: 019f67c5-bfbf-7660-b2ac-5e9c8ac2fea4\n";
  assert.equal(parseSessionId(log), "019f67c5-bfbf-7660-b2ac-5e9c8ac2fea4");
  assert.equal(parseSessionId("nothing here"), null);
});

test("decodePng accepts real PNG bytes and rejects non-PNG data", () => {
  assert.ok(decodePng(ONE_PX_PNG_B64));
  assert.equal(decodePng(Buffer.from("not a png").toString("base64")), null);
});

test("extractImageFromRollout reads the new image_generation_end base64 schema", () => {
  const rollout = [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "x" } }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "image_generation_end", status: "completed", result: ONE_PX_PNG_B64, saved_path: "/does/not/exist.png" }
    })
  ].join("\n");

  const buffer = extractImageFromRollout(rollout);
  assert.ok(buffer);
  assert.ok(buffer.equals(ONE_PX_PNG));
});

test("extractImageFromRollout reads the old image_generation_call schema", () => {
  const rollout = JSON.stringify({
    type: "response_item",
    payload: { type: "image_generation_call", result: ONE_PX_PNG_B64 }
  });
  assert.ok(extractImageFromRollout(rollout).equals(ONE_PX_PNG));
});

test("extractImageFromRollout reads a function_call_output data: URL", () => {
  const rollout = JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call_output",
      output: [
        { type: "input_image", image_url: `data:image/png;base64,${ONE_PX_PNG_B64}`, detail: "high" },
        { type: "input_text", text: "Generated images are saved to ..." }
      ]
    }
  });
  assert.ok(extractImageFromRollout(rollout).equals(ONE_PX_PNG));
});

test("extractImageFromRollout falls back to saved_path on disk", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-saved-"));
  const saved = path.join(tempDir, "call_abc.png");
  fs.writeFileSync(saved, ONE_PX_PNG);

  // No inline base64 anywhere — only saved_path points at the real file.
  const rollout = JSON.stringify({
    type: "event_msg",
    payload: { type: "image_generation_end", status: "completed", saved_path: saved }
  });
  const buffer = extractImageFromRollout(rollout, { readFileImpl: fs.readFileSync });
  assert.ok(buffer.equals(ONE_PX_PNG));
});

test("extractImageFromRollout returns null when nothing usable is present", () => {
  const rollout = JSON.stringify({ type: "event_msg", payload: { type: "token_count" } });
  assert.equal(extractImageFromRollout(rollout), null);
});

test("locateRollout finds the rollout whose filename contains the session id", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-sess-"));
  const dayDir = path.join(tempDir, "2026", "07", "16");
  fs.mkdirSync(dayDir, { recursive: true });
  const sid = "019f67c5-bfbf-7660-b2ac-5e9c8ac2fea4";
  const target = path.join(dayDir, `rollout-2026-07-16T06-54-00-${sid}.jsonl`);
  fs.writeFileSync(target, "{}\n");
  fs.writeFileSync(path.join(dayDir, "rollout-2026-07-16T06-00-00-other.jsonl"), "{}\n");

  assert.equal(locateRollout(tempDir, sid), target);
});

test("runCli reports a clear error when the codex CLI is missing from PATH", async () => {
  await assert.rejects(
    () =>
      runCli(["prompt"], {
        existsSyncImpl: () => true,
        commandExistsImpl: () => false
      }),
    /`codex` CLI was not found on PATH/
  );
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

test("runCli rejects a read-only sandbox", async () => {
  await assert.rejects(
    () => runCli(["--sandbox", "read-only", "prompt"], { commandExistsImpl: () => true }),
    /read-only won't register image_gen/
  );
});

test("runCli end-to-end: drives codex, extracts the PNG, and writes --out", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-e2e-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessDir = path.join(codexHome, "sessions", "2026", "07", "16");
  fs.mkdirSync(sessDir, { recursive: true });
  const outPath = path.join(tempDir, "out.png");

  const sid = "019f67c5-bfbf-7660-b2ac-5e9c8ac2fea4";
  const rolloutFile = path.join(sessDir, `rollout-2026-07-16T06-54-00-${sid}.jsonl`);

  const calls = [];
  const spawnSyncImpl = (command, args) => {
    calls.push({ command, args });
    // Simulate codex: emit the session id on stdout and drop a rollout jsonl
    // carrying the generated image as inline base64.
    fs.writeFileSync(
      rolloutFile,
      `${JSON.stringify({
        type: "event_msg",
        payload: { type: "image_generation_end", status: "completed", result: ONE_PX_PNG_B64 }
      })}\n`
    );
    return { status: 0, stdout: `session id: ${sid}\n`, stderr: "" };
  };

  const lines = [];
  const status = await runCli(["--out", outPath, "a small test sticker"], {
    env: { ...process.env, CODEX_HOME: codexHome },
    commandExistsImpl: () => true,
    spawnSyncImpl,
    stdout: { write: (text) => lines.push(text) },
    stderr: { write: () => {} }
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "codex");
  assert.ok(calls[0].args.includes("image_generation"));
  assert.ok(fs.existsSync(outPath));
  assert.ok(fs.readFileSync(outPath).equals(ONE_PX_PNG));
  // Final stdout line is the absolute path to the written image.
  assert.equal(lines[lines.length - 1].trim(), outPath);
  // Session rollout is cleaned up by default.
  assert.ok(!fs.existsSync(rolloutFile));
});

test("buildCodexArgs wires --output-last-message when a path is given", () => {
  const args = buildCodexArgs(
    { model: "gpt-5.5", sandbox: "workspace-write", bypass: false, images: [], composedPrompt: "PROMPT" },
    { codexCwd: "/tmp/cwd", genDir: "/gen", lastMessagePath: "/tmp/last.txt" }
  );
  const flagIndex = args.indexOf("-o");
  assert.ok(flagIndex >= 0);
  assert.equal(args[flagIndex + 1], "/tmp/last.txt");
  // The positional prompt must still come last.
  assert.equal(args[args.length - 1], "PROMPT");
});

test("runCli surfaces the agent's final message when no image is produced", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-fail-"));
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });

  const spawnSyncImpl = (command, args) => {
    // Simulate a refusal: codex writes an explanation to --output-last-message
    // and produces no rollout / image.
    const flagIndex = args.indexOf("-o");
    fs.writeFileSync(args[flagIndex + 1], "I can't generate that image.");
    return { status: 0, stdout: "session id: 019f0000-dead\n", stderr: "" };
  };

  const errors = [];
  await assert.rejects(
    () =>
      runCli(["--out", path.join(tempDir, "out.png"), "a forbidden thing"], {
        env: { ...process.env, CODEX_HOME: codexHome },
        commandExistsImpl: () => true,
        spawnSyncImpl,
        stdout: { write: () => {} },
        stderr: { write: (text) => errors.push(text) }
      }),
    /No image was produced/
  );

  assert.ok(errors.join("").includes("I can't generate that image."));
});

test("commandExistsOnPath finds an executable in one of the PATH directories", () => {
  const found = commandExistsOnPath("codex", {
    env: { PATH: ["/no/such/dir", "/usr/bin"].join(path.delimiter) },
    platform: "darwin",
    existsSyncImpl: (candidate) => candidate === "/usr/bin/codex"
  });

  assert.equal(found, true);

  const notFound = commandExistsOnPath("codex", {
    env: { PATH: "/usr/bin" },
    platform: "darwin",
    existsSyncImpl: () => false
  });

  assert.equal(notFound, false);
});

test("CLI entrypoint works with a fake codex binary", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-bin-"));
  const fakeBinDir = path.join(tempDir, "bin");
  fs.mkdirSync(fakeBinDir);
  const codexHome = path.join(tempDir, ".codex");

  const sid = "019f67c5-bfbf-7660-b2ac-5e9c8ac2fea4";
  const fakeCodex = path.join(fakeBinDir, "codex");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const sid = "${sid}";
const sessDir = path.join(process.env.CODEX_HOME, "sessions", "2026", "07", "16");
fs.mkdirSync(sessDir, { recursive: true });
fs.writeFileSync(
  path.join(sessDir, "rollout-2026-07-16T06-54-00-" + sid + ".jsonl"),
  JSON.stringify({ type: "event_msg", payload: { type: "image_generation_end", status: "completed", result: "${ONE_PX_PNG_B64}" } }) + "\\n"
);
process.stdout.write("session id: " + sid + "\\n");
`,
    { mode: 0o755 }
  );

  const outPath = path.join(tempDir, "out.png");
  const result = spawnSync(
    "node",
    [path.resolve(__dirname, "../bin/codex-imagegen.js"), "--out", outPath, "--prompt", "Integration prompt"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        CODEX_HOME: codexHome
      },
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(outPath));
  assert.ok(fs.readFileSync(outPath).equals(ONE_PX_PNG));
  assert.equal(result.stdout.trim().split("\n").pop(), outPath);
});
