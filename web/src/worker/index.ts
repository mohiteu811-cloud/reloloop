import { Worker, type Processor } from 'bullmq';
import { redisConnection, bullmqPrefix } from '../lib/redis';
import { prisma } from '../lib/prisma';

// Queue names per reloloop-schema.md §7.1. Handlers are stubs in M1;
// real implementations land alongside the photo pipeline (M2), the
// Claude extraction + valuation (M3), embeddings + matching (M4),
// proposals (M5), and fees (M6).
const queueNames = [
  'photo:postprocess',
  'listing:autofill',
  'listing:embed',
  'match:compute',
  'match:nightly',
  'fee:gate-timeout',
] as const;

const stubProcessor: Processor = async (job) => {
  console.log(`[worker] ${job.queueName} received job ${job.id}`, job.data);
  return { stubbed: true };
};

const workers = queueNames.map(
  (name) =>
    new Worker(name, stubProcessor, {
      connection: redisConnection,
      prefix: bullmqPrefix,
      concurrency: 4,
    }),
);

for (const w of workers) {
  w.on('failed', (job, err) => {
    console.error(`[worker] ${w.name} job ${job?.id} failed`, err);
  });
  // BullMQ emits `error` on Redis disconnects and other runtime
  // faults. An unhandled `error` event in Node crashes the
  // process — swallow + log so a transient Redis blip doesn't
  // take down all six queues.
  w.on('error', (err) => {
    console.error(`[worker] ${w.name} error`, err);
  });
  w.on('ready', () => console.log(`[worker] ${w.name} ready`));
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, draining...`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] booted with ${workers.length} queues (prefix=${bullmqPrefix})`);
