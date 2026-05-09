# ReloLoop — schema, matching, APIs

A companion to `reloloop-wireframe.html`. This document is the technical spine: the data model, how matching works, the API surface, and the photo capture pipeline. Written for whoever (or whatever — Claude Code) builds it.

## 0 — Stack

Boring on purpose. Every component is mature, well-documented, and easy to swap.

- **Next.js 15** (App Router) for web + API routes
- **Prisma** as the ORM
- **Postgres** with the **pgvector** extension for similarity search
- **Auth.js v5** with the Resend provider for magic-link sign-in
- **BullMQ + Redis** for async workers (embedding, notifications, payouts)
- **Cloudflare R2** for object storage (S3-compatible, zero egress)
- **tus.io** for resumable photo uploads
- **Gemini 2.5 Flash** for vision (auto-fill listing fields from photos)
- **CLIP ViT-B/32** for image+text embeddings (server-side, via Replicate or self-hosted)
- **React Native + Expo** for the mobile client (Phase 2; web-first for pilot)

The architectural rule that overrides every other preference: **all AI runs server-side**. The client uploads bytes, polls for status, displays results. No on-device frame extraction, no on-device inference. Lessons from prior mobile work — Android codec quirks ate weeks of debugging.

## 1 — Schema

### 1.1 Required Postgres extensions

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
```

### 1.2 Prisma schema

```prisma
// datasource & generator omitted for brevity

// ============================================================
// AUTH (Auth.js v5 expects these tables — see PrismaAdapter docs)
// ============================================================

model User {
  id             String     @id @default(cuid())
  email          String     @unique
  name           String?
  image          String?
  emailVerified  DateTime?
  phone          String?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  moves          Move[]
  listings       Listing[]
  offers         Offer[]
  watchedItems   Watch[]
  conversations  ConversationParticipant[]
  messages       Message[]

  @@index([email])
}

model VerificationToken {
  identifier  String
  token       String   @unique
  expires     DateTime
  @@unique([identifier, token])
}

// ============================================================
// GEOGRAPHY
// ============================================================

model City {
  id        String   @id @default(cuid())
  slug      String   @unique           // "auckland", "wellington", "christchurch"
  name      String                     // "Auckland"
  country   String   @default("NZ")
  lat       Float
  lng       Float
  active    Boolean  @default(true)    // pilot cities

  movesFrom Move[]    @relation("MoveFromCity")
  movesTo   Move[]    @relation("MoveToCity")
  routesFrom DeliveryRoute[] @relation("RouteFromCity")
  routesTo   DeliveryRoute[] @relation("RouteToCity")
  listings  Listing[]                  // denormalised for fast filtering

  @@index([slug])
}

// ============================================================
// MOVE — the spine of every user's experience
// ============================================================

enum MoveRole {
  SELLER
  BUYER
  BOTH
}

model Move {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  fromCityId   String?  // null for buyers without an origin
  fromCity     City?    @relation("MoveFromCity", fields: [fromCityId], references: [id])
  toCityId     String
  toCity       City     @relation("MoveToCity", fields: [toCityId], references: [id])

  moveDate     DateTime              // intended arrival at destination
  flexibilityDays Int  @default(0)   // how flexible (+/- days)
  role         MoveRole

  // for buyers: declared categories of interest
  // stored as ItemCategory.slug array, denormalised for query simplicity
  wants        String[]              @default([])

  status       MoveStatus @default(PLANNING)
  listings     Listing[]

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([toCityId, moveDate])
  @@index([userId])
}

enum MoveStatus {
  PLANNING
  ACTIVE
  COMPLETED
  CANCELLED
}

// ============================================================
// CATEGORY — the 12-item taxonomy from onboarding
// ============================================================

model ItemCategory {
  id           String    @id @default(cuid())
  slug         String    @unique     // "sofa", "fridge", "tv", ...
  name         String                // "Sofa"
  parentSlug   String?               // for sub-categories later
  active       Boolean   @default(true)
  sortOrder    Int       @default(0)

  listings     Listing[]

  @@index([slug])
}

