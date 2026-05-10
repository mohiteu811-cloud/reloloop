export type UploadJob = {
  runId: string;
  shotId: string;
  localUri: string;
  width: number;
  height: number;
  enqueuedAt: string;
};

export type UploadQueueState = {
  pending: number;
  uploading: number;
  failed: number;
};

export type UploadQueue = {
  enqueue(job: UploadJob): void;
  drain(runId: string): Promise<void>;
  subscribe(listener: (state: UploadQueueState) => void): () => void;
  getState(): UploadQueueState;
};

const listeners = new Set<(state: UploadQueueState) => void>();
let state: UploadQueueState = { pending: 0, uploading: 0, failed: 0 };

const emit = () => {
  for (const l of listeners) l(state);
};

export const uploadQueue: UploadQueue = {
  enqueue(job) {
    if (__DEV__) console.log('[uploadQueue:stub] enqueue', job.shotId);
    state = { ...state, pending: state.pending + 1 };
    emit();
    setTimeout(() => {
      state = {
        ...state,
        pending: Math.max(0, state.pending - 1),
      };
      emit();
    }, 0);
  },
  async drain(_runId) {
    return;
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },
  getState() {
    return state;
  },
};
