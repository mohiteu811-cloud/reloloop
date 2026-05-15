# LivinLoop — schema

The data model for LivinLoop. A swap-first marketplace where the AI extracts what your stuff is worth, then finds someone whose stuff is worth roughly the same — usually in the city you're moving to, while their stuff is in the city you're leaving.

The mechanic in one sentence: **two people, two cities, two comparable items, one simultaneous handover. No truck crosses cities. No platform-mediated cash between users.**

The product builds on the LivAround codebase for photo capture and Gemini-based AI extraction. The schema below replaces ReloLoop's marketplace-and-logistics design with something simpler and structurally different — listing-to-listing matching, no platform-managed payments between users, no carrier integration in v1. The only money the platform handles is its own flat **1% swap fee**, split 50/50 between the two parties on an accepted proposal, collected via **PayPal** before contact details are revealed.

---

## 0 — The mental model

A `Listing` in LivinLoop is **two-sided by design**. When you list your IKEA SÖDERHAMN couch in Auckland, you're not just offering it — you're implicitly seeking a comparable couch in Christchurch (or wherever you're moving). The same row records both sides:

```
Sriram's Listing:
  category:      sofa
  origin city:   Auckland          ← where the item physically is
  wanted city:   Christchurch      ← where the swap partner must be
  estimated $:   $1,400            ← what AI says it's worth today
  asking $:      $1,400            ← what Sriram is willing to call it (editable)
  photos:        4 photos uploaded
  status:        LIVE
```

A match exists between Listing A and Listing B when:

- Same `category`
- `A.originCity == B.wantedCity` AND `A.wantedCity == B.originCity` (a bilateral inter-city match), OR `A.originCity == B.originCity AND A.wantedCity == B.wantedCity` (a same-city swap)
- `|A.askingValue − B.askingValue|` is within a tolerance (configurable, default ±20%)
- High semantic similarity from CLIP embedding (cosine ≥ 0.75)

The matching engine surfaces these pairs to both users. Either user can propose the swap. If the other accepts, the platform's job narrows to two things: collect the 1% swap fee from each side, then hand off contact details once both have paid. Pickups and transport are coordinated between the two users directly.

**No cash flow between users.** Asking values exist so users can see what each item is "worth" in roughly equivalent terms, and so the matching engine can constrain results to comparable pairs (within ±25% for couches, tighter for white goods). Whether the items feel equivalent enough to swap is for the two people to decide between themselves — same way you'd decide whether to swap your couch with a friend's. The platform does not frame, suggest, or facilitate any cash payment between users.

The only money the platform touches is its own fee — 1% of the estimated swap value (the average of the two listings' AI estimates at the moment of acceptance), split 50/50. That fee is what unlocks the contact-detail reveal. Until both halves are paid, the two parties can exchange messages inside the platform but can't see each other's email or phone.

---

## 1 — Stack

Same boring tech as ReloLoop, with one subtraction and one addition:

- **Next.js 15** App Router for web + API routes
- **React Native + Expo** for mobile (carried over from LivAround — same camera capture stack)
- **Prisma** ORM, **Postgres** with the **pgvector** extension for similarity matching
- **Auth.js v5** with the Resend provider for magic-link sign-in
- **BullMQ + Redis** for async workers (photo postprocessing, valuation, embedding, match recompute)
- **Cloudflare R2** for object storage, **tus.io** for resumable uploads
- **Gemini 2.5 Flash** for vision (extracts brand, model, age, condition, dimensions, current retail estimate)
- **CLIP ViT-B/32** for image+text embeddings, queried via pgvector cosine
- **Resend** for transactional email
- **PayPal Orders v2** for the swap-fee collection — chosen over Stripe because the cohort skews NZ/AU consumer and PayPal is the lower-friction option for a sub-$50 one-off charge

**Out of scope for v1:** logistics provider integrations, escrow on goods, KYC, identity verification, any platform-mediated cash between users. The platform does collect its own 1% swap fee but does not move money between users. The platform does not move goods. Users coordinate pickup directly.

Same architectural rules apply: **all AI runs server-side**, all embedding work happens in async workers, and listing creation never blocks on AI completion.

---

## 2 — Schema

### 2.1 Required Postgres extensions

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
```

### 2.2 Prisma schema

```prisma
// datasource & generator omitted for brevity

// ============================================================
// AUTH — Auth.js v5 wants these tables present
// ============================================================

model User {
  id             String     @id @default(cuid())
  email          String     @unique
  name           String?
  image          String?
  emailVerified  DateTime?
  phone          String?

  city           City?      @relation("UserHomeCity", fields: [cityId], references: [id])
  cityId         String?

  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  moves           Move[]
  listings        Listing[]
  proposalsSent   SwapProposal[] @relation("ProposalFromUser")
  proposalsRecvd  SwapProposal[] @relation("ProposalToUser")
  conversations   ConversationParticipant[]
  messages        Message[]
  feePayments     FeePayment[]

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
  name      String
  country   String   @default("NZ")
  lat       Float
  lng       Float
  active    Boolean  @default(true)

  users           User[]    @relation("UserHomeCity")
  listingsOrigin  Listing[] @relation("ListingOriginCity")
  listingsWanted  Listing[] @relation("ListingWantedCity")
  movesFrom       Move[]    @relation("MoveFromCity")
  movesTo         Move[]    @relation("MoveToCity")

  @@index([slug])
}

// ============================================================
// MOVE — optional context about an upcoming relocation
// ============================================================

model Move {
  id           String     @id @default(cuid())
  userId       String
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  fromCityId   String
  fromCity     City       @relation("MoveFromCity", fields: [fromCityId], references: [id])
  toCityId     String
  toCity       City       @relation("MoveToCity", fields: [toCityId], references: [id])

  moveDate         DateTime
  flexibilityDays  Int      @default(7)

  status           MoveStatus @default(PLANNING)

  // Listings created during this move period default to origin=fromCity, wanted=toCity
  // No FK relation — listings are independent records, Move just sets defaults

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([toCityId, moveDate])
  @@index([userId, status])
}

enum MoveStatus {
  PLANNING
  ACTIVE
  COMPLETED
  CANCELLED
}

// ============================================================
// CATEGORY — the same 12-item taxonomy, deliberately constrained
// Same-category swaps only, so this list defines the universe
// ============================================================

model ItemCategory {
  id           String    @id @default(cuid())
  slug         String    @unique
  name         String
  active       Boolean   @default(true)
  sortOrder    Int       @default(0)

  // Default value-tolerance for matches in this category, as basis points (1000 = 10%)
  // White goods are tighter (fridges, ovens). Soft furnishings looser (rugs, decor)
  matchToleranceBps  Int  @default(2000)   // ±20% default

  // Default depreciation curve for valuation
  // Stored as JSON: { yearOneRetention: 0.55, yearlyDecay: 0.15, floor: 0.10 }
  depreciationCurve  Json

  listings     Listing[]

  @@index([slug])
}

// Seeded categories — same as ReloLoop:
// sofa, fridge, washer, tv, bed, dining, wardrobe, desk,
// kitchen (small appliances), rugs (& lighting), outdoor (& BBQ), other

// ============================================================
// LISTING — the heart of the system
// Two-sided by design: every listing IS an offering AND a wanted
// ============================================================

enum Condition {
  LIKE_NEW
  GOOD
  USED
  WORN
}

enum ListingStatus {
  DRAFT          // photos uploading
  PROCESSING     // AI extracting fields
  LIVE           // visible to matchers
  PROPOSED       // active swap proposal pending
  LOCKED         // swap accepted, in coordination (fee may still be unpaid)
  SWAPPED        // completed
  WITHDRAWN
}

model Listing {
  id           String         @id @default(cuid())
  userId       String
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  // The item being offered
  categoryId   String
  category     ItemCategory   @relation(fields: [categoryId], references: [id])
  title        String                       // "IKEA SÖDERHAMN 3-seat couch"
  description  String?        @db.Text

  // AI-extracted descriptive fields (editable by user)
  brand        String?                      // "IKEA"
  model        String?                      // "SÖDERHAMN"
  ageYears     Float?                       // 2.0
  condition    Condition

  // AI-extracted physical
  widthCm      Int?
  depthCm      Int?
  heightCm     Int?
  weightKg     Float?

  // === THE VALUATION ===
  // What AI thinks it retailed for new (USD/NZD cents)
  originalRetailCents  Int?
  // What AI thinks it's worth today (after depreciation × condition)
  estimatedValueCents  Int?
  // What the USER is asking — defaults to estimatedValueCents, user can override
  askingValueCents     Int
  // Optional explanation if the user overrode (used for trust on the match screen)
  askingValueRationale String?              @db.Text
  // Audit of valuation inputs (preserved so the user understands the estimate)
  valuationBreakdown   Json?                // see §3.2 for shape

  // === THE TWO-SIDED GEOGRAPHY ===
  originCityId  String
  originCity    City   @relation("ListingOriginCity", fields: [originCityId], references: [id])
  wantedCityId  String
  wantedCity    City   @relation("ListingWantedCity", fields: [wantedCityId], references: [id])

  // Hard-bound timing: when this listing expires
  availableUntil  DateTime

  // Optional preferences for the wanted side, beyond category
  // User can type "looking for a fabric couch, no leather"
  wantedNotes     String?  @db.Text

  // === LIFECYCLE ===
  status          ListingStatus  @default(DRAFT)
  publishedAt     DateTime?
  swappedAt       DateTime?

  photos          Photo[]
  embedding       ListingEmbedding?
  proposalsAsA    SwapProposal[] @relation("ProposalListingA")
  proposalsAsB    SwapProposal[] @relation("ProposalListingB")
  matchesAsA      SwapMatch[]    @relation("MatchListingA")
  matchesAsB      SwapMatch[]    @relation("MatchListingB")

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  // The composite index that powers the matching engine
  @@index([categoryId, status, originCityId, wantedCityId, askingValueCents])
  @@index([userId, status])
  @@index([status, publishedAt])
}

// ============================================================
// PHOTO — carried over from LivAround pipeline
// ============================================================

model Photo {
  id              String    @id @default(cuid())
  listingId       String
  listing         Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)

  r2Key           String
  url             String
  thumbUrl        String?
  width           Int?
  height          Int?
  bytes           Int?
  perceptualHash  String?
  sortOrder       Int       @default(0)

  uploadedAt      DateTime  @default(now())

  @@index([listingId])
}

// ============================================================
// EMBEDDING — drives semantic matching
// ============================================================

model ListingEmbedding {
  listingId    String    @id
  listing      Listing   @relation(fields: [listingId], references: [id], onDelete: Cascade)

  vector       Unsupported("vector(768)")

  modelName    String                       // "clip-vit-b-32"
  modelVersion String

  computedAt   DateTime  @default(now())

  // HNSW index added via raw SQL migration:
  // CREATE INDEX listing_embedding_hnsw
  //   ON "ListingEmbedding"
  //   USING hnsw (vector vector_cosine_ops)
  //   WITH (m = 16, ef_construction = 64);
}

// ============================================================
// SWAP MATCH — pre-computed pairings (nightly + on-publish)
// One row per directional pair (A→B). If both directions match
// (i.e. it's a genuine bilateral inter-city swap), we still
// write two rows for query simplicity.
// ============================================================

model SwapMatch {
  id              String    @id @default(cuid())

  listingAId      String
  listingA        Listing   @relation("MatchListingA", fields: [listingAId], references: [id], onDelete: Cascade)
  listingBId      String
  listingB        Listing   @relation("MatchListingB", fields: [listingBId], references: [id], onDelete: Cascade)

  // Component scores
  semanticScore     Float                    // cosine similarity, 0..1
  valueScore        Float                    // 0..1, decays with value delta — INTERNAL ONLY, used by ranker, never surfaced
  geographyScore    Float                    // 1.0 if perfect bilateral, 0.5 if same-city, 0 if impossible
  overallScore      Float                    // composite, used for ranking

  // NOTE: we intentionally do not store or surface a value-delta field.
  // Asking values are visible on each listing card; users compare them with their
  // own eyes and decide whether the items feel equivalent enough to swap.
  // The platform does not frame, suggest, or facilitate any cash settlement between users.

  computedAt        DateTime  @default(now())

  @@unique([listingAId, listingBId])
  @@index([listingAId, overallScore])
  @@index([listingBId, overallScore])
}

// ============================================================
// SWAP PROPOSAL — one user proposes a specific swap
// ============================================================

enum ProposalStatus {
  PENDING
  ACCEPTED
  DECLINED
  EXPIRED
  WITHDRAWN
  CANCELLED
}

model SwapProposal {
  id              String    @id @default(cuid())

  // Who's proposing what to whom
  fromUserId      String
  fromUser        User      @relation("ProposalFromUser", fields: [fromUserId], references: [id])
  toUserId        String
  toUser          User      @relation("ProposalToUser", fields: [toUserId], references: [id])

  // The two listings in the proposed swap
  // A = the proposer's listing, B = the recipient's
  listingAId      String
  listingA        Listing   @relation("ProposalListingA", fields: [listingAId], references: [id])
  listingBId      String
  listingB        Listing   @relation("ProposalListingB", fields: [listingBId], references: [id])

  // Optional message from the proposer — opens the human conversation
  message         String?   @db.Text

  status          ProposalStatus  @default(PENDING)
  expiresAt       DateTime
  respondedAt     DateTime?
  declineReason   String?

  // When ACCEPTED, this becomes the live coordination shell
  conversation    Conversation?
  // When ACCEPTED, a SwapFee row is created with two FeePayment children
  fee             SwapFee?

  acceptedAt      DateTime?
  createdAt       DateTime  @default(now())

  @@index([toUserId, status])
  @@index([fromUserId, status])
  @@index([listingAId])
  @@index([listingBId])
}

// ============================================================
// SWAP FEE — the platform's 1% take, owed in halves by both parties
// Created the moment a proposal is ACCEPTED. Frozen at that moment so
// later edits to asking values don't shift what's owed.
// ============================================================

enum FeeStatus {
  PENDING        // awaiting both payments
  PARTIAL        // one party has paid
  PAID           // both parties paid — contact details revealed
  REFUNDED       // swap cancelled after fee paid, refunds issued
  FAILED         // payment processor errors, manual review
}

model SwapFee {
  id              String        @id @default(cuid())

  proposalId      String        @unique
  proposal        SwapProposal  @relation(fields: [proposalId], references: [id], onDelete: Cascade)

  // Fee base = average of the two listings' estimatedValueCents at acceptance.
  // We use estimatedValue (the AI number) rather than askingValue so the fee
  // doesn't become a lever for users gaming the platform's revenue.
  // Snapshotted at acceptance and never recomputed.
  swapValueCents     Int

  feeBps             Int       @default(100)   // 100 bps = 1%
  totalFeeCents      Int                       // = swapValueCents * feeBps / 10000
  perPartyFeeCents   Int                       // = totalFeeCents / 2 (rounding up to nearest cent)

  status             FeeStatus @default(PENDING)
  paidAt             DateTime?                 // set when BOTH FeePayments are PAID
  refundedAt         DateTime?

  payments           FeePayment[]

  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@index([status])
}

enum FeePaymentStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
}