// Seeded categories: sofa, fridge, washer, tv, bed, dining,
// wardrobe, desk, kitchen, rugs, outdoor, other

// ============================================================
// LISTING — an item being sold
// ============================================================

enum Condition {
  LIKE_NEW
  GOOD
  USED
  WORN
}

enum ListingStatus {
  DRAFT          // being created, photos uploading
  PROCESSING     // photos uploaded, AI analysing
  LIVE           // visible in feeds
  RESERVED       // offer accepted, awaiting pickup
  SOLD           // delivered + paid out
  WITHDRAWN
}

model Listing {
  id           String          @id @default(cuid())
  moveId       String
  move         Move            @relation(fields: [moveId], references: [id], onDelete: Cascade)
  sellerId     String                      // denormalised from move
  seller       User            @relation(fields: [sellerId], references: [id])

  // Origin city denormalised so feed queries don't need to join Move
  cityId       String
  city         City            @relation(fields: [cityId], references: [id])

  categoryId   String
  category     ItemCategory    @relation(fields: [categoryId], references: [id])

  title        String                      // "3-seater linen sofa"
  description  String?         @db.Text
  condition    Condition
  priceCents   Int                         // NZD cents, e.g. 65000 = $650

  // AI-extracted dimensions, used for delivery capacity
  widthCm      Int?
  depthCm      Int?
  heightCm     Int?
  weightKg     Float?
  volumeM3     Float?                      // computed when dims known

  // Pickup
  pickupNotes  String?
  pickupReadyAt DateTime?                  // when seller can release

  status       ListingStatus   @default(DRAFT)
  publishedAt  DateTime?
  reservedAt   DateTime?
  soldAt       DateTime?

  photos       Photo[]
  embedding    ListingEmbedding?
  offers       Offer[]
  watches      Watch[]
  conversations Conversation[]
  matchesA     Match[]         @relation("MatchA")
  matchesB     Match[]         @relation("MatchB")

  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  // The composite index that powers the feed
  @@index([cityId, categoryId, status, priceCents])
  @@index([status, publishedAt])
  @@index([sellerId])
}

// ============================================================
// PHOTO
// ============================================================

model Photo {
  id           String    @id @default(cuid())
  listingId    String
  listing      Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)

  r2Key        String                      // path in R2 bucket
  url          String                      // CDN URL
  thumbUrl     String?                     // 480px thumb
  width        Int?
  height       Int?
  bytes        Int?
  perceptualHash String?                  // for dedup
  sortOrder    Int       @default(0)

  uploadedAt   DateTime  @default(now())

  @@index([listingId])
}

// ============================================================
// EMBEDDING — the heart of matching
// ============================================================

model ListingEmbedding {
  listingId    String    @id
  listing      Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)

  // pgvector — Prisma needs Unsupported() for this type
  vector       Unsupported("vector(768)")

  modelName    String                      // "clip-vit-b-32"
  modelVersion String                      // version pin for reproducibility
  computedAt   DateTime  @default(now())

  // Note: HNSW index created via raw SQL migration:
  // CREATE INDEX listing_embedding_hnsw
  //   ON "ListingEmbedding"
  //   USING hnsw (vector vector_cosine_ops)
  //   WITH (m = 16, ef_construction = 64);
}

// User-side preference vector — built from saved/watched items + wants
model UserPreferenceVector {
  userId       String    @id
  vector       Unsupported("vector(768)")
  computedAt   DateTime  @default(now())
}

// ============================================================
// MATCH — pre-computed comparable pairs (nightly job)
// ============================================================

model Match {
  id           String    @id @default(cuid())
  listingAId   String
  listingA     Listing   @relation("MatchA", fields: [listingAId], references: [id], onDelete: Cascade)
  listingBId   String
  listingB     Listing   @relation("MatchB", fields: [listingBId], references: [id], onDelete: Cascade)
  score        Float                        // cosine similarity, 0..1
  computedAt   DateTime  @default(now())

  @@unique([listingAId, listingBId])
  @@index([listingAId, score])
  @@index([listingBId, score])
}

