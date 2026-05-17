import { Queue } from 'bullmq';
import { redisConnection, bullmqPrefix } from './redis';

// Singleton Queue instances. In Next.js dev with HMR, route files
// can re-evaluate, so we cache the Queue on globalThis to avoid
// leaking connection handles. Same pattern as PrismaClient.
//
// Names are kebab-case: BullMQ 5.x rejects `:` in queue names
// because it conflicts with the Redis key separator.
const globalForQueues = globalThis as unknown as {
  __livinloopQueues?: Record<string, Queue>;
};

const opts = { connection: redisConnection, prefix: bullmqPrefix };

function getQueue(name: string): Queue {
  if (!globalForQueues.__livinloopQueues) {
    globalForQueues.__livinloopQueues = {};
  }
  let q = globalForQueues.__livinloopQueues[name];
  if (!q) {
    q = new Queue(name, opts);
    globalForQueues.__livinloopQueues[name] = q;
  }
  return q;
}

export const photoPostprocessQueue = getQueue('photo-postprocess');
export const listingAutofillQueue = getQueue('listing-autofill');
export const listingEmbedQueue = getQueue('listing-embed');
export const matchComputeQueue = getQueue('match-compute');
