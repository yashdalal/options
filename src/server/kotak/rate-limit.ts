type RateLimiterOptions = {
  requestsPerSecond?: number;
};

export type RateLimiter = {
  schedule: <T>(task: () => Promise<T>) => Promise<T>;
};

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const requestsPerSecond = options.requestsPerSecond ?? 8;
  const minIntervalMs = Math.ceil(1000 / requestsPerSecond);
  let nextAvailableAt = 0;
  let chain: Promise<unknown> = Promise.resolve();

  function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, nextAvailableAt - now);
      nextAvailableAt = Math.max(now, nextAvailableAt) + minIntervalMs;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      return task();
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { schedule };
}

const globalStore = globalThis as typeof globalThis & {
  __kotakRateLimiter?: RateLimiter;
};

export function getKotakRateLimiter(): RateLimiter {
  if (!globalStore.__kotakRateLimiter) {
    globalStore.__kotakRateLimiter = createRateLimiter({ requestsPerSecond: 8 });
  }
  return globalStore.__kotakRateLimiter;
}
