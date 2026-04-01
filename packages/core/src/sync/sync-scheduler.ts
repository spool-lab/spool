/**
 * SyncScheduler manages timers for periodic forward sync and backfill operations.
 *
 * Each source can have at most one forward timer and one backfill timer.
 * Scheduling a new timer for the same source+direction cancels the previous one.
 */

export class SyncScheduler {
  private forwardTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private backfillTimers = new Map<number, ReturnType<typeof setTimeout>>()

  /**
   * Schedule a forward sync for a source after the given delay.
   * Replaces any existing forward timer for this source.
   */
  scheduleForward(opencliSrcId: number, delayMs: number, fn: () => void): void {
    this.clearForward(opencliSrcId)
    const timer = setTimeout(fn, delayMs)
    this.forwardTimers.set(opencliSrcId, timer)
  }

  /**
   * Schedule a backfill page for a source after the given delay.
   * Replaces any existing backfill timer for this source.
   */
  scheduleBackfill(opencliSrcId: number, delayMs: number, fn: () => void): void {
    this.clearBackfill(opencliSrcId)
    const timer = setTimeout(fn, delayMs)
    this.backfillTimers.set(opencliSrcId, timer)
  }

  /**
   * Cancel all scheduled jobs for a source.
   */
  cancel(opencliSrcId: number): void {
    this.clearForward(opencliSrcId)
    this.clearBackfill(opencliSrcId)
  }

  /**
   * Cancel all scheduled jobs across all sources.
   */
  cancelAll(): void {
    for (const timer of this.forwardTimers.values()) clearTimeout(timer)
    for (const timer of this.backfillTimers.values()) clearTimeout(timer)
    this.forwardTimers.clear()
    this.backfillTimers.clear()
  }

  /**
   * Get the number of active timers (for diagnostics).
   */
  get activeCount(): number {
    return this.forwardTimers.size + this.backfillTimers.size
  }

  private clearForward(opencliSrcId: number): void {
    const existing = this.forwardTimers.get(opencliSrcId)
    if (existing) {
      clearTimeout(existing)
      this.forwardTimers.delete(opencliSrcId)
    }
  }

  private clearBackfill(opencliSrcId: number): void {
    const existing = this.backfillTimers.get(opencliSrcId)
    if (existing) {
      clearTimeout(existing)
      this.backfillTimers.delete(opencliSrcId)
    }
  }
}
