import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', service: 'web' });
  } catch (err) {
    // Public endpoint — don't leak driver/connection details.
    // Detail stays in server logs for Railway / Sentry to pick up.
    console.error('[health] db check failed', err);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
