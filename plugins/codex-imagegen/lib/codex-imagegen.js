const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELP_TEXT = `codex-imagegen - run Codex's local imagegen CLI.

USAGE
  codex-imagegen [options] "PROMPT"
  codex-imagegen --image refs/character.png --image refs/style.png "A cinematic hero shot"
  codex-imagegen --images refs/a.png,refs/b.png --dry-run "A moody landscape study"

OPTIONS
  -p, --prompt TEXT   Prompt text. If omitted, the wrapper will use the positional prompt or stdin.
  -o, --out FILE      Output path to pass through to imagegen.
  -i, --image FILE    Attach one reference image. Repeatable.
      --images LIST   Attach multiple images from a comma-separated or newline-separated list.
      --size SIZE     Output size hint, for example 1536x1024.
      --quality Q     Detail hint: low | medium | high.
      --style TEXT    Extra style hint to forward to imagegen.
      --model NAME    Codex model name to forward to imagegen.
      --sandbox MODE  Sandbox mode to forward to imagegen.
      --timeout SEC   Timeout to forward to imagegen.
      --bypass        Forward imagegen's bypass flag.
      --json          Forward imagegen's JSON output flag.
      --keep-session  Keep the underlying Codex session file.
  -v, --verbose       Forward imagegen's verbose flag.
  -n, --dry-run       Forward imagegen's dry-run flag.
  -h, --help          Show this help.
`;

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

function buildImagegenArgs(options) {
  const args = [];

  if (options.out) {
    args.push("--out", options.out);
  }

  for (const imagePath of options.images) {
    args.push("--image", imagePath);
  }

  if (options.size) {
    args.push("--size", options.size);
  }

  if (options.quality) {
    args.push("--quality", options.quality);
  }

  if (options.style) {
    args.push("--style", options.style);
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  if (options.timeout) {
    args.push("--timeout", options.timeout);
  }

  if (options.bypass) {
    args.push("--bypass");
  }

  if (options.json) {
    args.push("--json");
  }

  if (options.keepSession) {
    args.push("--keep-session");
  }

  if (options.verbose) {
    args.push("--verbose");
  }

  if (options.dryRun) {
    args.push("--dry-run");
  }

  args.push("--prompt", options.prompt);
  return args;
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

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stdin = dependencies.stdin || process.stdin;
  const readStdinImpl = dependencies.readStdinImpl || defaultReadStdin;
  const existsSyncImpl = dependencies.existsSyncImpl || fs.existsSync;
  const spawnSyncImpl = dependencies.spawnSyncImpl || spawnSync;
  const commandExistsImpl = dependencies.commandExistsImpl || commandExistsOnPath;
  const env = dependencies.env || process.env;

  const parsed = parseArgs(argv);
  if (parsed.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  if (!commandExistsImpl("imagegen", { env })) {
    throw new Error(
      "Codex's `imagegen` CLI was not found on PATH. Install and sign in to the Codex CLI (it provides the `imagegen` command), then try again."
    );
  }

  const stdinText = parsed.prompt || parsed.positionals.length > 0 ? "" : await readStdinImpl(stdin);
  const prompt = resolvePrompt(parsed, stdinText);
  const images = normalizeImageInputs(parsed);
  assertImageFilesExist(images, existsSyncImpl);

  const result = spawnSyncImpl(
    "imagegen",
    buildImagegenArgs({
      ...parsed,
      prompt,
      images
    }),
    {
      cwd: dependencies.cwd || process.cwd(),
      env: dependencies.env || process.env,
      stdio: ["inherit", "inherit", "inherit"],
      encoding: "utf8"
    }
  );

  if (result && result.error) {
    throw new Error(`Failed to start imagegen: ${result.error.message}`);
  }

  return result && Number.isInteger(result.status) ? result.status : 1;
}

module.exports = {
  HELP_TEXT,
  assertImageFilesExist,
  buildImagegenArgs,
  commandExistsOnPath,
  normalizeImageInputs,
  parseArgs,
  resolvePrompt,
  runCli,
  splitImageList
};
