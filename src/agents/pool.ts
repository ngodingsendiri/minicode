export class Pool {
  private running = 0;
  private queue: {
    resolve: () => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }[] = [];

  constructor(private concurrency: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");

    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const entry: typeof this.queue[number] = { resolve, reject, signal };
        if (signal) {
          const onAbort = () => {
            const idx = this.queue.indexOf(entry);
            if (idx !== -1) this.queue.splice(idx, 1);
            reject(signal.reason ?? new Error("aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          entry.onAbort = onAbort;
        }
        this.queue.push(entry);
      });
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) {
        if (next.onAbort && next.signal) next.signal.removeEventListener("abort", next.onAbort);
        next.resolve();
      }
    }
  }
}