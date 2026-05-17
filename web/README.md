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
npm run db:deploy                   # prisma db push + post-push.sql + seed
npm run dev                         # web on :3000
npm run dev:worker                  # worker, in a second terminal
```

The DB needs `pgcrypto` and `vector` extensions enabled before
`prisma db push` runs. Prisma will create them automatically
because they're declared in `prisma/schema.prisma` under
`extensions = [pgcrypto, vector]`, but the role used in
`DATABASE_URL` must have `SUPERUSER` or `CREATE EXTENSION`
privileges. On Railway Postgres, the default role does.

## What's in M1

- **Auth.js v5 with Resend magic-link** (`src/lib/auth.ts`,
  `src/app/api/auth/[...nextauth]/route.ts`, sign-in pages
  under `src/app/signin/`). Requires `RESEND_API_KEY` +
  `EMAIL_FROM` to be set or sign-in throws at runtime.
  Sessions use JWT strategy; only `User` + `VerificationToken`
  tables are needed from the schema doc — no `Account` /
  `Session` rows.
- **Seed** for 7 NZ cities and the 12 categories from
  `reloloop-schema.md` §3.3 (`prisma/seed.ts`). Idempotent
  upserts — runs on every deploy via `db:deploy`.
- **Manual Listing CRUD** — no AI yet. API endpoints under
  `src/app/api/listings/`, UI under `src/app/listings/`. The
  publish action flips DRAFT → LIVE directly; M3 will insert
  the PROCESSING state for AI extraction, and M4 will gate
  LIVE on the embedding being computed.

## Why `db:deploy` is three steps

`prisma db push` syncs the Prisma schema to the database and
does nothing else — it ignores `prisma/migrations/`. That's
fine for our tables, but the HNSW index on
`ListingEmbedding.vector` is raw SQL that `Unsupported("vector(768)")`
can't express through Prisma's DSL, and the city + category
seed lives outside the schema entirely.

So `db:deploy` chains:

1. `prisma db push --skip-generate [--accept-data-loss]` —
   tables, columns, indexes Prisma understands; extensions
   from the datasource block. The `--accept-data-loss` flag
   is appended only when `PRISMA_ACCEPT_DATA_LOSS=true` is set
   in the environment (see below).
2. `prisma db execute --file prisma/post-push.sql` — the HNSW
   index and any other raw SQL that needs to land after the
   tables exist. Idempotent (CREATE INDEX IF NOT EXISTS) so it
   runs cleanly on every deploy.
3. `prisma db seed` — upserts the cities + categories.
   Idempotent.

When we eventually run `prisma migrate dev` locally to capture
the schema as proper migration files, `db:deploy` collapses to
`prisma migrate deploy` and `post-push.sql` folds into the first
real migration.

### `PRISMA_ACCEPT_DATA_LOSS` — destructive change opt-in

Prisma `db push` refuses by default any change it deems
"potentially destructive" (column drops, type narrowings, new
unique constraints on populated tables). Deploys then fail with
*Use the --accept-data-loss flag*.

Default: the flag is **NOT** passed. A would-be destructive
schema edit blocks the deploy until a human reviews it.

To intentionally apply a known-safe destructive change (e.g. a
new `@@unique` on an empty table, or a real column rename you've
verified is safe), set in Railway:

```
PRISMA_ACCEPT_DATA_LOSS=true
```

Redeploy. **Unset it immediately after the deploy succeeds** so
the next accidental schema typo doesn't silently destroy live
data. Long-term we'll swap to `prisma migrate deploy` (which
applies recorded SQL exactly as written and surfaces destructive
changes in PR review) and retire this lever.
