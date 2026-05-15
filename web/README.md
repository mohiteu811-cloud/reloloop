# LivinLoop web

Next.js 15 (App Router) + Prisma + BullMQ worker. Deploys as
two Railway services from this same directory:

- **web** — `npm ci && npx prisma generate && npm run build`
  then `npm run start`. Healthcheck: `/api/health`.
- **worker** — `npm ci && npx prisma generate && npm run
  build:worker` then `npm run start:worker`. No healthcheck.

Local dev:

```bash
cp ../infra/.env.example .env.local
npm install
npx prisma db push          # requires pgvector on the target DB
npm run dev                 # web on :3000
npm run dev:worker          # worker, in a second terminal
```

The DB needs `pgcrypto` and `vector` extensions enabled before
`prisma db push` runs. Prisma will create them automatically
because they're declared in `prisma/schema.prisma` under
`extensions = [pgcrypto, vector]`, but the role used in
`DATABASE_URL` must have `SUPERUSER` or `CREATE EXTENSION`
privileges. On Railway Postgres, the default role does.

The HNSW index on `ListingEmbedding.vector` is created via
the raw SQL migration in
`prisma/migrations/00000000000000_init_pgvector/migration.sql`.
