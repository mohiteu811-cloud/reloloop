#!/bin/sh
set -e

# Schema sync run on every web service deploy.
#
# `prisma db push` refuses by default any change it deems
# potentially destructive (column drops, type narrowings, new
# unique constraints on populated tables). To intentionally apply
# a known-safe destructive change set PRISMA_ACCEPT_DATA_LOSS to
# the literal string "true" in Railway env, redeploy, then unset.
#
# Why an exact-string equality check rather than the shell's
# `${VAR:+...}` operator: `:+` expands for ANY non-empty value,
# including the strings "false" / "no" / "0". That makes "production
# safety" depend on unsetting the variable rather than setting it
# to a falsey value, which is a foot-gun. Be explicit instead.

FLAG=""
if [ "$PRISMA_ACCEPT_DATA_LOSS" = "true" ]; then
  FLAG="--accept-data-loss"
  echo "[db:deploy] PRISMA_ACCEPT_DATA_LOSS=true — destructive changes will be applied"
fi

prisma db push --skip-generate $FLAG
prisma db execute --file prisma/post-push.sql --schema prisma/schema.prisma
prisma db seed
