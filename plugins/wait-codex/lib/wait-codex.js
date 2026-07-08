const { execFileSync } = require("node:child_process");

const HELP_TEXT = `wait-codex - watch a PR until Codex finishes reviewing it.

USAGE
  wait-codex
  wait-codex --pr 123 --repo owner/name
  wait-codex --interval 5 --max-iterations 120

OPTIONS
      --pr NUMBER          PR number to watch. If omitted, use gh pr view.
      --repo OWNER/NAME    Repository to watch. If omitted, use gh repo view.
      --interval SEC       Poll interval in seconds. Default: 20.
      --max-iterations N   Maximum poll iterations before timing out. Default: 90.
      --stale-after N      Emit the latest older review after N iterations. Default: 15.
      --once               Run a single status check and exit without polling.
  -h, --help               Show this help.

EVENTS
  STARTED: watching PR #123 in owner/name
  REVIEWING: eyes added by codex[bot]
  DONE:lgtm:codex[bot]
  DONE:review:{"reviews":[...],"comments":[...],"stale":false}
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

function parsePositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    prNumber: null,
    repo: null,
    intervalSeconds: 20,
    maxIterations: 90,
    staleAfter: 15,
    once: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg === "--pr" || arg.startsWith("--pr=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.prNumber = String(value);
      index = nextIndex;
      continue;
    }

    if (arg === "--repo" || arg.startsWith("--repo=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.repo = value;
      index = nextIndex;
      continue;
    }

    if (arg === "--interval" || arg.startsWith("--interval=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.intervalSeconds = parsePositiveNumber(value, "--interval");
      index = nextIndex;
      continue;
    }

    if (arg === "--max-iterations" || arg.startsWith("--max-iterations=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.maxIterations = parsePositiveNumber(value, "--max-iterations");
      index = nextIndex;
      continue;
    }

    if (arg === "--stale-after" || arg.startsWith("--stale-after=")) {
      const { value, nextIndex } = readOptionValue(arg, argv, index);
      options.staleAfter = parsePositiveNumber(value, "--stale-after");
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function isBotUser(user) {
  if (!user) {
    return false;
  }

  return user.type === "Bot" || (typeof user.login === "string" && user.login.endsWith("[bot]"));
}

function truncate(text, maxLength) {
  const value = typeof text === "string" ? text : "";
  return value.slice(0, maxLength);
}

function normalizeRepo(repoView) {
  const owner = typeof repoView.owner === "string" ? repoView.owner : repoView.owner && repoView.owner.login;
  return `${owner}/${repoView.name}`;
}

function listBotReviews(reviews) {
  return reviews
    .filter((review) => isBotUser(review.user))
    .map((review) => ({
      user: review.user.login,
      state: review.state,
      body: truncate(review.body, 500),
      submitted_at: review.submitted_at
    }));
}

function listBotComments(comments) {
  return comments
    .filter((comment) => isBotUser(comment.user))
    .map((comment) => ({
      user: comment.user.login,
      path: comment.path,
      body: truncate(comment.body, 400)
    }));
}

function normalizeReactions(reactions) {
  return reactions.map((reaction) => ({
    user: reaction.user.login,
    content: reaction.content,
    created_at: reaction.created_at
  }));
}

function latestSubmittedAt(reviews) {
  return reviews
    .map((review) => review.submitted_at)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function latestCommitAt(commits) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return "";
  }

  const lastCommit = commits.at(-1);
  return lastCommit && lastCommit.commit && lastCommit.commit.committer
    ? lastCommit.commit.committer.date || ""
    : "";
}

function filterReactionsSince(reactions, content, baselineReviewAt) {
  return reactions.filter((reaction) => {
    return reaction.content === content && (baselineReviewAt === "" || reaction.created_at > baselineReviewAt);
  });
}

function filterReviewsSince(reviews, baselineReviewAt) {
  return reviews.filter((review) => baselineReviewAt === "" || review.submitted_at > baselineReviewAt);
}

function buildReviewPayload(reviews, comments, stale) {
  return {
    reviews,
    comments,
    stale
  };
}

function resolveInitialState(snapshot) {
  const botReviews = listBotReviews(snapshot.reviews);
  const reactions = normalizeReactions(snapshot.reactions);
  const lastCommitAtValue = latestCommitAt(snapshot.commits);

  let baselineReviewAt = "";
  let fallbackReviews = [];
  let event = null;

  if (botReviews.length > 0) {
    baselineReviewAt = latestSubmittedAt(botReviews);
    if (!lastCommitAtValue || lastCommitAtValue <= baselineReviewAt) {
      event = {
        type: "review",
        payload: buildReviewPayload(botReviews, listBotComments(snapshot.comments), false)
      };
      return { baselineReviewAt, fallbackReviews, event };
    }

    fallbackReviews = botReviews;
  }

  const thumbs = filterReactionsSince(reactions, "+1", baselineReviewAt);
  if (thumbs.length > 0) {
    event = {
      type: "lgtm",
      users: thumbs.map((reaction) => reaction.user)
    };
  }

  return { baselineReviewAt, fallbackReviews, event };
}

function formatEventLine(event, context = {}) {
  if (event.type === "started") {
    return `STARTED: watching PR #${context.prNumber} in ${context.repo}`;
  }

  if (event.type === "reviewing") {
    return `REVIEWING: eyes added by ${event.users.join(", ")}`;
  }

  if (event.type === "lgtm") {
    return `DONE:lgtm:${event.users.join(", ")}`;
  }

  if (event.type === "review") {
    return `DONE:review:${JSON.stringify(event.payload)}`;
  }

  throw new Error(`Unknown event type: ${event.type}`);
}

