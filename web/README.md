# LivinLoop web

Next.js 15 (App Router) + Prisma + BullMQ worker. Deploys as
two Railway services from this same directory:

- **web** — `npm install && npx prisma generate && npm run build`
  then `npm run db:deploy && npm run start`. Healthcheck:
  `/api/health`.
- **worker** — `npm install && npx prisma generate && npm run
  build:worker` then `npm run start:worker`. No healthcheck. No
  schema sync (web owns it).

`npm install` (not `npm ci`) until we commit a `package-lock.json`;
the first local install will generate one and we'll commit it back
so later deploys can use `npm ci` for reproducibility.

Local dev:

```bash
cp ../infra/.env.example .env       # Prisma CLI + Next.js both read .env
npm install
npm run db:deploy                   # prisma db push + post-push.sql
npm run dev                         # web on :3000
npm run dev:worker                  # worker, in a second terminal
```

The DB needs `pgcrypto` and `vector` extensions enabled before
`prisma db push` runs. Prisma will create them automatically
because they're declared in `prisma/schema.prisma` under
`extensions = [pgcrypto, vector]`, but the role used in
`DATABASE_URL` must have `SUPERUSER` or `CREATE EXTENSION`
privileges. On Railway Postgres, the default role does.

## Why `db:deploy` is two steps

`prisma db push` syncs the Prisma schema to the database and
does nothing else — it ignores `prisma/migrations/`. That's
fine for our tables, but the HNSW index on
`ListingEmbedding.vector` is raw SQL that `Unsupported("vector(768)")`
can't express through Prisma's DSL.

So `db:deploy` chains:

1. `prisma db push --skip-generate` — tables, columns, indexes
   Prisma understands, extensions from the datasource block.
2. `prisma db execute --file prisma/post-push.sql` — the HNSW
   index and any other raw SQL that needs to land after the
   tables exist. Idempotent (CREATE INDEX IF NOT EXISTS) so it
   runs cleanly on every deploy.

When we eventually run `prisma migrate dev` locally to capture
the schema as proper migration files, `db:deploy` collapses to
`prisma migrate deploy` and `post-push.sql` folds into the first
real migration.
