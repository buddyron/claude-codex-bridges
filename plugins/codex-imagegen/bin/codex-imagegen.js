#!/usr/bin/env node

const { runCli } = require("../lib/codex-imagegen");

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(`codex-imagegen: ${message}`);
    process.exitCode = 1;
  }
);
