# LivinLoop on Railway

One Railway project, four services. Mirrors LivAround's deployment
pattern (`nixpacks.toml` + `railway.json` + start command), with a
separate worker service added because LivinLoop is queue-heavy.

```
┌──────────────────────────────────────────────────────────────┐
│ Railway project: livinloop                                   │
│                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────────────┐    │
│  │   web      │   │  worker    │   │  postgres          │    │
│  │ Next.js 15 │──▶│ BullMQ     │──▶│  pgvector enabled  │    │
│  │ + API      │   │ consumers  │   │                    │    │
│  │ railway.   │   │ railway.   │   └────────────────────┘    │
│  │ json       │   │ worker.    │                              │
│  │            │   │ json       │                              │
│  └─────┬──────┘   └─────┬──────┘                              │
│        │                │                                    │
│        ▼                ▼                                    │
│  ┌────────────────────────────┐                              │
│  │  redis (BullMQ broker)     │                              │
│  └────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

App code lives in `web/`. Both the `web` and `worker` services
build from the same directory and the same `package.json`; they
differ only in their build and start commands, captured in
**separate config-as-code files per service** — see below.

We use `npm install` (not `npm ci`) until a `package-lock.json`
is committed. After the first local install on the repo, commit
the lockfile and switch all build commands to `npm ci`.

## Config-as-code: one file per service

Railway's config-file values **override** anything set in the
dashboard. So we can't share a single `railway.json` between web
and worker — the worker would inherit web's start command and
`/api/health` healthcheck. Instead, each service gets its own
file and you set the **Config-as-Code Path** in Service Settings
to point at it:

| Service | Config file            | Set this in Service Settings → Config-as-Code Path |
|---------|------------------------|----------------------------------------------------|
| web     | `railway.json`         | `railway.json` (the default — nothing to change)   |
| worker  | `railway.worker.json`  | `railway.worker.json`                              |

## Schema sync on deploy

The `web` service runs `npm run db:deploy` before booting Next.js.
That script is three steps, in order:

1. `prisma db push --skip-generate` — syncs schema.prisma to the
   database. Idempotent, additive-only by default (errors on
   destructive changes unless you pass `--accept-data-loss`).
   Creates the `pgcrypto` and `vector` extensions because
   they're declared in the datasource block.
2. `prisma db execute --file prisma/post-push.sql --schema
   prisma/schema.prisma` — applies raw SQL that Prisma's DSL
   can't express. Today that's just the HNSW index on
   `ListingEmbedding.vector`. Idempotent
   (`CREATE INDEX IF NOT EXISTS`).
3. `prisma db seed` — upserts the cities + categories.
   Idempotent.

We use this three-step rather than `prisma migrate deploy` because
we don't have generated migration files yet — only the raw SQL
in `prisma/migrations/00000000000000_init_pgvector/migration.sql`,
which is documentation today (`db push` ignores it). Once we run
`prisma migrate dev` locally to capture table changes as proper
migrations, swap the script to:

```
prisma migrate deploy && prisma db seed
```

and fold `post-push.sql` into the first real migration.

The **worker** service does NOT run schema sync — only the web
service does, to avoid two parallel deploys racing on the same
DDL. If you ever deploy worker-first to a fresh database, run
`npm run db:deploy` manually once before booting it.

## Services

### 1. `web` — Next.js 15 (App Router) + API routes

Uses `railway.json` (repo root):

```json
{
  "build": {
    "builder": "NIXPACKS",
    "nixpacksConfigPath": "nixpacks.toml",
    "buildCommand": "cd web && npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "cd web && npm run db:deploy && npm run start",
    "healthcheckPath": "/api/health"
  }
}
```

`/api/health` pings Postgres via Prisma; if `DATABASE_URL` is
misconfigured the healthcheck fails (with a generic `{ status:
"error" }` body — driver details stay in server logs).

Domain: `app.livinloop.co` (web + API share a host in v1 since
we're a Next.js monolith).

### 2. `worker` — BullMQ consumers

Uses `railway.worker.json`:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "nixpacksConfigPath": "nixpacks.toml",
    "buildCommand": "cd web && npm install && npx prisma generate && npm run build:worker"
  },
  "deploy": {
    "startCommand": "cd web && npm run start:worker"
  }
}
```

