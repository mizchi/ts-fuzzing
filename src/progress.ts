export type ProgressEvent = {
  elapsedMs: number;
  failures: number;
  iteration: number;
  totalRuns?: number;
};

export type ProgressHook = (event: ProgressEvent) => void | Promise<void>;

export type ProgressOptions = {
  onProgress?: ProgressHook;
  progressIntervalMs?: number;
};

export const createProgressTracker = (options: ProgressOptions) => {
  if (!options.onProgress) {
    return {
      tick: async (_iteration: number, _failures: number, _totalRuns?: number) => {},
      finalize: async (_iteration: number, _failures: number, _totalRuns?: number) => {},
    };
  }

  const interval = options.progressIntervalMs ?? 1000;
  const onProgress = options.onProgress;
  const startedAt = Date.now();
  let lastEmittedAt = startedAt;
  let lastEmittedIteration = 0;

  const tick = async (iteration: number, failures: number, totalRuns?: number) => {
    const now = Date.now();
    if (now - lastEmittedAt < interval) {
      return;
    }
    lastEmittedAt = now;
    lastEmittedIteration = iteration;
    await onProgress({
      elapsedMs: now - startedAt,
      failures,
      iteration,
      totalRuns,
    });
  };

  const finalize = async (iteration: number, failures: number, totalRuns?: number) => {
    if (iteration === lastEmittedIteration) {
      return;
    }
    await onProgress({
      elapsedMs: Date.now() - startedAt,
      failures,
      iteration,
      totalRuns,
    });
  };

  return { tick, finalize };
};
