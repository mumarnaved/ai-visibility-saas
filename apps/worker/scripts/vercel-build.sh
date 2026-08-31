#!/usr/bin/env bash
set -euo pipefail

# ========================================
# VERCEL BUILD SCRIPT
#
# Runs with cwd = apps/worker (this
# project's Root Directory in Vercel).
#
# pnpm links workspace packages (like
# agent-contracts) into node_modules with
# a symlink straight to their source
# folder under packages/ - it never
# copies them. Vercel's Node File Trace
# doesn't reliably follow that symlink
# together with agent-contracts's
# package.json "exports" map, so the
# compiled dist/ output silently never
# makes it into the deployed function
# bundle - the deployed function then
# fails at runtime with
# ERR_MODULE_NOT_FOUND: Cannot find
# package 'agent-contracts'.
#
# The fix: after building agent-contracts,
# delete the symlink and replace it with a
# real, local copy of the compiled output.
# That turns it into an ordinary npm-style
# dependency sitting directly inside
# apps/worker/node_modules - nothing left
# for the bundler to symlink-trace.
# ========================================

cd ../..

pnpm install --frozen-lockfile
pnpm --filter agent-contracts build

rm -rf apps/worker/node_modules/agent-contracts
mkdir -p apps/worker/node_modules/agent-contracts
cp -r \
  packages/agent-contracts/dist \
  packages/agent-contracts/package.json \
  apps/worker/node_modules/agent-contracts/
