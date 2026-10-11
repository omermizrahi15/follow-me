/**
 * Keeps background grading out of the publisher's way.
 *
 * The photo classifier is one shared client with one set of provider limits
 * (Groq's ~8k tokens a minute, then Gemini's tiny daily cap). Two scans on it
 * at once do not go twice as fast — they put twice the tokens against the same
 * wall, 429, and throw away what was in flight. So grading ahead of time is
 * only ever allowed to use the quiet: it never starts while the publisher is
 * looking at a scan, and it steps aside the moment one begins.
 */
export interface BackgroundGrading {
  /** True once a live scan wants the classifier; the run should wind down. */
  shouldStop(): boolean;
  /** Frees the slot. Safe to call more than once. */
  end(): void;
}

export class GradingCoordinator {
  private interactive = 0;
  private background: Promise<void> | null = null;
  private resolveBackground: (() => void) | null = null;

  /** Null when the classifier is already spoken for (live scan, or another background run). */
  tryBeginBackground(): BackgroundGrading | null {
    if (this.interactive > 0 || this.background != null) return null;
    this.background = new Promise<void>(resolve => { this.resolveBackground = resolve; });
    const settle = this.resolveBackground;
    let ended = false;
    return {
      shouldStop: () => this.interactive > 0,
      end: () => {
        if (ended) return;
        ended = true;
        this.background = null;
        this.resolveBackground = null;
        settle?.();
      },
    };
  }

  /**
   * A live scan is starting. Resolves once any background run has wound down
   * (it is told to stop at its next photo, so this is one request, not a
   * whole scan). The returned function must be called when the scan ends.
   */
  async beginInteractive(): Promise<() => void> {
    this.interactive++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.interactive--;
    };
    try {
      await this.background;
    } catch {
      // A failed background run has still stopped.
    }
    return release;
  }
}
