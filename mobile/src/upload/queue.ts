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
  private failedByWalkthrough = new Map<string, Map<string, CapturedPhoto>>();
  private cancelledWalkthroughs = new Set<string>();
  private idleResolvers = new Map<string, Array<() => void>>();
  private listeners = new Set<Listener>();

  enqueue(walkthroughId: string, photo: CapturedPhoto): void {
    this.cancelledWalkthroughs.delete(walkthroughId);
    const pending = this.setBucket(this.pendingByWalkthrough, walkthroughId);
    pending.add(photo.id);
    this.emit();
    void this.process(walkthroughId, photo);
  }

  /**
   * Resolves once every photo enqueued for `walkthroughId` has either uploaded
   * successfully or moved to the failed bucket. Callers should inspect
   * `status(walkthroughId).failed` afterwards before treating the walkthrough
   * as complete.
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

  /**
   * Drops every queued and failed photo for `walkthroughId` so background
   * uploads stop wasting bandwidth after the user discards. Real in-flight
   * requests cannot be aborted in this stub; the follow-up uploader will wire
   * abort signals through the same call.
   */
  cancel(walkthroughId: string): void {
    this.cancelledWalkthroughs.add(walkthroughId);
    this.pendingByWalkthrough.delete(walkthroughId);
    this.inFlightByWalkthrough.delete(walkthroughId);
    this.failedByWalkthrough.delete(walkthroughId);
    this.emit();
    this.resolveIdle(walkthroughId);
  }

  /** Re-enqueues every failed photo so the user can retry uploads. */
  retryFailed(walkthroughId: string): number {
    const failed = this.failedByWalkthrough.get(walkthroughId);
    if (!failed || failed.size === 0) return 0;
    const photos = Array.from(failed.values());
    this.failedByWalkthrough.delete(walkthroughId);
    for (const photo of photos) this.enqueue(walkthroughId, photo);
    return photos.length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async process(walkthroughId: string, photo: CapturedPhoto) {
    if (this.cancelledWalkthroughs.has(walkthroughId)) return;

    this.pendingByWalkthrough.get(walkthroughId)?.delete(photo.id);
    const inFlight = this.setBucket(this.inFlightByWalkthrough, walkthroughId);
    inFlight.add(photo.id);
    this.emit();

    let succeeded = false;
    try {
      await this.upload(walkthroughId, photo);
      succeeded = true;
    } catch (err) {
      console.warn("[UploadQueue] upload failed", photo.id, err);
    } finally {
      this.inFlightByWalkthrough.get(walkthroughId)?.delete(photo.id);
      if (!succeeded && !this.cancelledWalkthroughs.has(walkthroughId)) {
        const failed = this.mapBucket(this.failedByWalkthrough, walkthroughId);
        failed.set(photo.id, photo);
      }
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

  private setBucket<V>(map: Map<string, Set<V>>, key: string): Set<V> {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Set<V>();
      map.set(key, bucket);
    }
    return bucket;
  }

  private mapBucket<K, V>(map: Map<string, Map<K, V>>, key: string): Map<K, V> {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = new Map<K, V>();
      map.set(key, bucket);
    }
    return bucket;
  }

  private isIdle(walkthroughId: string): boolean {
    const { pending, inFlight } = this.status(walkthroughId);
    return pending === 0 && inFlight === 0;
  }

  private maybeResolveIdle(walkthroughId: string) {
    if (!this.isIdle(walkthroughId)) return;
    this.resolveIdle(walkthroughId);
  }

  private resolveIdle(walkthroughId: string) {
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
    for (const map of this.failedByWalkthrough.values()) aggregate.failed += map.size;
    for (const listener of this.listeners) listener(aggregate);
  }
}

export const uploadQueue = new UploadQueue();
