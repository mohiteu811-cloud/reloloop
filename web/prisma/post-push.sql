-- Applied after `prisma db push` via `prisma db execute` in the
-- web service's start command. Everything in here MUST be
-- idempotent — it runs on every deploy.
--
-- Why this file exists: `prisma db push` syncs schema.prisma to
-- the database directly and ignores the `prisma/migrations/`
-- directory. So SQL we'd normally put in a migration (e.g. the
-- HNSW index that `Unsupported("vector(768)")` can't express)
-- lives here instead. When we adopt `prisma migrate deploy`,
-- this file's contents fold back into the first migration and
-- this file goes away.

-- HNSW index on the listing embedding vector. Required for the
-- pgvector cosine-similarity query in reloloop-schema.md §4.1 to
-- be performant. Created with cosine ops because that's the
-- distance the match query uses (`<=>`).
CREATE INDEX IF NOT EXISTS listing_embedding_hnsw
  ON "ListingEmbedding"
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
