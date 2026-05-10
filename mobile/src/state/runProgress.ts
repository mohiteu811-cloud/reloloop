import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CapturedShot,
  RunProgress,
  ShotResult,
  SkipReason,
  SkippedShot,
  WalkthroughRun,
} from '@/types/walkthrough';

const KEY_PREFIX = 'reloloop:run-progress:';

export type ProgressAction =
  | { type: 'restore'; progress: RunProgress }
  | { type: 'capture'; shot: Omit<CapturedShot, 'status' | 'capturedAt'> }
  | { type: 'skip'; shot: Omit<SkippedShot, 'status' | 'skippedAt'> }
  | { type: 'advance' }
  | { type: 'jumpTo'; index: number };

export function initProgress(run: WalkthroughRun): RunProgress {
  return {
    runId: run.id,
    currentIndex: 0,
    results: {},
    updatedAt: new Date().toISOString(),
  };
}

export function progressReducer(state: RunProgress, action: ProgressAction): RunProgress {
  const now = new Date().toISOString();
  switch (action.type) {
    case 'restore':
      return action.progress;
    case 'capture': {
      const result: CapturedShot = {
        ...action.shot,
        status: 'captured',
        capturedAt: now,
      };
      return {
        ...state,
        results: { ...state.results, [result.shotId]: result },
        updatedAt: now,
      };
    }
    case 'skip': {
      const result: SkippedShot = {
        ...action.shot,
        status: 'skipped',
        skippedAt: now,
      };
      return {
        ...state,
        results: { ...state.results, [result.shotId]: result },
        updatedAt: now,
      };
    }
    case 'advance':
      return { ...state, currentIndex: state.currentIndex + 1, updatedAt: now };
    case 'jumpTo':
      return { ...state, currentIndex: action.index, updatedAt: now };
  }
}

export async function persistProgress(progress: RunProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + progress.runId, JSON.stringify(progress));
  } catch (err) {
    console.warn('[runProgress] persist failed', err);
  }
}

export async function loadProgress(runId: string): Promise<RunProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + runId);
    if (!raw) return null;
    return JSON.parse(raw) as RunProgress;
  } catch (err) {
    console.warn('[runProgress] load failed', err);
    return null;
  }
}

export async function clearProgress(runId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + runId);
  } catch (err) {
    console.warn('[runProgress] clear failed', err);
  }
}

export function summarize(progress: RunProgress, total: number) {
  const results = Object.values(progress.results) as ShotResult[];
  const captured = results.filter((r) => r.status === 'captured').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return { captured, skipped, total, remaining: Math.max(0, total - captured - skipped) };
}

export function describeSkip(reason: SkipReason): string {
  switch (reason) {
    case 'blocked':
      return 'Blocked';
    case 'broken':
      return 'Broken';
    case 'guest_in_room':
      return 'Guest in room';
    case 'item_missing':
      return 'Item missing';
    case 'other':
      return 'Other';
  }
}
