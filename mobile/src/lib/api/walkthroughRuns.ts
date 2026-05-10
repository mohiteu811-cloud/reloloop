import { API_BASE_URL } from '@/lib/config';
import type { WalkthroughRun, WalkthroughType } from '@/types/walkthrough';

export type StartRunInput = {
  propertyId: string;
  type: WalkthroughType;
};

export async function startRun(input: StartRunInput): Promise<WalkthroughRun> {
  const res = await fetch(`${API_BASE_URL}/api/walkthrough-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`startRun failed: ${res.status}`);
  return (await res.json()) as WalkthroughRun;
}

export async function fetchRun(runId: string): Promise<WalkthroughRun> {
  const res = await fetch(`${API_BASE_URL}/api/walkthrough-runs/${runId}`);
  if (!res.ok) throw new Error(`fetchRun failed: ${res.status}`);
  return (await res.json()) as WalkthroughRun;
}

export async function completeRun(runId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/api/walkthrough-runs/${runId}/complete`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`completeRun failed: ${res.status}`);
}
