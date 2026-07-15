const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELP_TEXT = `codex-imagegen - generate images via Codex's built-in image_gen tool.

Runs a fresh non-interactive \`codex exec\` session, makes the Codex agent call
its built-in image_gen tool exactly once, then extracts the generated PNG from
the session rollout and writes it to --out. Uses your \`codex login\` — no
OPENAI_API_KEY needed. Requires the \`codex\` CLI on PATH.

USAGE
  codex-imagegen [options] "PROMPT"
  codex-imagegen --image refs/character.png --image refs/style.png "A cinematic hero shot"
  codex-imagegen --images refs/a.png,refs/b.png --out assets/hero.png "A moody landscape study"

OPTIONS
  -p, --prompt TEXT   Prompt text. If omitted, the wrapper will use the positional prompt or stdin.
  -o, --out FILE      Output PNG path. Default: ./<prompt-slug>-<timestamp>.png
  -i, --image FILE    Attach one reference image. Repeatable.
      --images LIST   Attach multiple images from a comma-separated or newline-separated list.
      --size SIZE     Output size hint, for example 1536x1024.
      --quality Q     Detail hint: low | medium | high.
      --style TEXT    Extra style hint to forward to image_gen.
      --model NAME    Codex model to run (default: gpt-5.5). Must be image-capable.
      --sandbox MODE  Codex sandbox: workspace-write (default) | danger-full-access.
      --timeout SEC   Max seconds to wait for codex (default: 360).
      --bypass        Use --dangerously-bypass-approvals-and-sandbox instead of --sandbox.
      --json          Print a JSON result object as the final stdout line.
      --keep-session  Keep the underlying Codex session rollout file.
  -v, --verbose       Stream codex output to stderr.
  -n, --dry-run       Print the composed prompt + codex command, then exit.
  -h, --help          Show this help.

ENV
  CODEX_HOME          Codex home dir (default: ~/.codex).
  IMAGEGEN_MODEL      Overrides --model default (gpt-5.5).
  IMAGEGEN_SANDBOX    Overrides --sandbox default (workspace-write).
  IMAGEGEN_TIMEOUT    Overrides --timeout default (360).
  IMAGEGEN_BYPASS=1   Same as --bypass.
`;

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_SANDBOX = "workspace-write";
const DEFAULT_TIMEOUT = 360;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readOptionValue(arg, argv, index) {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }

  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${arg}`);
  }

  return { value: argv[index + 1], nextIndex: index + 1 };
}

function splitImageList(value) {
  return String(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    prompt: null,
    out: null,
    imageValues: [],
    imageGroups: [],
    size: null,
    quality: null,
    style: null,
    model: null,
    sandbox: null,
    timeout: null,
    bypass: false,
    json: false,
    keepSession: false,
    verbose: false,
    dryRun: false,
    help: false,
    positionals: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      options.positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "-n" || arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--keep-session") {
      options.keepSession = true;
      continue;
    }

    if (arg === "--bypass") {
      options.bypass = true;
      continue;
    }

    if (arg === "-p" || arg === "--prompt" || arg.startsWith("--prompt=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.prompt = value;
      index = nextIndex;
      continue;
    }

    if (arg === "-o" || arg === "--out" || arg.startsWith("--out=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.out = value;
      index = nextIndex;
      continue;
    }

    if (arg === "-i" || arg === "--image" || arg.startsWith("--image=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.imageValues.push(value);
      index = nextIndex;
      continue;
    }

    if (arg === "--images" || arg.startsWith("--images=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.imageGroups.push(value);
      index = nextIndex;
      continue;
    }

    if (arg === "--size" || arg.startsWith("--size=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.size = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--quality" || arg.startsWith("--quality=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.quality = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--style" || arg.startsWith("--style=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.style = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--model" || arg.startsWith("--model=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.model = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--sandbox" || arg.startsWith("--sandbox=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.sandbox = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.timeout = value;
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.positionals.push(arg);
  }

  return options;
}

function normalizeImageInputs(options) {
  const images = [...options.imageValues];
  for (const group of options.imageGroups) {
    images.push(...splitImageList(group));
  }
  return images;
}

function resolvePrompt(options, stdinText) {
  const positionalPrompt = options.positionals.join(" ").trim();

  if (options.prompt && positionalPrompt) {
    throw new Error("Provide the prompt either with --prompt or as a positional argument, not both.");
  }

  if (options.prompt) {
    return options.prompt.trim();
  }

  if (positionalPrompt) {
    return positionalPrompt;
  }

  const stdinPrompt = String(stdinText || "").trim();
  if (stdinPrompt) {
    return stdinPrompt;
  }

  throw new Error("Missing prompt. Pass --prompt, a positional prompt, or pipe the prompt on stdin.");
}

function commandExistsOnPath(command, { env = process.env, platform = process.platform, existsSyncImpl = fs.existsSync } = {}) {
  const pathValue = env.PATH || env.Path || "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  return directories.some((directory) =>
    extensions.some((extension) => existsSyncImpl(path.join(directory, command + extension)))
  );
}

function assertImageFilesExist(images, existsSyncImpl = fs.existsSync) {
  for (const imagePath of images) {
    if (!existsSyncImpl(imagePath)) {
      throw new Error(`Reference image not found: ${imagePath}`);
    }
  }
}

// Compose the natural-language prompt handed to the Codex agent. The wording is
// deliberate: it must make the agent call image_gen exactly once and NOT write
// files or code (older codex silently falls back to writing code otherwise).
function composePrompt({ prompt, images = [], size, quality, style }) {
  const hasRefs = images.length > 0;
  const lines = [
    hasRefs
      ? "Use the attached image(s) as references and call your built-in image_gen tool exactly once to generate ONE image."
      : "Call your built-in image_gen tool exactly once to generate ONE image matching the spec below.",
    "Do NOT save files, run shell, write code, or report any path — only generate.",
    "",
    "SPEC:",
    prompt
  ];
  if (size) {
    lines.push(`Size: ${size}`);
  }
  if (quality) {
    lines.push(`Quality / detail: ${quality}`);
  }
  if (style) {
    lines.push(`Style: ${style}`);
  }
  return lines.join("\n");
}

function slugify(prompt) {
  const slug = String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "image";
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function resolveOutPath(out, prompt, now = new Date()) {
  if (out) {
    return /\.png$/i.test(out) ? out : `${out}.png`;
  }
  return `./${slugify(prompt)}-${formatTimestamp(now)}.png`;
}

// Build the `codex exec` argv. image_gen only registers when the sandbox is
// writable AND ~/.codex/generated_images is added (--add-dir), on an
// image-capable model with image_generation enabled.
function buildCodexArgs(options, { codexCwd, genDir }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--cd",
    codexCwd,
    "--model",
    options.model,
    "--enable",
    "image_generation",
    "--add-dir",
    genDir
  ];

  if (options.bypass) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", options.sandbox);
  }

  for (const imagePath of options.images) {
    args.push("-i", imagePath);
  }

  // With reference images codex reads the prompt from stdin; otherwise the
  // composed prompt is the trailing positional argument.
  if (options.images.length === 0) {
    args.push(options.composedPrompt);
  }

  return args;
}

function parseSessionId(logText) {
  const pattern = /session id:?\s+([0-9a-f-]{8,})/gi;
  let match;
  let last = null;
  while ((match = pattern.exec(String(logText))) !== null) {
    last = match[1];
  }
  return last;
}

function findFilesRecursive(dir, predicate, readdirImpl = fs.readdirSync, statImpl = fs.statSync) {
  const results = [];
  let entries;
  try {
    entries = readdirImpl(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(full, predicate, readdirImpl, statImpl));
    } else if (predicate(entry.name, full)) {
      results.push(full);
    }
  }
  return results;
}

function locateRollout(sessDir, sid, sinceMs, deps = {}) {
  const readdirImpl = deps.readdirImpl || fs.readdirSync;
  const statImpl = deps.statImpl || fs.statSync;

  if (sid) {
    const matches = findFilesRecursive(
      sessDir,
      (name) => name.startsWith("rollout-") && name.includes(sid) && name.endsWith(".jsonl"),
      readdirImpl,
      statImpl
    );
    if (matches.length > 0) {
      return matches[0];
    }
  }

  // Fallback: newest rollout jsonl touched during this run.
  const rollouts = findFilesRecursive(
    sessDir,
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    readdirImpl,
    statImpl
  )
    .map((file) => {
      try {
        return { file, mtimeMs: statImpl(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && (sinceMs === undefined || entry.mtimeMs >= sinceMs))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return rollouts.length > 0 ? rollouts[0].file : null;
}

function decodePng(base64Value) {
  try {
    const buffer = Buffer.from(String(base64Value), "base64");
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return buffer;
    }
  } catch {
    /* fall through */
  }
  return null;
}

// codex has shipped several rollout schemas for image_gen output. Collect every
// known form, then try them by reliability: inline base64 result, inline
// data:-URL from function_call_output, then the file codex saved to disk.
function extractImageFromRollout(rolloutText, { readFileImpl } = {}) {
  const base64Results = [];
  const dataUrls = [];
  const savedPaths = [];

  for (const rawLine of String(rolloutText).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record.payload || {};
    const type = payload.type;

    if (type === "image_generation_call" || type === "image_generation_end") {
      if (payload.result) {
        base64Results.push(payload.result);
      }
      if (payload.saved_path) {
        savedPaths.push(payload.saved_path);
      }
    } else if (type === "function_call_output") {
      const output = Array.isArray(payload.output) ? payload.output : [payload.output];
      for (const item of output) {
        if (item && typeof item.image_url === "string" && item.image_url.startsWith("data:image")) {
          dataUrls.push(item.image_url);
        }
      }
    }
  }

  for (let index = base64Results.length - 1; index >= 0; index -= 1) {
    const buffer = decodePng(base64Results[index]);
    if (buffer) {
      return buffer;
    }
  }

  for (let index = dataUrls.length - 1; index >= 0; index -= 1) {
    const commaIndex = dataUrls[index].indexOf(",");
    if (commaIndex < 0) {
      continue;
    }
    const buffer = decodePng(dataUrls[index].slice(commaIndex + 1));
    if (buffer) {
      return buffer;
    }
  }

  if (readFileImpl) {
    for (let index = savedPaths.length - 1; index >= 0; index -= 1) {
      try {
        const buffer = readFileImpl(savedPaths[index]);
        if (buffer && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
          return buffer;
        }
      } catch {
        /* try the next candidate */
      }
    }
  }

  return null;
}

async function defaultReadStdin(stdin = process.stdin) {
  if (!stdin || stdin.isTTY) {
    return "";
  }

  let text = "";
  for await (const chunk of stdin) {
    text += chunk;
  }
  return text;
}

function resolveRuntimeOptions(parsed, env) {
  const timeoutRaw = parsed.timeout || env.IMAGEGEN_TIMEOUT || DEFAULT_TIMEOUT;
  const timeout = Number.parseInt(timeoutRaw, 10);
  return {
    model: parsed.model || env.IMAGEGEN_MODEL || DEFAULT_MODEL,
    sandbox: parsed.sandbox || env.IMAGEGEN_SANDBOX || DEFAULT_SANDBOX,
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
    bypass: parsed.bypass || env.IMAGEGEN_BYPASS === "1"
  };
}

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const stdin = dependencies.stdin || process.stdin;
  const env = dependencies.env || process.env;
  const readStdinImpl = dependencies.readStdinImpl || defaultReadStdin;
  const existsSyncImpl = dependencies.existsSyncImpl || fs.existsSync;
  const spawnSyncImpl = dependencies.spawnSyncImpl || spawnSync;
  const commandExistsImpl = dependencies.commandExistsImpl || commandExistsOnPath;
  const mkdirImpl = dependencies.mkdirImpl || fs.mkdirSync;
  const readFileImpl = dependencies.readFileImpl || fs.readFileSync;
  const writeFileImpl = dependencies.writeFileImpl || fs.writeFileSync;
  const rmImpl = dependencies.rmImpl || fs.rmSync;
  const now = dependencies.now || (() => new Date());

  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const runtime = resolveRuntimeOptions(parsed, env);
  if (runtime.sandbox === "read-only") {
    throw new Error("sandbox=read-only won't register image_gen; use workspace-write.");
  }

  if (!commandExistsImpl("codex", { env })) {
    throw new Error(
      "The `codex` CLI was not found on PATH. Install and sign in to the Codex CLI (`codex login`), then try again."
    );
  }

  const stdinText = parsed.prompt || parsed.positionals.length > 0 ? "" : await readStdinImpl(stdin);
  const prompt = resolvePrompt(parsed, stdinText);
  const images = normalizeImageInputs(parsed);
  assertImageFilesExist(images, existsSyncImpl);

  const composedPrompt = composePrompt({
    prompt,
    images,
    size: parsed.size,
    quality: parsed.quality,
    style: parsed.style
  });
  const outPath = resolveOutPath(parsed.out, prompt, now());

  const codexHome = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const genDir = path.join(codexHome, "generated_images");
  const sessDir = path.join(codexHome, "sessions");
  // Stable empty working root so codex records a single [projects.*] entry and
  // does not go on a code-writing spree. We never read the image from here.
  const codexCwd = path.join(os.tmpdir(), "imagegen-cwd");

  const codexArgs = buildCodexArgs(
    { ...runtime, images, composedPrompt },
    { codexCwd, genDir }
  );

  if (parsed.dryRun) {
    stderr.write("----- composed prompt -----\n");
    stderr.write(`${composedPrompt}\n`);
    stderr.write("----- codex command -----\n");
    stderr.write(`codex ${codexArgs.join(" ")}\n`);
    stderr.write("----- would save to -----\n");
    stderr.write(`${outPath}\n`);
    return 0;
  }

  for (const dir of [genDir, sessDir, codexCwd]) {
    mkdirImpl(dir, { recursive: true });
  }

  stderr.write(
    `codex-imagegen: generating via codex image_gen ` +
      `(sandbox=${runtime.bypass ? "bypass" : runtime.sandbox}, timeout=${runtime.timeout}s)…\n`
  );

  const startedAt = now().getTime();
  const result = spawnSyncImpl("codex", codexArgs, {
    cwd: codexCwd,
    env,
    input: images.length > 0 ? `${composedPrompt}\n` : "",
    timeout: runtime.timeout * 1000,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

  if (result && result.error) {
    if (result.error.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
      throw new Error(`codex timed out after ${runtime.timeout}s (raise --timeout, or try --bypass).`);
    }
    throw new Error(`Failed to start codex: ${result.error.message}`);
  }
  if (result && result.signal === "SIGTERM") {
    throw new Error(`codex timed out after ${runtime.timeout}s (raise --timeout, or try --bypass).`);
  }

  const log = `${result && result.stdout ? result.stdout : ""}${result && result.stderr ? result.stderr : ""}`;
  if (parsed.verbose) {
    stderr.write(log.endsWith("\n") ? log : `${log}\n`);
  }

  const sid = parseSessionId(log);
  const rollout = locateRollout(sessDir, sid, startedAt, dependencies);

  let buffer = null;
  if (rollout) {
    let rolloutText = "";
    try {
      rolloutText = readFileImpl(rollout, "utf8");
    } catch {
      rolloutText = "";
    }
    buffer = extractImageFromRollout(rolloutText, { readFileImpl });
  }

  // Fallback for builds that only write the PNG to disk (no inline base64).
  if (!buffer) {
    const disk = findFilesRecursive(genDir, (name) => /\.(png|webp)$/i.test(name))
      .map((file) => {
        try {
          return { file, mtimeMs: fs.statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.mtimeMs >= startedAt)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (disk) {
      try {
        const candidate = readFileImpl(disk.file);
        if (candidate && candidate.length >= 8 && candidate.subarray(0, 8).equals(PNG_SIGNATURE)) {
          buffer = candidate;
        }
      } catch {
        /* nothing usable on disk */
      }
    }
  }

  if (!buffer) {
    if (!parsed.verbose && log) {
      stderr.write("----- codex log (tail) -----\n");
      stderr.write(`${log.split("\n").slice(-30).join("\n")}\n`);
    }
    stderr.write(rollout ? `(rollout: ${rollout})\n` : "(no rollout jsonl found)\n");
    throw new Error(
      "No image was produced. Confirm `codex login status` shows you are logged in and that " +
        "the model is image-capable with a writable sandbox."
    );
  }

  const finalPath = path.resolve(outPath);
  mkdirImpl(path.dirname(finalPath), { recursive: true });
  writeFileImpl(finalPath, buffer);

  if (!parsed.keepSession && rollout) {
    try {
      rmImpl(rollout, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  stderr.write(`codex-imagegen: done (${buffer.length} bytes).\n`);
  if (parsed.json) {
    stdout.write(
      `${JSON.stringify({ ok: true, path: finalPath, bytes: buffer.length, prompt, refs: images.length })}\n`
    );
  } else {
    stdout.write(`${finalPath}\n`);
  }

  return 0;
}

module.exports = {
  HELP_TEXT,
  assertImageFilesExist,
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
};
