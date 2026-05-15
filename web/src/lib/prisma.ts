import { Prisma, PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Wrap a serializable interactive transaction in a bounded retry
// loop. Prisma surfaces serialization conflicts as P2034; the
// expected pattern at Serializable isolation is for the app to
// retry. Without this, two healthy concurrent confirms can
// intermittently 500 even though no business rule was violated.
export async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        lastErr = err;
        // Exponential backoff with jitter: ~10ms, ~25ms, ~55ms.
        await new Promise((r) =>
          setTimeout(r, 10 * (attempt + 1) ** 2 + Math.random() * 10),
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
