import type { CapturedPhoto } from "@/types";

export type UploadStatus = {
  /** Photos that have been enqueued but not yet uploaded. */
  pending: number;
  /** Photos currently uploading. */
  inFlight: number;
  /** Photos that have failed and are awaiting retry. */
  failed: number;
};

type Listener = (status: UploadStatus) => void;

/**
 * Background upload queue. The real implementation (resumable tus uploads,
 * retry/backoff, concurrency control) is built in a follow-up step; this
 * version exposes the same surface so the capture screen can integrate today
 * without blocking on the network plumbing.
 */
class UploadQueue {
  private pendingByWalkthrough = new Map<string, Set<string>>();
  private inFlightByWalkthrough = new Map<string, Set<string>>();
  private failedByWalkthrough = new Map<string, Set<string>>();
  private idleResolvers = new Map<string, Array<() => void>>();
  private listeners = new Set<Listener>();

  enqueue(walkthroughId: string, photo: CapturedPhoto): void {
    const pending = this.bucket(this.pendingByWalkthrough, walkthroughId);
    pending.add(photo.id);
    this.emit();
    void this.process(walkthroughId, photo);
  }

  /**
   * Resolves once every photo enqueued for `walkthroughId` has either
   * uploaded successfully or been moved to the failed bucket.
   */
  waitForIdle(walkthroughId: string): Promise<void> {
    if (this.isIdle(walkthroughId)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.idleResolvers.get(walkthroughId) ?? [];
      list.push(resolve);
      this.idleResolvers.set(walkthroughId, list);
    });
  }

  status(walkthroughId: string): UploadStatus {
    return {
      pending: this.pendingByWalkthrough.get(walkthroughId)?.size ?? 0,
      inFlight: this.inFlightByWalkthrough.get(walkthroughId)?.size ?? 0,
      failed: this.failedByWalkthrough.get(walkthroughId)?.size ?? 0,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async process(walkthroughId: string, photo: CapturedPhoto) {
    const pending = this.bucket(this.pendingByWalkthrough, walkthroughId);
    const inFlight = this.bucket(this.inFlightByWalkthrough, walkthroughId);
    pending.delete(photo.id);
    inFlight.add(photo.id);
    this.emit();

    try {
      await this.upload(walkthroughId, photo);
    } catch (err) {
      const failed = this.bucket(this.failedByWalkthrough, walkthroughId);
      failed.add(photo.id);
      console.warn("[UploadQueue] upload failed", photo.id, err);
    } finally {
      inFlight.delete(photo.id);
      this.emit();
      this.maybeResolveIdle(walkthroughId);
    }
  }

  /** Replaced in the follow-up step with the real tus / presigned-PUT path. */
  private async upload(walkthroughId: string, photo: CapturedPhoto) {
    if (__DEV__) {
      console.log("[UploadQueue] would upload", { walkthroughId, photo });
    }
  }

  private bucket(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  private isIdle(walkthroughId: string): boolean {
    const { pending, inFlight } = this.status(walkthroughId);
    return pending === 0 && inFlight === 0;
  }

  private maybeResolveIdle(walkthroughId: string) {
    if (!this.isIdle(walkthroughId)) return;
    const resolvers = this.idleResolvers.get(walkthroughId);
    if (!resolvers?.length) return;
    this.idleResolvers.delete(walkthroughId);
    for (const resolve of resolvers) resolve();
  }

  private emit() {
    if (this.listeners.size === 0) return;
    const aggregate: UploadStatus = { pending: 0, inFlight: 0, failed: 0 };
    for (const set of this.pendingByWalkthrough.values()) aggregate.pending += set.size;
    for (const set of this.inFlightByWalkthrough.values()) aggregate.inFlight += set.size;
    for (const set of this.failedByWalkthrough.values()) aggregate.failed += set.size;
    for (const listener of this.listeners) listener(aggregate);
  }
}

export const uploadQueue = new UploadQueue();
