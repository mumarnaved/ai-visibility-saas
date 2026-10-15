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

# ========================================
# SQL MIGRATIONS
#
# Tenant provisioning (and the migration scripts) read
# the .sql files from database/ at the repo root, which is
# outside this project's Root Directory (apps/worker) and
# so not part of the function bundle. Copy them into
# apps/worker/database/ (same layout) so they ship with the
# function; vercel.json "includeFiles" makes sure the
# bundler keeps them, since they are read through a
# computed path that file tracing cannot see.
# src/database/postgres/migrations-path.ts finds them
# there. The copy is gitignored; the repo-level database/
# stays the source of truth.
# ========================================

rm -rf apps/worker/database
mkdir -p apps/worker/database/platform apps/worker/database/tenant-template
cp -r database/platform/migrations apps/worker/database/platform/
cp -r database/tenant-template/migrations apps/worker/database/tenant-template/
find apps/worker/database -name '*.backup.sql' -delete

# Fail the build now rather than every signup later.
for dir in platform tenant-template; do
  if ! ls apps/worker/database/$dir/migrations/*.sql >/dev/null 2>&1; then
    echo "ERROR: no .sql migrations were copied for $dir" >&2
    exit 1
  fi
done

# Vercel (Framework Preset "Other") always looks for a
# public/ output directory after the build, even for a
# functions-only project with no static assets - nothing
# ever serves from it (vercel.json's rewrite sends every
# request to the API function instead), it just needs to
# exist so Vercel's build-completion check doesn't fail.
mkdir -p apps/worker/public
