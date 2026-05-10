export type WalkthroughType = 'pre_checkin' | 'post_checkout' | 'periodic_audit';

export type Shot = {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  referencePhotoUrl: string;
  required: boolean;
  order: number;
};

export type WalkthroughRun = {
  id: string;
  propertyId: string;
  propertyName: string;
  type: WalkthroughType;
  shots: Shot[];
  startedAt: string;
};

export type SkipReason =
  | 'blocked'
  | 'broken'
  | 'guest_in_room'
  | 'item_missing'
  | 'other';

export const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'broken', label: 'Broken' },
  { value: 'guest_in_room', label: 'Guest in room' },
  { value: 'item_missing', label: 'Item missing' },
  { value: 'other', label: 'Other' },
];

export type CapturedShot = {
  shotId: string;
  status: 'captured';
  localUri: string;
  width: number;
  height: number;
  capturedAt: string;
};

export type SkippedShot = {
  shotId: string;
  status: 'skipped';
  reason: SkipReason;
  reasonNote?: string;
  skippedAt: string;
};

export type ShotResult = CapturedShot | SkippedShot;

export type RunProgress = {
  runId: string;
  currentIndex: number;
  results: Record<string, ShotResult>;
  updatedAt: string;
};