model FeePayment {
  id              String           @id @default(cuid())

  feeId           String
  fee             SwapFee          @relation(fields: [feeId], references: [id], onDelete: Cascade)

  payerId         String
  payer           User             @relation(fields: [payerId], references: [id])

  amountCents     Int              // = SwapFee.perPartyFeeCents at creation
  currency        String           @default("NZD")

  status          FeePaymentStatus @default(PENDING)

  // PayPal Orders v2 references — populated as the user moves through checkout
  paypalOrderId     String?  @unique          // returned from /v2/checkout/orders create
  paypalCaptureId   String?                   // returned from capture
  paypalPayerEmail  String?                   // recorded for receipts/audit
  rawWebhookEvent   Json?                     // last webhook payload, for debugging

  paidAt          DateTime?
  refundedAt      DateTime?
  failureReason   String?

  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@unique([feeId, payerId])
  @@index([payerId, status])
  @@index([status])
}

// ============================================================
// CONVERSATION — kicks in on proposal acceptance
// Two-party only, scoped to a specific accepted swap.
// Note: messaging is enabled immediately on acceptance, but
// contact-detail reveal is gated on the SwapFee reaching PAID.
// ============================================================

model Conversation {
  id              String                    @id @default(cuid())

  // Always tied to an accepted SwapProposal
  proposalId      String                    @unique
  proposal        SwapProposal              @relation(fields: [proposalId], references: [id], onDelete: Cascade)

  participants    ConversationParticipant[]
  messages        Message[]

  lastMessageAt   DateTime?

  // Contact-reveal moment, set when both FeePayments hit PAID.
  // While null, the API redacts each user's email/phone from the other's view.
  contactRevealedAt    DateTime?

  // Coordination state — both parties confirm separately
  pickupConfirmedByA   DateTime?
  pickupConfirmedByB   DateTime?
  swapCompletedByA     DateTime?
  swapCompletedByB     DateTime?

  createdAt       DateTime                  @default(now())

  @@index([lastMessageAt])
}

