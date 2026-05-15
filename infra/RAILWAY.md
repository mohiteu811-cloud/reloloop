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
│  └─────┬──────┘   └─────┬──────┘   └────────────────────┘    │
│        │                │                                    │
│        ▼                ▼                                    │
│  ┌────────────────────────────┐                              │
│  │  redis (BullMQ broker)     │                              │
│  └────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

App code lives in `web/`. Both the `web` and `worker` services
build from the same directory and the same `package.json`; they
differ only in their build and start commands.

## Services

### 1. `web` — Next.js 15 (App Router) + API routes

The repo-root `railway.json` is wired for this service:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "nixpacksConfigPath": "nixpacks.toml",
    "buildCommand": "cd web && npm ci && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "cd web && npm run start",
    "healthcheckPath": "/api/health"
  }
}
```

`/api/health` pings Postgres via Prisma; if `DATABASE_URL` is
misconfigured the healthcheck fails loudly during deploy.

Domain: `app.livinloop.co` (web + API share a host in v1 since
we're a Next.js monolith).

### 2. `worker` — BullMQ consumers

Same repo, different start command. Override per-service in the
Railway dashboard (Settings → Build/Deploy):

```
Build command:  cd web && npm ci && npx prisma generate && npm run build:worker
Start command:  cd web && npm run start:worker
Healthcheck:    disabled (queue consumer, no HTTP)
```

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
so a fresh `prisma migrate dev` would create them — but doing it
upfront prevents a chicken-and-egg with the first migration.

The HNSW index on `ListingEmbedding.vector` is created via a
raw SQL migration (`web/prisma/migrations/...`) once the table
exists.

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
4. In Settings for **worker**, override Build/Start to the worker
   commands above and disable the healthcheck.
5. Set the service-reference env vars (table above) on both.
6. Paste secrets (Anthropic, Resend, R2, PayPal) from
   `infra/.env.example` into both services. Use the same values.
7. Deploy. Confirm `web` boots with /api/health → 200, and the
   worker logs `[worker] booted with 6 queues`.

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