function createGhClient(dependencies = {}) {
  const execFileSyncImpl = dependencies.execFileSyncImpl || execFileSync;

  function readJson(args) {
    const raw = execFileSyncImpl("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return JSON.parse(raw);
  }

  return {
    viewCurrentPr() {
      return readJson(["pr", "view", "--json", "number,url,headRefName"]);
    },
    viewRepo() {
      return readJson(["repo", "view", "--json", "owner,name"]);
    },
    listCommits(repo, prNumber) {
      return readJson(["api", `repos/${repo}/pulls/${prNumber}/commits`]);
    },
    listReviews(repo, prNumber) {
      return readJson(["api", `repos/${repo}/pulls/${prNumber}/reviews`]);
    },
    listReactions(repo, prNumber) {
      return readJson(["api", `repos/${repo}/issues/${prNumber}/reactions`]);
    },
    listComments(repo, prNumber) {
      return readJson(["api", `repos/${repo}/pulls/${prNumber}/comments`]);
    }
  };
}

async function defaultSleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveTarget(options, ghClient) {
  let prNumber = options.prNumber;
  let repo = options.repo;

  if (!prNumber) {
    try {
      const pr = await ghClient.viewCurrentPr();
      prNumber = String(pr.number);
    } catch (error) {
      throw new Error("No open PR on this branch. Run `gh pr create` first.");
    }
  }

  if (!repo) {
    const repoView = await ghClient.viewRepo();
    repo = normalizeRepo(repoView);
  }

  return { prNumber, repo };
}

async function collectSnapshot(ghClient, target) {
  const [commits, reviews, reactions] = await Promise.all([
    ghClient.listCommits(target.repo, target.prNumber),
    ghClient.listReviews(target.repo, target.prNumber),
    ghClient.listReactions(target.repo, target.prNumber)
  ]);

  return { commits, reviews, reactions };
}

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const sleepImpl = dependencies.sleepImpl || defaultSleep;
  const ghClient = dependencies.ghClient || createGhClient(dependencies);

  const options = parseArgs(argv);
  if (options.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const target = await resolveTarget(options, ghClient);
  const initialSnapshot = await collectSnapshot(ghClient, target);
  initialSnapshot.comments = await ghClient.listComments(target.repo, target.prNumber);

  const initialState = resolveInitialState(initialSnapshot);
  if (initialState.event) {
    stdout.write(`${formatEventLine(initialState.event)}\n`);
    return 0;
  }

  stdout.write(`${formatEventLine({ type: "started" }, target)}\n`);

  if (options.once) {
    return 1;
  }

  let hasEyes = false;
  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    await sleepImpl(options.intervalSeconds * 1000);

    const snapshot = await collectSnapshot(ghClient, target);
    const reactions = normalizeReactions(snapshot.reactions);
    const eyes = filterReactionsSince(reactions, "eyes", initialState.baselineReviewAt);

    if (eyes.length > 0 && !hasEyes) {
      hasEyes = true;
      stdout.write(`${formatEventLine({ type: "reviewing", users: eyes.map((reaction) => reaction.user) })}\n`);
    }

    const thumbs = filterReactionsSince(reactions, "+1", initialState.baselineReviewAt);
    if (thumbs.length > 0) {
      stdout.write(`${formatEventLine({ type: "lgtm", users: thumbs.map((reaction) => reaction.user) })}\n`);
      return 0;
    }

    const newReviews = filterReviewsSince(listBotReviews(snapshot.reviews), initialState.baselineReviewAt);
    if (newReviews.length > 0) {
      const comments = listBotComments(await ghClient.listComments(target.repo, target.prNumber));
      stdout.write(
        `${formatEventLine({
          type: "review",
          payload: buildReviewPayload(newReviews, comments, false)
        })}\n`
      );
      return 0;
    }

    if (iteration >= options.staleAfter && initialState.fallbackReviews.length > 0) {
      const comments = listBotComments(await ghClient.listComments(target.repo, target.prNumber));
      stdout.write(
        `${formatEventLine({
          type: "review",
          payload: buildReviewPayload(initialState.fallbackReviews, comments, true)
        })}\n`
      );
      return 0;
    }
  }

  stderr.write(
    `No Codex reaction after ${options.intervalSeconds * options.maxIterations} seconds. Check manually with \`gh pr view ${target.prNumber}\`.\n`
  );
  return 2;
}

module.exports = {
  HELP_TEXT,
  buildReviewPayload,
  createGhClient,
  filterReactionsSince,
  filterReviewsSince,
  formatEventLine,
  isBotUser,
  listBotComments,
  listBotReviews,
  normalizeReactions,
  parseArgs,
  resolveInitialState,
  runCli
};
