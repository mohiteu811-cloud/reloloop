# LivinLoop on Railway

One Railway project, four services. Mirrors LivAround's deployment
pattern (`nixpacks.toml` + `railway.json` + `start.sh`), with a
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

## Services

### 1. `web` — Next.js 15 (App Router) + API routes

`railway.json` (root, same shape as LivAround):

```json
{
  "$schema": "https://railway.app/railway-schema.json",
  "build": {
    "builder": "NIXPACKS",
    "nixpacksConfigPath": "nixpacks.toml",
    "buildCommand": "npm install && npx prisma generate && npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/api/health"
  }
}
```

Domain: `api.livinloop.co` (or `app.livinloop.co` if web+API share
a host, which is the v1 default since we're a Next.js monolith).

Env vars: everything in `infra/.env.example` except `BULLMQ_PREFIX`
is only needed if the worker reads it differently.

### 2. `worker` — BullMQ consumers

Same repo, different start command. Picks up jobs from Redis and
runs:

- `photo:postprocess` — sharp thumbnails + perceptual hash + Photo rows
- `listing:autofill` — Claude vision extraction → valuation breakdown
- `listing:embed` — Replicate CLIP call → ListingEmbedding row → flip to LIVE
- `match:compute` — pgvector query → SwapMatch rows → notify
- `match:nightly` — full recompute (cron, 02:00 NZST)
- `fee:gate-timeout` — cancel + refund unpaid acceptances after 7 days

`railway.json` (per-service override — set in Railway dashboard,
not in the file, since both services share the repo):

```
Build command:  npm install && npx prisma generate && npm run build:worker
Start command:  node dist/worker/index.js
Healthcheck:    disabled (it's a queue consumer)
```

### 3. `postgres` — Railway Postgres plugin

After provisioning, connect via Railway CLI and enable extensions:

```bash
railway run --service postgres psql $DATABASE_URL -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;"
```

The HNSW index on `ListingEmbedding.vector` is created via a raw
SQL migration once the table exists:

```sql
CREATE INDEX listing_embedding_hnsw
  ON "ListingEmbedding"
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 4. `redis` — Railway Redis plugin

No config beyond the plugin defaults. BullMQ uses `REDIS_URL`
directly.

## Cross-service env wiring

Railway service-reference syntax (set these in the dashboard, not
the file, so they auto-update when plugins rotate creds):

| Service  | Var               | Reference                              |
|----------|-------------------|----------------------------------------|
| web      | `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`           |
| web      | `REDIS_URL`       | `${{Redis.REDIS_URL}}`                 |
| worker   | `DATABASE_URL`    | `${{Postgres.DATABASE_URL}}`           |
| worker   | `REDIS_URL`       | `${{Redis.REDIS_URL}}`                 |

Everything else (Anthropic, Replicate, PayPal, Resend, R2) is
shared identically across web and worker — copy the same values.

## Environments

Two Railway environments: `production` and `staging`. Mirror
LivAround's setup. Branch-deploy `staging` from `main`, manual
promote to `production`. Both have their own Postgres + Redis
plugins so we never mix data.

For PayPal: `staging` uses `PAYPAL_MODE=sandbox` with the
sandbox app credentials; `production` uses `PAYPAL_MODE=live`
with live credentials. The Orders v2 webhook is registered
twice — once per environment — with distinct webhook IDs.

## Migration from LivAround's setup

What we **don't** copy across:

- LivAround's Postgres (no pgvector, no isolation between products)
- LivAround's Stripe and Razorpay env vars (PayPal-only in v1)
- LivAround's Google Cloud Speech/Translate (no voice in v1)
- LivAround's iCal/Booking.com integrations
- LivAround's `PAYMENTS_ENABLED` master flag — replaced by
  the per-feature `FEES_ENABLED` flag, scoped to the swap-fee
  gate so M5 can ship before M6

What we **do** copy:

- The `nixpacks.toml` + `start.sh` build pattern
- R2 access keys + bucket-creation convention
- Resend API key (new domain)
- PayPal merchant identity (new REST app)
- Expo org + push token plumbing