// ============================================================
// MARKETPLACE — offers, watches, conversations
// ============================================================

enum OfferStatus {
  PENDING
  ACCEPTED
  REJECTED
  EXPIRED
  WITHDRAWN
}

model Offer {
  id           String       @id @default(cuid())
  listingId    String
  listing      Listing      @relation(fields: [listingId], references: [id], onDelete: Cascade)
  buyerId      String
  buyer        User         @relation(fields: [buyerId], references: [id])
  amountCents  Int
  message      String?
  status       OfferStatus  @default(PENDING)
  expiresAt    DateTime
  acceptedAt   DateTime?
  rejectedAt   DateTime?
  matchScore   Float?                       // cached for dashboard sort

  createdAt    DateTime     @default(now())

  @@index([listingId, status])
  @@index([buyerId])
}

model Watch {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  listingId    String
  listing      Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  alertOnDrop  Boolean   @default(true)
  alertOnMatch Boolean   @default(true)
  createdAt    DateTime  @default(now())

  @@unique([userId, listingId])
  @@index([listingId])
}

model Conversation {
  id           String                    @id @default(cuid())
  listingId    String
  listing      Listing                   @relation(fields: [listingId], references: [id], onDelete: Cascade)
  participants ConversationParticipant[]
  messages     Message[]
  lastMessageAt DateTime?
  createdAt    DateTime                  @default(now())

  @@index([listingId])
  @@index([lastMessageAt])
}

model ConversationParticipant {
  id              String       @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId          String
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastReadAt      DateTime?

  @@unique([conversationId, userId])
}

model Message {
  id              String       @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  authorId        String
  author          User         @relation(fields: [authorId], references: [id])
  body            String       @db.Text
  attachments     Json?                          // [{url, type, ...}]
  createdAt       DateTime     @default(now())

  @@index([conversationId, createdAt])
}

// ============================================================
// LOGISTICS — Crown's existing routes + bookings
// ============================================================

model DeliveryRoute {
  id            String       @id @default(cuid())
  fromCityId    String
  fromCity      City         @relation("RouteFromCity", fields: [fromCityId], references: [id])
  toCityId      String
  toCity        City         @relation("RouteToCity", fields: [toCityId], references: [id])
  runDate       DateTime                       // departure date
  arrivalDate   DateTime
  capacityM3    Float                          // total truck volume
  allocatedM3   Float        @default(0)       // committed bookings
  status        RouteStatus  @default(SCHEDULED)
  bookings      Booking[]

  createdAt     DateTime     @default(now())

  @@index([fromCityId, toCityId, runDate])
  @@index([runDate, status])
}

enum RouteStatus {
  SCHEDULED
  IN_TRANSIT
  COMPLETED
  CANCELLED
}

enum BookingStatus {
  PENDING_PICKUP
  PICKED_UP
  IN_TRANSIT
  DELIVERED
  CANCELLED
  REFUNDED
}

