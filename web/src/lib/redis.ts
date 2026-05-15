import IORedis from 'ioredis';

// Don't throw at module load when REDIS_URL is missing. Route
// files that don't actually use the queue (e.g., GET handlers in
// modules that also export POST → queue.add) would otherwise fail
// to import in environments without Redis configured. With
// lazyConnect, the connection isn't established until the first
// command runs.
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

// Fail-fast settings for producer connections:
//   - enableOfflineQueue: false  — commands sent while disconnected
//     reject immediately instead of buffering and hanging the
//     awaiting request handler until reconnection. Without this, a
//     Redis outage stalls `POST /api/listings/:id/extract` and the
//     photo-confirm enqueue until Railway's platform timeout (~30s
//     to 60s) instead of returning a clean 503.
//   - connectTimeout: 5000      — bound how long the initial
//     handshake waits before erroring.
//   - maxRetriesPerRequest: null — required by BullMQ for the
//     long-poll commands the Worker uses.
//
// BullMQ duplicates this connection internally for blocking
// Worker commands, so the offline-queue disabled here applies to
// producer (`Queue.add`) usage only — the Worker keeps its normal
// reconnect behavior.
export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  connectTimeout: 5000,
  lazyConnect: true,
});

export const bullmqPrefix = process.env.BULLMQ_PREFIX || 'livinloop';
