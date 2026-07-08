const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReviewPayload,
  formatEventLine,
  parseArgs,
  resolveInitialState,
  runCli
} = require("../lib/wait-codex");

test("parseArgs reads polling options", () => {
  const parsed = parseArgs([
    "--pr",
    "123",
    "--repo",
    "owner/name",
    "--interval",
    "5",
    "--max-iterations",
    "12",
    "--stale-after",
    "3",
    "--once"
  ]);

  assert.equal(parsed.prNumber, "123");
  assert.equal(parsed.repo, "owner/name");
  assert.equal(parsed.intervalSeconds, 5);
  assert.equal(parsed.maxIterations, 12);
  assert.equal(parsed.staleAfter, 3);
  assert.equal(parsed.once, true);
});

test("resolveInitialState exits early when a current bot review already exists", () => {
  const state = resolveInitialState({
    commits: [
      {
        commit: {
          committer: {
            date: "2026-07-06T10:00:00Z"
          }
        }
      }
    ],
    reviews: [
      {
        user: { login: "codex[bot]", type: "Bot" },
        state: "COMMENTED",
        body: "Looks good.",
        submitted_at: "2026-07-06T10:05:00Z"
      }
    ],
    reactions: [],
    comments: [
      {
        user: { login: "codex[bot]", type: "Bot" },
        path: "src/index.js",
        body: "Inline note."
      }
    ]
  });

  assert.equal(state.event.type, "review");
  assert.deepEqual(state.event.payload, {
    reviews: [
      {
        user: "codex[bot]",
        state: "COMMENTED",
        body: "Looks good.",
        submitted_at: "2026-07-06T10:05:00Z"
      }
    ],
    comments: [
      {
        user: "codex[bot]",
        path: "src/index.js",
        body: "Inline note."
      }
    ],
    stale: false
  });
});

test("resolveInitialState returns an LGTM event when thumbs-up appears after the baseline review", () => {
  const state = resolveInitialState({
    commits: [
      {
        commit: {
          committer: {
            date: "2026-07-06T11:00:00Z"
          }
        }
      }
    ],
    reviews: [
      {
        user: { login: "codex[bot]", type: "Bot" },
        state: "COMMENTED",
        body: "Previous review",
        submitted_at: "2026-07-06T10:00:00Z"
      }
    ],
    reactions: [
      {
        user: { login: "codex[bot]" },
        content: "+1",
        created_at: "2026-07-06T11:05:00Z"
      }
    ],
    comments: []
  });

  assert.deepEqual(state.event, {
    type: "lgtm",
    users: ["codex[bot]"]
  });
});

test("formatEventLine renders DONE:review payloads", () => {
  const line = formatEventLine({
    type: "review",
    payload: buildReviewPayload([{ user: "codex[bot]" }], [], true)
  });

  assert.match(line, /^DONE:review:/);
  assert.match(line, /"stale":true/);
});

test("runCli polls until it sees REVIEWING and DONE:lgtm", async () => {
  let reactionCall = 0;
  const output = [];
  const ghClient = {
    async viewCurrentPr() {
      return { number: 42, url: "https://github.com/example/repo/pull/42" };
    },
    async viewRepo() {
      return { owner: { login: "example" }, name: "repo" };
    },
    async listCommits() {
      return [
        {
          commit: {
            committer: {
              date: "2026-07-06T10:00:00Z"
            }
          }
        }
      ];
    },
    async listReviews() {
      return [];
    },
    async listReactions() {
      reactionCall += 1;
      if (reactionCall === 1) {
        return [];
      }

      if (reactionCall === 2) {
        return [
          {
            user: { login: "codex[bot]" },
            content: "eyes",
            created_at: "2026-07-06T10:10:00Z"
          }
        ];
      }

      return [
        {
          user: { login: "codex[bot]" },
          content: "+1",
          created_at: "2026-07-06T10:11:00Z"
        }
      ];
    },
    async listComments() {
      return [];
    }
  };

  const status = await runCli(["--interval", "0.001", "--max-iterations", "3"], {
    ghClient,
    sleepImpl: async () => {},
    stdout: {
      write(text) {
        output.push(text);
      }
    },
    stderr: {
      write() {}
    }
  });

  assert.equal(status, 0);
  assert.equal(output[0], "STARTED: watching PR #42 in example/repo\n");
  assert.equal(output[1], "REVIEWING: eyes added by codex[bot]\n");
  assert.equal(output[2], "DONE:lgtm:codex[bot]\n");
});