model Booking {
  id              String         @id @default(cuid())
  listingId       String         @unique
  buyerId         String
  sellerId        String
  routeId         String
  route           DeliveryRoute  @relation(fields: [routeId], references: [id])

  itemAmountCents Int                           // final agreed price
  deliveryFeeCents Int                          // Crown's slice
  commissionCents Int                           // ReloLoop's slice
  totalChargedCents Int

  pickupWindowStart DateTime
  pickupWindowEnd   DateTime
  deliveredAt       DateTime?
  status          BookingStatus  @default(PENDING_PICKUP)

  payoutAt        DateTime?                     // when seller is paid
  payoutAmountCents Int?

  createdAt       DateTime       @default(now())

  @@index([routeId])
  @@index([buyerId])
  @@index([sellerId])
}
```

### 1.3 Notes on the schema

**Denormalisation of `cityId` on Listing.** The buyer feed filters by destination/origin city all day. Joining through Move on every query would be wasteful. We snapshot `cityId` (origin) on Listing at create time. Move location changes are rare; if a seller relocates mid-flow, we re-snapshot on update.

**`volumeM3` on Listing** is the AI-extracted bounding-box volume. It's how Crown knows whether a fridge fits on Saturday's truck. Not perfectly accurate, but accurate enough for capacity planning.

**`Match` is computed nightly, not on the fly.** A BullMQ cron job runs at 02:00 NZST, scans listings published in the last 24h, finds top-K cosine neighbours within the same category, and writes Match rows where `score > 0.85`. Real-time matching for the buyer feed uses the index directly (faster than reading Match for fresh listings).

**`UserPreferenceVector`** is the buyer-side counterpart. Computed from their watched items + wants categories + browsing history. Updated when they add or remove a watch.

## 2 — The matching algorithm

One primitive: vector cosine similarity over a 768-dim embedding combining a CLIP image embedding and a text embedding from title + description + condition. Everything else layers as filters.

### 2.1 Embedding generation

When a listing is published:

1. Worker reads the photos from R2.
2. Each photo → CLIP image encoder → 512-dim vector.
3. Mean-pool the per-photo vectors into one 512-dim image vector.
4. Concatenate `title + " " + condition + " " + description` → CLIP text encoder → 512-dim text vector.
5. Concatenate image + text → reduce to 768-dim via a learned projection (or just use the concatenation and accept 1024-dim if you want to skip the projection in v1).
6. L2-normalise.
7. Persist to `ListingEmbedding`.

For pricing intelligence and comparable-detection, the embedding lives. For one-off "find me similar to X" queries, we run the same query against pgvector.

### 2.2 The four query patterns

#### Buyer feed query

```sql
-- Show Sarah listings in CHC (her destination) within her budget,
-- ordered by similarity to her preference vector
SELECT l.*,
  1 - (e.vector <=> $1::vector) AS similarity
FROM "Listing" l
JOIN "ListingEmbedding" e ON e."listingId" = l.id
WHERE l.status = 'LIVE'
  AND l."cityId" = $2                    -- Or in cities with routes to her dest
  AND l."priceCents" <= $3
  AND ($4::text[] IS NULL OR l."categoryId" = ANY($4))
ORDER BY e.vector <=> $1::vector         -- pgvector cosine distance operator
LIMIT 20;
```

The `<=>` operator is pgvector's cosine distance. Wrapping with `1 -` gives similarity (0..1, higher = more similar).

#### Pricing recommendation

When a seller publishes, find the K=10 nearest neighbours in same category + same condition tier:

```sql
SELECT l."priceCents"
FROM "Listing" l
JOIN "ListingEmbedding" e ON e."listingId" = l.id
WHERE l."categoryId" = $1
  AND l."condition" = $2
  AND l.status IN ('LIVE', 'SOLD')
  AND l.id != $3
ORDER BY e.vector <=> $4::vector
LIMIT 10;
```

Compute `median ± stdev` in application code, return as suggested range.

#### Comparable badge / "comparable on this route"

For a listing detail screen, show 3-5 comparable peer listings:

```sql
SELECT l.*
FROM "Listing" l
JOIN "ListingEmbedding" e ON e."listingId" = l.id
WHERE l.id != $1
  AND l."categoryId" = $2
  AND l.status = 'LIVE'
  AND (l."cityId" = $3 OR EXISTS (             -- same origin OR same route exists
    SELECT 1 FROM "DeliveryRoute" dr
    WHERE dr."fromCityId" = l."cityId"
      AND dr."toCityId" = $4                    -- buyer's destination
      AND dr."runDate" BETWEEN NOW() AND $5     -- before buyer's move date
  ))
