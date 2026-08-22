export class Pool {
  private running = 0;
  private queue: (() => Promise<void>)[] = [];

  constructor(private concurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve as never));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) (next as () => void)();
    }
  }
}