model ConversationParticipant {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId          String
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  lastReadAt      DateTime?

  @@unique([conversationId, userId])
}

model Message {
  id              String        @id @default(cuid())
  conversationId  String
  conversation    Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  authorId        String
  author          User          @relation(fields: [authorId], references: [id])

  body            String        @db.Text
  attachments     Json?

  createdAt       DateTime      @default(now())

  @@index([conversationId, createdAt])
}
```

### 2.3 What's deliberately absent

- **No `Booking`, no `Shipment`, no logistics provider model.** The platform doesn't move goods in v1.
- **No platform-mediated cash flow between users.** Asking values are visible so users can judge equivalence; any private cash top-up is between them and off-platform.
- **No payout, no commission to users, no wallet.** The platform's only money handling is collecting its own 1% fee via PayPal.
- **No `Watch` / preference vector / personalised feed.** Listings are matched listing-to-listing, not user-to-listings. Users see *their own listings' matches*, not a global feed.
- **No `Verified` flag.** No condition-check service in v1. Trust comes from the AI's transparent valuation breakdown and from the two parties talking directly once the fee is paid.

---

## 3 — The valuation pipeline

The single most important AI step in this product. Get this wrong, users don't trust the matches — and since the fee is computed off the AI estimate, they also don't trust what they're being charged.

### 3.1 The flow

When a user finishes uploading photos for a new listing:

1. **Photo postprocessing** (BullMQ worker, identical to LivAround):
   - Sharp generates 480px WebP thumbnails
   - Perceptual hash for dedup
   - Writes Photo rows

2. **AI extraction** (BullMQ worker, Gemini 2.5 Flash):
   - Single Gemini call with all 4 photos and a structured-output prompt:
     ```
     Look at these photos of an item being listed for a swap.
     Return JSON: {
       category (one of: sofa, fridge, washer, tv, bed, dining, wardrobe, desk, kitchen, rugs, outdoor, other),
       brand (best guess, or null),
       model (if visible/identifiable, else null),
       title (concise, ≤80 chars, e.g. "IKEA SÖDERHAMN 3-seat couch, light grey"),
       condition (LIKE_NEW | GOOD | USED | WORN),
       estimatedAgeYears (number, best guess),
       widthCm, depthCm, heightCm (numbers, estimates),
       visibleDefects (string[], empty if none),
       originalRetailEstimateNZD (number — what would this have cost new at retail),
       retailEstimateConfidence (LOW | MEDIUM | HIGH),
       retailEstimateRationale (one sentence explaining the retail estimate)
     }
     ```

3. **Valuation computation** (worker, in the same job as extraction):
   - Take `originalRetailCents` from the AI
   - Apply the category's depreciation curve (from `ItemCategory.depreciationCurve`):
     ```
     retention = max(
       floor,
       yearOneRetention * (1 - yearlyDecay)^(ageYears - 1)
     )
     ```
   - Apply condition multiplier: `LIKE_NEW × 1.0, GOOD × 0.85, USED × 0.65, WORN × 0.40`
   - `estimatedValueCents = originalRetailCents × retention × conditionMultiplier`
   - `askingValueCents = estimatedValueCents` (initial; user can edit)
   - Persist `valuationBreakdown` JSON for the review screen

4. **User review** — listing is `DRAFT`. The review screen shows:
   - Photos
   - AI-extracted fields (brand, model, condition, dimensions) — all editable
   - The valuation breakdown, transparently:
     ```
     IKEA SÖDERHAMN 3-seat couch
     ──────────────────────────────────────────
     Original retail (est.)        $2,099
     Age                            2.0 years
     Depreciation                   -41%        → $1,238
     Condition: like new            -0%         → $1,238
     ──────────────────────────────────────────
     Estimated value today          $1,238
     Your asking value              [$1,238]    ← editable
     ```
   - User confirms and publishes

5. **Embedding** (separate worker, triggers on publish):
   - CLIP image encoder over the photos, mean-pooled
   - CLIP text encoder over `title + description + brand + model`
   - Concatenated to 768-dim, L2-normalised
   - Persisted to `ListingEmbedding`
   - Listing flips `PROCESSING → LIVE`

### 3.2 `valuationBreakdown` JSON shape

```typescript
type ValuationBreakdown = {
  computedAt: string                 // ISO timestamp
  originalRetailCents: number
  retailConfidence: 'LOW'|'MEDIUM'|'HIGH'
  retailRationale: string            // one-line AI explanation
  ageYears: number
  depreciationRetention: number      // e.g. 0.59 after 2 years on sofa curve
  depreciationCurve: {               // copied from category at compute time
    yearOneRetention: number
    yearlyDecay: number
    floor: number
  }
  condition: Condition
  conditionMultiplier: number        // 1.0, 0.85, 0.65, 0.40
  estimatedValueCents: number        // computed
}
```

### 3.3 Category depreciation curves (initial seed values)

These get tuned with real data over time. v1 seeds:

| Category | yearOneRetention | yearlyDecay | floor | matchTolerance |
|---|---|---|---|---|
| sofa | 0.55 | 0.15 | 0.10 | ±25% |
| fridge | 0.65 | 0.12 | 0.15 | ±15% |
| washer | 0.60 | 0.13 | 0.15 | ±15% |
| tv | 0.50 | 0.20 | 0.10 | ±20% |
| bed | 0.45 | 0.15 | 0.10 | ±25% |
| dining | 0.60 | 0.10 | 0.20 | ±25% |
| wardrobe | 0.55 | 0.12 | 0.15 | ±25% |
| desk | 0.55 | 0.12 | 0.15 | ±25% |
| kitchen | 0.50 | 0.20 | 0.10 | ±25% |
| rugs | 0.55 | 0.15 | 0.15 | ±30% |
| outdoor | 0.50 | 0.18 | 0.10 | ±25% |
| other | 0.50 | 0.15 | 0.10 | ±30% |

White goods (fridge, washer) get tighter tolerances because they're more commodified — a $1,200 fridge and a $1,500 fridge are genuinely different machines. Soft furnishings (rugs, decor) get looser because taste is the bigger variable than spec.

---

## 4 — The matching engine

### 4.1 The matching primitive

Given Listing A (LIVE), find Listings B such that:

```sql
WITH a AS (
  SELECT l.*, e.vector
  FROM "Listing" l
  JOIN "ListingEmbedding" e ON e."listingId" = l.id
  WHERE l.id = $1
)
SELECT b.*,
  1 - (be.vector <=> a.vector) AS semantic_score,
  -- value score: 1.0 when identical, decaying linearly to 0 at the tolerance boundary
  GREATEST(0.0, 1.0 - (
    ABS(a."askingValueCents" - b."askingValueCents")::float
    / (a."askingValueCents" * (cat."matchToleranceBps" / 10000.0))
  )) AS value_score,
  -- geography score: 1.0 perfect bilateral, 0.5 same-city
  CASE
    WHEN a."originCityId" = b."wantedCityId" AND a."wantedCityId" = b."originCityId" THEN 1.0
    WHEN a."originCityId" = b."originCityId" AND a."wantedCityId" = b."wantedCityId" THEN 0.5
    ELSE 0.0
  END AS geography_score