ORDER BY e.vector <=> $6::vector
LIMIT 5;
```

This is the query that surfaces Sriram's TV next to Mohit's TV when both are AKL→CHC.

#### Cross-direction routing

For ops/dispatch: given a Crown route AKL→CHC on Saturday with 40% spare capacity, what listings could be bundled?

```sql
SELECT l.*
FROM "Listing" l
WHERE l.status = 'LIVE'
  AND l."cityId" = $1                          -- origin
  AND EXISTS (                                  -- buyer interest in destination
    SELECT 1 FROM "Move" m
    WHERE m."toCityId" = $2
      AND m."moveDate" BETWEEN $3 AND $4
      AND $5 = ANY(m.wants)                     -- want this category
  )
ORDER BY l."volumeM3" ASC                       -- prefer smaller items to fill remainder
LIMIT 20;
```

Then operationally: dispatch reaches out to the matched buyers with "this is on the truck Saturday — claim it before it ships."

### 2.3 Index tuning

```sql
-- HNSW for fast approximate cosine
CREATE INDEX listing_embedding_hnsw
  ON "ListingEmbedding"
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- For fresh listings before the index updates
CREATE INDEX listing_embedding_recent
  ON "ListingEmbedding" ("computedAt")
  WHERE "computedAt" > NOW() - INTERVAL '24 hours';
```

At pilot scale (target: 3,500 listings in year 1), recall is fine even without HNSW. Add the index pre-emptively; it's cheap.

## 3 — Photo capture pipeline

### 3.1 The architectural rule

**No client-side AI. No client-side frame extraction. No client-side compression decisions beyond what the OS gives you for free.**

The client uploads bytes. The server does everything else. This is non-negotiable based on prior mobile work — Android codec quirks (HEVC on certain chipsets) repeatedly crashed thumbnail/frame-extraction libraries. Server-side ffmpeg is rock-solid.

### 3.2 The flow

1. **Client (web or mobile):**
   - User takes photos (browser FileReader API, or `expo-camera` on mobile).
   - Initiate listing: `POST /api/listings` returns `{ listingId, photoUploads: [{ uploadUrl, photoId }, ...] }`.
   - Each photo uploaded via tus.io resumable upload to a per-photo presigned R2 URL.
   - Client polls `GET /api/listings/:id` for status: DRAFT → PROCESSING → LIVE.

2. **Worker (BullMQ):**
   - Triggered when last photo finishes uploading.
   - Pulls photos from R2.
   - Runs sharp for thumbnail generation (480px, WebP, written back to R2).
   - Computes perceptual hash (pHash) for dedup.
   - Calls Gemini 2.5 Flash with all photos + a structured-output prompt:
     ```
     Look at these photos of an item being sold by someone moving house.
     Return JSON with: title (≤80 chars), category (one of: sofa, fridge,
     washer, tv, bed, dining, wardrobe, desk, kitchen, rugs, outdoor,
     other), condition (LIKE_NEW, GOOD, USED, WORN), estimated dimensions
     in cm (width, depth, height), and any visible defects.
     ```
   - Updates `Listing` with auto-filled fields. Status stays `DRAFT` so seller can review.
   - When seller publishes: status → `PROCESSING`, embedding worker picks it up.

3. **Embedding worker:**
   - Reads listing + photos.
   - Runs CLIP image encoder (Replicate API for v1; self-host on a small GPU later).
   - Runs CLIP text encoder on title + description + condition.
   - Persists `ListingEmbedding`.
   - Status → `LIVE`. Triggers downstream: notify watchers, surface in feeds.

### 3.3 Why tus, not direct upload

tus.io supports resumable uploads. On a flaky NZ mobile connection, a 4-photo upload that fails at 80% should resume, not restart. tus also handles chunking + parallel streams for large files (relevant if we add walkthrough video in v2).

R2 supports tus via the `tus-node-server` package or via Cloudflare's native multipart API. Either is fine.

## 4 — APIs

The whole app driven by ~12 endpoints. REST, JSON, JWT in cookies via Auth.js.

### 4.1 Auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/signin/email` | Send magic link to email |
| `GET`  | `/api/auth/callback/email` | Magic-link callback |
| `POST` | `/api/auth/signout` | Sign out |

