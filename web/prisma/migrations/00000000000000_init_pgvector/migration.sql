-- NOT APPLIED BY THE CURRENT DEPLOY WORKFLOW.
--
-- We use `prisma db push` (not `prisma migrate deploy`) until we
-- generate proper Prisma migrations from a real schema-change
-- session. `db push` reads schema.prisma directly and ignores
-- this directory entirely — nothing in here runs on deploy.
--
-- Where each piece actually gets applied today:
--
--   * Postgres extensions (pgcrypto, vector) — declared in
--     prisma/schema.prisma under `extensions = [pgcrypto, vector]`,
--     created by `db push` automatically.
--
--   * HNSW index on ListingEmbedding.vector — lives in
--     prisma/post-push.sql, run by `prisma db execute` right after
--     `db push` in the web service's start command.
--
-- When we switch to `prisma migrate deploy`, this file becomes the
-- first migration in history and applies as written below. Until
-- then it's documentation — the SQL is correct, just inert.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