FROM "Listing" b
JOIN "ListingEmbedding" be ON be."listingId" = b.id
JOIN "ItemCategory" cat ON cat.id = b."categoryId", a
WHERE b.id != a.id
  AND b."categoryId" = a."categoryId"
  AND b.status = 'LIVE'
  AND b."availableUntil" > NOW()
  -- value within tolerance
  AND ABS(b."askingValueCents" - a."askingValueCents") <
      a."askingValueCents" * (cat."matchToleranceBps" / 10000.0)
  -- bilateral OR same-city, never one-sided
  AND (
    (b."originCityId" = a."wantedCityId" AND b."wantedCityId" = a."originCityId")
    OR
    (b."originCityId" = a."originCityId" AND b."wantedCityId" = a."wantedCityId")
  )
ORDER BY
  -- composite score: semantic × 0.4 + value × 0.4 + geography × 0.2
  ((1 - (be.vector <=> a.vector)) * 0.4
    + GREATEST(0.0, 1.0 - ABS(a."askingValueCents" - b."askingValueCents")::float
       / (a."askingValueCents" * (cat."matchToleranceBps" / 10000.0))) * 0.4
    + CASE WHEN a."originCityId" = b."wantedCityId" AND a."wantedCityId" = b."originCityId" THEN 1.0
           WHEN a."originCityId" = b."originCityId" AND a."wantedCityId" = b."wantedCityId" THEN 0.5
           ELSE 0.0 END * 0.2
  ) DESC