### 4.2 Move

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/moves` | Create user's move (city, date, role, wants) |
| `PATCH` | `/api/moves/:id` | Update move details |
| `GET` | `/api/moves/me` | Current user's active move |

### 4.3 Listings

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/listings` | Create draft. Returns listingId + presigned upload URLs. |
| `PATCH` | `/api/listings/:id` | Edit fields (title, price, condition, pickup notes) |
| `POST` | `/api/listings/:id/photos` | Get more upload slots for additional photos |
| `POST` | `/api/listings/:id/publish` | Flip DRAFT → LIVE, trigger embedding worker |
| `POST` | `/api/listings/:id/withdraw` | Take down a live listing |
| `GET` | `/api/listings/:id` | Public listing detail |
| `GET` | `/api/listings/:id/comparables` | Top-K vector neighbours for "comparable" UX |
| `GET` | `/api/listings/me` | Current user's listings (dashboard) |

### 4.4 Feed

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/feed` | Personalised buyer feed. Query params: `categories[]`, `maxPrice`, `arrivalBy`, `verifiedOnly`, `cursor` |
| `GET` | `/api/feed/route` | Items en route to user's destination |
| `GET` | `/api/feed/local` | Items already at user's destination |

### 4.5 Marketplace

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/listings/:id/offer` | Buyer makes an offer |
| `POST` | `/api/offers/:id/accept` | Seller accepts → reserves listing, books delivery |
| `POST` | `/api/offers/:id/reject` | Seller rejects |
| `POST` | `/api/listings/:id/watch` | Add to watchlist |
| `DELETE` | `/api/listings/:id/watch` | Remove from watchlist |

### 4.6 Bookings + delivery

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/bookings` | (Internal) commit booking + reserve route capacity. Called by `/offers/:id/accept`. |
| `GET` | `/api/bookings/:id` | Booking detail |
| `POST` | `/api/bookings/:id/confirm-delivery` | Crown ops marks delivered → triggers payout |
| `GET` | `/api/routes` | (Ops only) upcoming Crown routes + capacity |

### 4.7 Conversations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/conversations` | List user's conversations |
| `GET` | `/api/conversations/:id` | Messages + participants |
| `POST` | `/api/conversations/:id/messages` | Send message |
| `POST` | `/api/conversations/:id/read` | Mark read |

### 4.8 Example: `GET /api/feed`

Query:
```
GET /api/feed?categories=sofa,fridge&maxPrice=80000&arrivalBy=2026-05-28&verifiedOnly=true&cursor=eyJzY29yZSI6MC44N30=
```

Response shape:
```json
{
  "items": [
    {
      "id": "ckxx...",
      "title": "3-seater linen sofa",
      "category": { "slug": "sofa", "name": "Sofa" },
      "condition": "LIKE_NEW",
      "priceCents": 65000,
      "city": { "slug": "auckland", "name": "Auckland" },
      "thumbUrl": "https://cdn.reloloop.co/...",
      "matchScore": 0.94,
      "availability": {
        "kind": "EN_ROUTE",
        "arrivesAt": "2026-05-25T10:00:00Z",
        "routeId": "ckyy..."
      },
      "verified": true,
      "seller": { "name": "Sriram", "verified": true }
    }
  ],
  "nextCursor": "eyJzY29yZSI6MC42MX0=",
  "moveContext": {
    "destination": "Christchurch",
    "moveDate": "2026-05-28T00:00:00Z",
    "wantsRemaining": ["dining", "bed"]
  }
}
```

The `availability.kind` enum is one of: `LOCAL` (already in destination city), `EN_ROUTE` (Crown route exists pre-arrival), `ARRANGEABLE` (route can be created if buyer commits). Drives the buyer-side tab UI.

## 5 — Booking transaction

The atomic part. When a seller accepts an offer:

