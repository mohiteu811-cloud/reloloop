import IORedis from 'ioredis';

// Don't throw at module load when REDIS_URL is missing. Route
// files that don't actually use the queue (e.g., GET handlers in
// modules that also export POST → queue.add) would otherwise fail
// to import in environments without Redis configured. With
// lazyConnect, the connection isn't established until the first
// command runs — at which point any real misconfiguration surfaces
// with a clear IORedis error rather than a module-load crash.
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

export const bullmqPrefix = process.env.BULLMQ_PREFIX || 'livinloop';
