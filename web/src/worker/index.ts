import { Worker, type Processor } from 'bullmq';
import { redisConnection, bullmqPrefix } from '../lib/redis';
import { prisma } from '../lib/prisma';
import {
  photoPostprocessProcessor,
} from './jobs/photo-postprocess';
import {
  listingAutofillProcessor,
  attachListingAutofillFailureHandler,
} from './jobs/listing-autofill';

const queueNames = [
  'photo-postprocess',
  'listing-autofill',
  'listing-embed',
  'match-compute',
  'match-nightly',
  'fee-gate-timeout',
] as const;

type QueueName = (typeof queueNames)[number];

const stubProcessor: Processor = async (job) => {
  console.log(`[worker] ${job.queueName} received job ${job.id}`, job.data);
  return { stubbed: true };
};

const handlers: Record<QueueName, Processor> = {
  'photo-postprocess': photoPostprocessProcessor as Processor,
  'listing-autofill': listingAutofillProcessor as Processor,
  'listing-embed': stubProcessor,
  'match-compute': stubProcessor,
  'match-nightly': stubProcessor,
  'fee-gate-timeout': stubProcessor,
};

const workers = queueNames.map(
  (name) =>
    new Worker(name, handlers[name], {
      connection: redisConnection,
      prefix: bullmqPrefix,
      concurrency: 4,
    }),
);

for (const w of workers) {
  w.on('failed', (job, err) => {
    console.error(`[worker] ${w.name} job ${job?.id} failed`, err);
  });
  w.on('error', (err) => {
    console.error(`[worker] ${w.name} error`, err);
  });
  w.on('ready', () => console.log(`[worker] ${w.name} ready`));
}

// Job-specific cleanup: when listing-autofill's final retry fails,
// flip the listing back from PROCESSING to DRAFT so the user can
// retry. Separate from the generic failed-logger above.
const autofillWorker = workers.find((w) => w.name === 'listing-autofill');
if (autofillWorker) {
  attachListingAutofillFailureHandler(autofillWorker);
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