```typescript
// pseudocode — inside a Prisma transaction
await prisma.$transaction(async (tx) => {
  // 1. Lock the offer and listing rows
  const offer = await tx.offer.findUnique({
    where: { id: offerId },
    include: { listing: { include: { move: true } } }
  });
  if (offer.status !== 'PENDING') throw new Error('Offer not pending');
  if (offer.listing.status !== 'LIVE') throw new Error('Listing not live');

  // 2. Find a route with capacity
  const route = await tx.deliveryRoute.findFirst({
    where: {
      fromCityId: offer.listing.cityId,
      toCityId: offer.listing.move.toCityId,
      runDate: { gte: new Date() },
      status: 'SCHEDULED',
    },
    orderBy: { runDate: 'asc' },
  });
  if (!route) throw new Error('No route available');
  if (route.allocatedM3 + offer.listing.volumeM3 > route.capacityM3) {
    throw new Error('Route full');
  }

  // 3. Create the booking
  const booking = await tx.booking.create({
    data: {
      listingId: offer.listingId,
      buyerId: offer.buyerId,
      sellerId: offer.listing.sellerId,
      routeId: route.id,
      itemAmountCents: offer.amountCents,
      deliveryFeeCents: 12000,
      commissionCents: Math.floor(offer.amountCents * 0.10),
      totalChargedCents: offer.amountCents + 12000,
      pickupWindowStart: addDays(route.runDate, -1),
      pickupWindowEnd: route.runDate,
    },
  });

  // 4. Update route allocation atomically
  await tx.deliveryRoute.update({
    where: { id: route.id },
    data: { allocatedM3: { increment: offer.listing.volumeM3 } },
  });

  // 5. Flip statuses
  await tx.offer.update({
    where: { id: offerId },
    data: { status: 'ACCEPTED', acceptedAt: new Date() },
  });
  await tx.listing.update({
    where: { id: offer.listingId },
    data: { status: 'RESERVED', reservedAt: new Date() },
  });

  return booking;
}, { isolationLevel: 'Serializable' });
```

Serializable isolation prevents two simultaneous accept-offer calls from over-allocating a route. If concurrent acceptance is contentious in production, switch to advisory locks on `routeId`.

## 6 — Phasing the build

### M1 — Auth + Move + Listing CRUD
Auth.js magic links. Users can sign up, declare a move, create a listing manually (no AI yet). Hardcoded categories. Postgres only — no pgvector yet.

### M2 — Photo upload + Gemini auto-fill
tus → R2 → BullMQ worker calling Gemini. Listing AI-extracts title, category, condition, dimensions. Seller reviews and publishes.

### M3 — Embeddings + buyer feed
pgvector extension installed. CLIP worker. ListingEmbedding table populated. `/api/feed` query implemented. Buyer sees personalised feed.

### M4 — Comparables + pricing intelligence
`GET /api/listings/:id/comparables` and the pricing-suggestion query on listing creation. Match table populated nightly.

### M5 — Offers + bookings + Crown routes
DeliveryRoute seeded with Crown's actual NZ schedule. Offer/accept flow. Booking transaction. Dispatch dashboard for Crown ops.

### M6 — Notifications + cross-direction routing
Real-time alerts via WebSocket. Cross-direction route bundling. The query in §2.2 surfaced as "items going your way" in the buyer feed.

Each milestone is roughly two weeks at the pace Claude Code can build. M1–M3 gets to a demoable Auckland pilot.

## 7 — Open questions to resolve before building

- **Embedding host.** Replicate is the fast path; self-hosting CLIP on a small GPU (RTX 4090 in a Hetzner box) cuts cost ~10x at >50k embeddings/month. Defer until volumes justify.
- **Crown route ingestion.** Do we manually seed `DeliveryRoute`, or pull from Crown's existing dispatch system? Sriram's call.
- **Identity verification.** For pickup, do sellers need to verify ID? Probably yes for items >$500. Add a `User.verifiedAt` field and a verification flow in M5.
- **Refunds.** What happens if Crown damages an item in transit? `BookingStatus.REFUNDED` exists; the policy + insurance integration is a separate document.
- **Multi-tenancy / white-label.** Out of scope for v1, but `City.country` already exists; expand to multi-country via a `Region` table when AU launch is on the table.

---

*Companion to the visual wireframe at `reloloop-wireframe.html`.*