LIMIT 20;
```

### 4.2 When matching runs

- **On publish.** When a Listing goes LIVE, a "match:compute" job runs for that listing. Computes matches against all other LIVE listings in the same category, persists `SwapMatch` rows where `overallScore > 0.6`. New matches notify the other party.
- **On user-asking-value-change.** If a user edits the asking value on an existing listing, re-run matches (the candidate set may have shifted).
- **Nightly cron** at 02:00 NZST. Re-runs full match table for all LIVE listings. Cleans up matches where one side has gone PROPOSED/LOCKED/SWAPPED/WITHDRAWN.

### 4.3 What users see

The user opens their own listing's detail page and sees a "Possible swaps" section ranked by `overallScore`. Each row shows:

- The other listing's primary photo + title
- The other party's first name + home city
- A "match badge" showing the composite score as a percentage
- The value delta, framed plainly: *"Their item is $120 less than yours"*
- Bilateral indicator: *"They're moving from Christchurch to Auckland"* (vs same-city: *"Also in Auckland"*)
- A primary CTA: **Propose swap →**

The proposal screen is the next step.

---

## 5 — The proposal & fee flow

When user A wants to swap with user B:

1. **A opens the match detail.** Sees A's item, B's item, side by side. Both asking values are visible — A decides whether the items feel comparable enough to swap. The estimated swap fee (1% of the average estimated value, split 50/50) is also shown on this screen, so A knows what they'll owe if B accepts. Example: *"If accepted, swap fee is $13 each (1% of $2,580 swap value, split 50/50)."*

2. **A adds an optional message.** "Hey, your couch looks perfect for our new place — happy to swap straight up. When are you in CHC?"

3. **A submits.** `SwapProposal` row created. Status PENDING. Listing A moves from LIVE → PROPOSED. `expiresAt` = now + 72h.

4. **B receives the proposal.** Email + in-app notification. Sees A's item, A's message, A's listing's asking value next to B's own, and the same fee preview.

5. **B accepts, declines, or counter-proposes.**

   - **Accept** → status ACCEPTED. Both listings move to LOCKED. A `Conversation` is auto-created with both users as participants. A `SwapFee` row is created with `swapValueCents = (listingA.estimatedValueCents + listingB.estimatedValueCents) / 2`, `totalFeeCents = swapValueCents / 100`, and two `FeePayment` children — one PENDING row per party. Both users get an email with a PayPal checkout link for their half.
   - **Decline** → status DECLINED. A's listing reverts to LIVE. A is notified.
   - **Counter-propose** → if A had multiple listings, B can suggest a different one of A's items as the swap. New `SwapProposal` from B→A. A's original becomes WITHDRAWN.

6. **The fee gate (between acceptance and contact reveal).** The conversation exists and both parties can message inside the platform — useful for confirming "yes, I'm about to pay" — but each user's email and phone are redacted from the other's view. The conversation UI shows a banner: *"Pay your $13 swap fee to reveal contact details and coordinate pickup."*

7. **Both parties pay their half via PayPal.** Each `FeePayment` flips PENDING → PAID via the PayPal webhook (`PAYMENT.CAPTURE.COMPLETED`). When one is paid, `SwapFee.status` → PARTIAL. When both are paid, `SwapFee.status` → PAID, `Conversation.contactRevealedAt` is set, both users are emailed each other's contact details, and the in-app banner is replaced with the contact info card.

8. **After contact reveal:** the conversation is the coordination shell. Users exchange pickup details, agree on a date, optionally confirm completion ("I picked up my new couch, all good"). When both parties tap "swap complete," listings move LOCKED → SWAPPED.

The platform never proposes, calculates, or mediates a cash payment *between users*. Asking values are shown so users can judge equivalence; the swap itself is a goods-for-goods exchange. If two users decide privately to throw in cash to balance things, that's between them and outside the platform's surface. The only money the platform handles is its own 1% fee.

### 5.1 Why proposals expire at 72 hours

Listings move to PROPOSED status when a proposal is pending, which removes them from matching for the proposer's side. That's costly if a recipient ghosts. 72 hours is the sweet spot — long enough for real life, short enough that ghosters don't lock down active inventory.

If a proposal expires, the proposer's listing reverts to LIVE and re-enters matching automatically.

### 5.2 Why fees can't expire (yet) but unpaid acceptances can

A separate expiry governs the post-acceptance state. If a `SwapFee` sits in PENDING or PARTIAL for more than **7 days** after acceptance, a cron job cancels the swap: `SwapProposal.status` → CANCELLED, both listings revert LOCKED → LIVE, any paid half is automatically refunded via the PayPal Refunds API, and both users get an email explaining what happened. This stops accepted-but-unpaid swaps from locking inventory indefinitely.

### 5.3 Concurrent proposals

A single LIVE listing can receive multiple PENDING proposals from different users (it stays LIVE — only the proposer's own listing moves to PROPOSED). When the recipient accepts one, all other pending proposals on that listing auto-decline with a polite "this swap was matched with another party" reason. The proposer is notified, and their listing — which was PROPOSED — reverts to LIVE.

This is the part of the schema worth re-reading: **proposing a swap reserves YOUR listing, not the other party's.** Mutual reservation only happens on acceptance.

### 5.4 Refunds

The platform refunds a paid fee in two cases:
- **Fee-gate timeout.** Acceptance happens, one party pays, the other never does, and the 7-day timer expires (§5.2). The paying party's half is refunded automatically.
- **Both-party cancellation post-payment.** If both users agree to cancel after the fee is paid (rare — they'd need a real reason, e.g. one item turns out to be damaged on inspection), they can request a refund from inside the conversation. Both users must confirm. Both halves refunded.

No refunds after `swapCompletedByA` AND `swapCompletedByB` are set. At that point the swap is done.

---

## 6 — API surface

About 22 endpoints across the system. REST, JSON, JWT in cookies via Auth.js.

### 6.1 Auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/signin/email` | Send magic link |
| `GET` | `/api/auth/callback/email` | Magic-link callback |
| `POST` | `/api/auth/signout` | Sign out |

