'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

// Triggers POST /api/listings/:id/extract and polls
// GET /api/listings/:id until `valuationBreakdown` flips from
// null to an object (worker has written results). Times out at
// 60s; the user can refresh manually if Claude is slow.
export function ExtractButton({
  listingId,
  hasExtraction,
  disabled,
  disabledReason,
}: {
  listingId: string;
  hasExtraction: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    setStatus('Starting extraction…');
    try {
      const res = await fetch(`/api/listings/${listingId}/extract`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${body.error ?? 'unknown'}`);
      }

      setStatus('Claude is analyzing your photos…');
      const deadline = Date.now() + 60_000;
      let baseline: string | null = hasExtraction ? null : 'none';
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const check = await fetch(`/api/listings/${listingId}`);
        if (!check.ok) continue;
        const { listing } = (await check.json()) as {
          listing: { valuationBreakdown: { computedAt?: string } | null };
        };
        const cur = listing?.valuationBreakdown?.computedAt ?? null;
        // First time: any non-null breakdown means done.
        // Re-run: need to see a NEW computedAt timestamp.
        if (cur && cur !== baseline) {
          if (baseline === 'none' || !hasExtraction) {
            setStatus(null);
            startTransition(() => router.refresh());
            return;
          }
          if (baseline && cur !== baseline) {
            setStatus(null);
            startTransition(() => router.refresh());
            return;
          }
        }
        if (baseline === null && hasExtraction) {
          baseline = cur ?? null;
        }
      }
      setStatus(null);
      setError(
        'Taking longer than expected. The job is still running — refresh in a minute.',
      );
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        style={{
          padding: '10px 20px',
          background: busy || disabled ? '#888' : '#5b3df5',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: busy || disabled ? 'not-allowed' : 'pointer',
          fontSize: 14,
        }}
      >
        {busy
          ? 'Working…'
          : hasExtraction
            ? 'Re-run AI extraction'
            : 'Run AI extraction'}
      </button>
      {disabled && disabledReason && (
        <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          {disabledReason}
        </div>
      )}
      {status && (
        <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>{status}</div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: 8,
            background: '#fff4f4',
            border: '1px solid #f99',
            color: '#900',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
