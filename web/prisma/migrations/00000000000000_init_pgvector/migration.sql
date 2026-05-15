-- Enable required extensions before Prisma's generated migrations run.
-- Idempotent: safe to re-run.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- The HNSW index on ListingEmbedding.vector is created in a follow-up
-- migration once Prisma generates the table. Kept here as a note so
-- the schema doc and the migration history stay aligned:
--
--   CREATE INDEX listing_embedding_hnsw
--     ON "ListingEmbedding"
--     USING hnsw (vector vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
