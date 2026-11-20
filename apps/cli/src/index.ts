#!/usr/bin/env node
import { runCli } from "./commands.js"

const exitCode = await runCli(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
})

process.exitCode = exitCode
