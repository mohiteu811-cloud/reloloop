import type { Processor } from 'bullmq';
import {
  embedImages,
  meanPool,
  l2Normalize,
  CLIP_MODEL,
  EMBEDDING_DIM,
} from '../../lib/replicate';
import { prisma } from '../../lib/prisma';
import { matchComputeQueue } from '../../lib/queues';

export type ListingEmbedJob = { listingId: string };

// listing-embed worker. Triggered by the publish endpoint after it
// atomically flips DRAFT → PROCESSING. On success:
//   1. Compute CLIP embedding for the listing's photos
//   2. Persist 768-dim vector into ListingEmbedding (pgvector)
//   3. Flip PROCESSING → LIVE with publishedAt = now
//   4. Enqueue match-compute so the listing appears in match queries
//
// On retry-exhausting failure, attachListingEmbedFailureHandler
// reverts PROCESSING → DRAFT so the user can re-publish.
export const listingEmbedProcessor: Processor<ListingEmbedJob> = async (
  job,
) => {
  const { listingId } = job.data;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { photos: { orderBy: { uploadedAt: 'asc' }, take: 4 } },
  });
  if (!listing) {
    console.warn(`[listing-embed] ${listingId} not found, skipping`);
    return { skipped: true };
  }
  // Only run for PROCESSING (publish flow) or LIVE (manual
  // re-embed). Skip if the user withdrew or something else
  // transitioned the listing while the job was in the queue.
  if (listing.status !== 'PROCESSING' && listing.status !== 'LIVE') {
    console.warn(
      `[listing-embed] ${listingId} skipped, status=${listing.status}`,
    );
    return { skipped: true, reason: 'wrong_status' };
  }
  if (listing.photos.length === 0) {
    throw new Error('no_photos');
  }

  // 1. Call Replicate CLIP for each photo URL.
  const photoUrls = listing.photos.map((p) => p.url);
  const vectors = await embedImages(photoUrls);
  if (vectors.length === 0) {
    throw new Error('no_embeddings_returned');
  }

  // 2. Mean-pool + L2 normalize.
  const pooled = meanPool(vectors);
  const normalized = l2Normalize(pooled);
  if (normalized.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding dim mismatch after pooling: ${normalized.length} vs ${EMBEDDING_DIM}`,
    );
  }

  // 3. Persist via raw SQL — Prisma can't write `Unsupported("vector(768)")`.
  // The vector is passed as a string literal (e.g. "[0.1,0.2,...]") and
  // Postgres casts it to the vector type. Parameterised so the array
  // string can't break out of the literal.
  const vectorLiteral = `[${normalized.join(',')}]`;
  const modelOwnerName = CLIP_MODEL.split(':')[0] ?? CLIP_MODEL;
  const modelVersion = CLIP_MODEL.split(':')[1] ?? 'unpinned';
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "ListingEmbedding" ("listingId", "vector", "modelName", "modelVersion", "computedAt")
    VALUES ($1, $2::vector, $3, $4, NOW())
    ON CONFLICT ("listingId") DO UPDATE SET
      "vector" = EXCLUDED."vector",
      "modelName" = EXCLUDED."modelName",
      "modelVersion" = EXCLUDED."modelVersion",
      "computedAt" = NOW()
    `,
    listingId,
    vectorLiteral,
    modelOwnerName,
    modelVersion,
  );

  // 4. Flip PROCESSING → LIVE (set publishedAt now). Skip if a
  // concurrent withdraw flipped us out of PROCESSING. If we were
  // already LIVE (manual re-embed), updateMany is a no-op which is
  // fine — the embedding is the only thing that needed refreshing.
  if (listing.status === 'PROCESSING') {
    const flip = await prisma.listing.updateMany({
      where: { id: listingId, status: 'PROCESSING' },
      data: { status: 'LIVE', publishedAt: new Date() },
    });
    if (flip.count === 0) {
      console.warn(
        `[listing-embed] ${listingId} status changed during run, skipped LIVE flip`,
      );
      return { skipped: true, reason: 'status_changed_during_run' };
    }
  }

  // 5. Enqueue match-compute. removeOnComplete/Fail: true so the
  // jobId frees up immediately for re-runs (same pattern as the
  // other queues post-M3a).
  await matchComputeQueue.add(
    'compute',
    { listingId },
    {
      jobId: `match-${listingId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

  console.log(`[listing-embed] ${listingId} done`, {
    photos: listing.photos.length,
    dim: normalized.length,
    model: CLIP_MODEL,
  });

  return { listingId, photos: listing.photos.length };
};

// Final-attempt failure handler. If Replicate is down for the full
// retry window, the publish-triggered listing would otherwise stay
// stuck in PROCESSING. Revert to DRAFT so the user can try again.
export function attachListingEmbedFailureHandler(worker: {
  on: (event: 'failed', cb: (job: unknown, err: Error) => void) => void;
}) {
  worker.on('failed', async (job, err) => {
    if (!job || typeof job !== 'object') return;
    const j = job as {
      attemptsMade?: number;
      opts?: { attempts?: number };
      data?: { listingId?: string };
    };
    const attempts = j.opts?.attempts ?? 1;
    const attemptsMade = j.attemptsMade ?? 0;
    if (attemptsMade < attempts) return;
    const listingId = j.data?.listingId;
    if (!listingId) return;
    try {
      await prisma.listing.updateMany({
        where: { id: listingId, status: 'PROCESSING' },
        data: { status: 'DRAFT' },
      });
      console.warn(
        `[listing-embed] ${listingId} reverted to DRAFT after final failure`,
        { error: String(err) },
      );
    } catch (cleanupErr) {
      console.error(
        `[listing-embed] revert failed for ${listingId}`,
        cleanupErr,
      );
    }
  });
}