### 6.2 Move (optional profile context)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/moves` | Set my move context (used as defaults for new listings) |
| `PATCH` | `/api/moves/:id` | Edit |
| `GET` | `/api/moves/me` | Current move or null |

### 6.3 Listings

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/listings` | Create draft. Returns listingId + presigned upload URLs |
| `PATCH` | `/api/listings/:id` | Edit any field — including askingValueCents |
| `POST` | `/api/listings/:id/publish` | Validate + flip DRAFT → PROCESSING → LIVE (via worker) |
| `POST` | `/api/listings/:id/withdraw` | Owner pulls listing |
| `GET` | `/api/listings/:id` | Detail. Includes valuationBreakdown and matches |
| `GET` | `/api/listings/me` | My listings, with status + match counts |

### 6.4 Matching

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/listings/:id/matches` | Top-K SwapMatch rows for this listing, ranked |
| `POST` | `/api/listings/:id/recompute-matches` | Owner-only, triggers a fresh match job |

### 6.5 Proposals

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/proposals` | Create — body: listingAId (mine), listingBId (theirs), message |
| `GET` | `/api/proposals/incoming` | Proposals where I'm the recipient |
| `GET` | `/api/proposals/outgoing` | Proposals I've sent |
| `GET` | `/api/proposals/:id` | Single proposal detail, including fee preview |
| `POST` | `/api/proposals/:id/accept` | Recipient accepts → creates Conversation + SwapFee + two FeePayments |
| `POST` | `/api/proposals/:id/decline` | Recipient declines |
| `POST` | `/api/proposals/:id/withdraw` | Proposer withdraws |
| `POST` | `/api/proposals/:id/counter` | Recipient counter-proposes (creates a new proposal, withdraws this one) |

### 6.6 Fees (PayPal)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/fees/:feeId` | Fee detail — my FeePayment status, partner's status (boolean only), swap value, totals |
| `POST` | `/api/fees/:feeId/checkout` | Create a PayPal Order for *my* half; returns `{ approveUrl }` for the redirect |
| `POST` | `/api/fees/:feeId/capture` | Called from the PayPal return URL; captures the order, marks my FeePayment PAID |
| `POST` | `/api/webhooks/paypal` | PayPal webhook receiver — verifies signature, updates FeePayment, flips SwapFee status, sets `contactRevealedAt` if both paid |
| `POST` | `/api/fees/:feeId/cancel-and-refund` | Mutual-cancel-after-payment flow; requires both participants to confirm |

