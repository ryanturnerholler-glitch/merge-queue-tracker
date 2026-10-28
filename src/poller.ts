import type * as vscode from "vscode";

/**
 * Runs one poll at a time and schedules the next with the delay the poll
 * returns. `pause` stops scheduling (window unfocused); `resume` and `runNow`
 * poll immediately. A `runNow` during a poll queues one more run right after.
 */
export class Poller implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private rerun = false;
  private paused = false;
  private disposed = false;

  constructor(
    private readonly task: () => Promise<number>,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  runNow(): void {
    if (this.disposed) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.clearTimer();
    void this.cycle();
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.runNow();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async cycle(): Promise<void> {
    this.running = true;
    let delayMs = 300_000;
    try {
      delayMs = await this.task();
    } catch (error) {
      this.log.error(`Unexpected poll failure: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
    if (this.disposed) return;
    if (this.rerun) {
      this.rerun = false;
      void this.cycle();
      return;
    }
    if (this.paused) return;
    this.timer = setTimeout(() => void this.cycle(), delayMs);
  }
}
