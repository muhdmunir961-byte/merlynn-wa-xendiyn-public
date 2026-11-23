export class OutgoingQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly minimumDelayMs: number, private readonly jitterMs: number) {}

  enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(async () => {
      const delay = this.minimumDelayMs + Math.floor(Math.random() * Math.max(0, this.jitterMs));
      await new Promise((resolve) => setTimeout(resolve, delay));
      await task();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