### 6.7 Conversations

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/conversations` | My conversations |
| `GET` | `/api/conversations/:id` | Detail + messages. **Contact details (email/phone of the other party) are returned only if `contactRevealedAt` is set.** |
| `POST` | `/api/conversations/:id/messages` | Send |
| `POST` | `/api/conversations/:id/confirm-pickup` | I picked up my new item |
| `POST` | `/api/conversations/:id/confirm-complete` | Swap fully done |

### 6.8 Example `GET /api/listings/:id/matches` response

```json
{
  "listingId": "ckxx...",
  "matches": [
    {
      "matchId": "ckm1...",
      "listing": {
        "id": "ckyy...",
        "title": "West Elm Andes 3-seat sofa, charcoal",
        "thumbUrl": "https://cdn.livinloop.co/...",
        "askingValueCents": 132000,
        "originCity": { "slug": "christchurch", "name": "Christchurch" },
        "wantedCity": { "slug": "auckland", "name": "Auckland" },
        "owner": { "firstName": "Sarah" }
      },
      "scores": {
        "semantic": 0.87,
        "value": 0.91,
        "geography": 1.0,
        "overall": 0.91
      },
      "geographyFraming": "BILATERAL_INTERCITY",
      "geographyText": "Sarah is moving Christchurch → Auckland. You're moving Auckland → Christchurch.",
      "feePreview": {
        "swapValueCents": 258000,
        "perPartyFeeCents": 1290,
        "totalFeeCents": 2580
      }
    }
  ]
}
```

Both items' asking values are visible on their listing cards. The client renders them side-by-side and the user decides whether they feel equivalent. No `valueDelta`, no "favoured party," no settlement framing on this response or any other. The `value` score is internal — used by the ranker to surface comparable items first — and is not displayed to users. The `feePreview` is shown so the user knows what they'll owe the platform if the proposal is accepted.

The `geographyText` string is server-rendered. The frontend uses it verbatim — keeps the copy consistent across email, push notification, and in-app surfaces.

### 6.9 Example `GET /api/fees/:feeId` response

```json
{
  "feeId": "ckf...",
  "proposalId": "ckp...",
  "swapValueCents": 258000,
  "feeBps": 100,
  "totalFeeCents": 2580,
  "perPartyFeeCents": 1290,
  "currency": "NZD",
  "status": "PARTIAL",
  "me": {
    "status": "PAID",
    "paidAt": "2026-05-15T03:14:00Z"
  },
  "partner": {
    "status": "PENDING"
  },
  "expiresAt": "2026-05-22T03:00:00Z"
}
```

We deliberately do *not* return the partner's PayPal order ID, payer email, or any timestamps beyond their status — just enough for the UI to render "they haven't paid yet" or "they've paid."

---

## 7 — Implementation notes

### 7.1 What carries over from LivAround

The whole photo-capture pipeline is reusable as-is:

- `expo-camera` for mobile capture, browser `FileReader` on web
- tus.io resumable upload to R2
- BullMQ `photo:postprocess` worker for sharp thumbnails + pHash
- BullMQ `listing:autofill` worker calling Gemini 2.5 Flash
- The in-app messaging primitives (conversation/message models, websocket fan-out, unread counts) — LivAround uses these for host↔guest chat; we use them for the post-acceptance swap conversation

The Gemini prompt is different (LivAround's was for room walkthroughs; ours is for individual items), but the worker plumbing is identical.

**Reuse strategy: fork-then-extract.** We copy the relevant directories out of LivAround as our LivinLoop starting point — photo pipeline, BullMQ worker scaffolding, Gemini call wiring, messaging primitives — strip the LivAround-specific feature code, and bolt the swap-specific pieces on top. No monorepo, no private npm packages in v1.

The rationale: private packages only pay off once the shared code is stable. During the pilot, versioning + release pipelines + cross-repo PR dances become friction on the critical path. Fork-then-extract gives us velocity now and keeps the door open — once a module has gone ~6 months without diverging between the two apps, we lift it into a private package then. Doing it the other way around (guessing the seams upfront) usually means the package API doesn't fit LivinLoop's real needs and we refactor twice.

The known cost: a bugfix in LivAround's photo pipeline won't automatically reach LivinLoop. Two cheap mitigations:

- **Provenance headers.** Every file copied from LivAround gets a one-line comment at the top: `// carryover from LivAround:<path> @ <short-sha>`. Lets future-us run a quick `git diff` against the upstream file to see what's drifted.
- **`CARRYOVER.md` at the repo root.** A flat list of every directory/file we copied across, with the source SHA, so the diff exercise is one command away. Update it whenever we pull a fix across.

