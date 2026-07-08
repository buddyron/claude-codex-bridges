#!/usr/bin/env node

const { runCli } = require("../lib/wait-codex");

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(`wait-codex: ${message}`);
    process.exitCode = 1;
  }
);