No healthcheck (queue consumer, no HTTP). No `prisma db push` —
web owns schema sync.

Queues consumed (stubs in M1, real handlers added per milestone):

- `photo:postprocess` — sharp thumbnails + perceptual hash (M2)
- `listing:autofill` — Claude vision extraction + valuation (M3)
- `listing:embed` — Replicate CLIP → ListingEmbedding (M4)
- `match:compute` — pgvector query → SwapMatch rows (M4)
- `match:nightly` — cron, 02:00 NZST full recompute (M4)
- `fee:gate-timeout` — cron, refund unpaid acceptances after 7 days (M6)

### 3. `postgres` — Railway Postgres plugin

After provisioning, connect via Railway CLI and enable extensions:

```bash
railway run --service Postgres psql $DATABASE_URL -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;"
```

Prisma also declares these in `extensions = [pgcrypto, vector]`,
so the first `prisma db push` on deploy will create them — but
doing it upfront prevents a chicken-and-egg if the deploy role
ever lacks `CREATE EXTENSION`.

The HNSW index on `ListingEmbedding.vector` is applied by
`prisma/post-push.sql`, run by `prisma db execute` in the start
command right after `db push`.

### 4. `redis` — Railway Redis plugin

No config beyond the plugin defaults. BullMQ uses `REDIS_URL`
directly. The worker registers queues under the prefix from
`BULLMQ_PREFIX` (defaults to `livinloop`).

## Cross-service env wiring

Set these in the Railway dashboard via service-reference syntax
(not in env files) so they auto-update when plugins rotate creds:

| Service  | Var               | Reference                              |
|----------|-------------------|----------------------------------------|
| web      | `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`           |
| web      | `REDIS_URL`       | `${{Redis.REDIS_URL}}`                 |
| worker   | `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`           |
| worker   | `REDIS_URL`       | `${{Redis.REDIS_URL}}`                 |

Everything else (Anthropic, Replicate, PayPal, Resend, R2) is
shared identically across web and worker — copy the same values
from `infra/.env.example`.

## Environments

Two Railway environments: `production` and `staging`. Mirror
LivAround's setup. Branch-deploy `staging` from `main`, manual
promote to `production`. Both have their own Postgres + Redis
plugins so we never mix data.

For PayPal: `staging` uses `PAYPAL_MODE=sandbox` with the
sandbox app credentials; `production` uses `PAYPAL_MODE=live`
with live credentials. The Orders v2 webhook is registered
twice — once per environment — with distinct webhook IDs.

## First-deploy checklist

1. Add the **Redis** plugin to the project (Postgres is already up).
2. Enable extensions on Postgres (one-time):
   ```bash
   railway run --service Postgres psql $DATABASE_URL -c \
     "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;"
   ```
3. Point both `web` and `worker` services at the GitHub repo
   `mohiteu811-cloud/reloloop`, branch
   `claude/mobile-app-photo-analysis-JssHT` (or `main` after merge).
4. In **Worker → Settings → Config-as-Code Path**, set
   `railway.worker.json`. (Web stays on the default
   `railway.json`.)
5. Set the service-reference env vars (table above) on both.
6. Paste secrets (Anthropic, Resend, R2, PayPal) from
   `infra/.env.example` into both services. Use the same values.
7. Deploy `web` first — its start command runs `npm run db:deploy`
   to create tables, indexes, and seed. Confirm /api/health → 200.
8. Deploy `worker`. Confirm logs show `[worker] booted with 6 queues`.

## Migration from LivAround's setup

What we **don't** copy across:

- LivAround's Postgres (no pgvector, no isolation between products)
- LivAround's Stripe and Razorpay env vars (PayPal-only in v1)
- LivAround's Google Cloud Speech/Translate (no voice in v1)
- LivAround's iCal/Booking.com integrations
- LivAround's `PAYMENTS_ENABLED` master flag — replaced by the
  per-feature `FEES_ENABLED` flag, scoped to the swap-fee gate so
  M5 can ship before M6

What we **do** copy:

- The `nixpacks.toml` + `start.sh` build pattern
- R2 access keys + bucket-creation convention
- Resend API key (new domain)
- PayPal merchant identity (new REST app)
- Expo org + push token plumbing