When something has been copied verbatim *and* changed in lockstep in both repos two or three times, that's the signal to promote it to a private `@livinloop/*` package on GitHub Packages — at that point the API is real and the release overhead is justified.

### 7.2 What's net-new

- The valuation pipeline — depreciation curves, condition multipliers, the breakdown JSON, the user-facing review screen
- The bidirectional listing model — `originCity` AND `wantedCity` on the same row
- The match query — joint constraint on category, value tolerance, bilateral OR same-city geography, semantic similarity
- The proposal lifecycle — including the PROPOSED listing-status that reserves the proposer's listing without locking the recipient's
- The fee model — `SwapFee` + `FeePayment`, PayPal Orders v2 integration, the contact-reveal gate on `Conversation`, refund handling for fee-gate timeouts
- The conversation as coordination shell, with the dual-confirm completion semantics

### 7.3 Phasing the build

**M1 — Foundations.** Auth + Move + City/Category seed + manual listing CRUD (no AI). Confirms the schema holds. ~1 week.

**M2 — Photo pipeline.** R2 + tus + sharp + thumbnails. Same code as LivAround, ported. ~1 week.

**M3 — Gemini extraction + valuation.** The full valuation pipeline including the user-review screen with the editable breakdown. ~2 weeks. This is the highest-risk milestone — get the AI value estimates wrong and trust collapses (and you're charging fees based on wrong numbers).

**M4 — Embeddings + matching.** CLIP worker, pgvector index, the match query, the "Possible swaps" section on listing detail. ~2 weeks.

**M5 — Proposals + conversations (no fees yet).** Full proposal lifecycle including expiry, counter-proposals, conversation creation on accept, dual-confirm completion. Contact details revealed on acceptance for the pilot cohort only — fees gated behind a flag. ~2 weeks.

**M6 — PayPal fees + contact-reveal gate.** PayPal Orders v2 integration, webhook receiver, `SwapFee` + `FeePayment` lifecycle, refund handling, the conversation banner UX, fee-gate timeout cron. ~2 weeks. Highest external-dependency risk (PayPal sandbox/live differences, webhook reliability).

**M7 — Notifications + polish.** Resend emails for incoming proposals, expiries, fee receipts, contact reveals, swap completion. Polish on the match screens and the valuation breakdown. ~1 week.

Total: ~11 weeks at Claude Code pace. M1–M4 is the demoable pilot (you can see your listing's matches even before the proposal flow exists). M5 closes the swap loop end-to-end. M6 turns on monetization.

### 7.4 Out of scope, for future versions

- Cross-category swaps ("trade my couch for a fridge + lamp")
- Bundle swaps (multi-item on both sides)
- Optional integrated logistics (a `Quote` from a courier for pickup, ReloLoop-style)
- Identity verification
- Dispute resolution
- Same-day swap requests (right now, every listing has a static `availableUntil`)
- Public listing pages (currently listings are only discovered through matches; SEO and search come later)
- Cross-country geography (NZ-only in v1; the `City.country` field is there for later)
- Alternative payment processors (Stripe, Apple Pay, bank transfer). PayPal-only in v1.
- Variable fee rates per category or per user cohort

---

## 8 — Open questions

- **AI valuation accuracy.** The depreciation curves are educated guesses. The first 100 listings will tell us whether `LIKE_NEW × 1.0` is right or whether we're systematically over-valuing recent items. Plan for an ops dashboard that flags listings where users edited `askingValueCents` more than ±15% from `estimatedValueCents`, and use that data to retune. Doubly important now that the fee is computed from the AI estimate — over-valuation costs users real dollars.
- **What if the AI can't identify the brand?** Some couches are generic. The valuation falls back to Gemini's own "what would a couch of this size/condition cost new" estimate. Confidence drops to LOW; the breakdown screen says so plainly.
- **How tight should `matchToleranceBps` be in practice?** Default ±20% is a starting point. We'll see how often users complain "the matches are too off in value" vs "I'm getting no matches because the tolerance is too tight." Tunable per category, then maybe tunable per user later.
- **Should proposals on LIVE listings really not lock the recipient's listing?** It feels asymmetric, but the alternative (mutual lock on proposal) creates a denial-of-service vector — bad actors can spam proposals to take items off the market. The current design errs on the side of keeping inventory liquid. Reviewable after pilot data.
- **Is 1% the right fee?** Low enough to feel painless ($13 on a $1,300 couch swap), high enough to fund the platform if volume scales. But on a $200 swap it's only $1 each, which barely covers PayPal's per-transaction fee (~$0.45 + 2.9% under their micropayments tier). Two options for later: a flat-minimum-fee floor (e.g. `max(1%, $2)` per party), or a tiered structure. Holding flat 1% for v1 because the simplicity is worth a lot during the pilot.
- **Fee on estimated value vs asking value.** Using `estimatedValueCents` (the AI number) closes the obvious loophole where users would lower their asking values to dodge fees. But it means a user who genuinely thinks their item is worth less than the AI says still pays based on the AI number. The breakdown screen needs to make this explicit so it doesn't feel arbitrary.
- **The 7-day fee-gate timeout.** If one party pays and the other doesn't, when do we cut bait? Too short and we cancel swaps where someone's just away for a weekend. Too long and accepted-but-frozen swaps clog inventory. 7 days is a guess.
- **What happens to the conversation after a fee-gate timeout?** Currently we cancel and listings revert to LIVE. But the conversation history is preserved (people may have been chatting through it). Question is whether to archive it or delete — leaning archive, with a read-only banner.

---

*Companion documents: the visual app wireframe is in progress (waiting on the LivinLoop design system from Claude Design). The landing page will follow the design system once locked.*
