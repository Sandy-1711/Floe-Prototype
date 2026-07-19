/**
 * A budget guard the *model* can read — the missing primitive the Floe JD calls out
 * ("decision loops that don't know their own budget"). It is a local, estimate-based
 * mirror of Floe's server-side spend controls: `check()` blocks a call before it
 * happens, `advisory()` hands the agent a soft signal so it can downshift on its own.
 *
 * Local enforcement is fast and agent-visible; the real Floe proxy still enforces the
 * same cap server-side, so a determined loop can't simply ignore this.
 */

export interface Advisory {
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  /** 0..10000 — basis points of the cap consumed. */
  usedBps: number;
  /** True once usage crosses the soft threshold; the agent should economize. */
  nearLimit: boolean;
  /** True once there is no meaningful budget left. */
  exhausted: boolean;
}

export class BudgetExceeded extends Error {
  readonly estimateUsd: number;
  readonly advisory: Advisory;
  constructor(estimateUsd: number, advisory: Advisory) {
    super(
      `Budget would be exceeded: est $${estimateUsd.toFixed(4)} + spent ` +
        `$${advisory.spentUsd.toFixed(4)} > cap $${advisory.capUsd.toFixed(2)}`,
    );
    this.name = "BudgetExceeded";
    this.estimateUsd = estimateUsd;
    this.advisory = advisory;
  }
}

export class BudgetGuard {
  readonly capUsd: number;
  private readonly nearLimitBps: number;
  private spentUsd = 0;

  constructor(opts: { capUsd: number; nearLimitBps?: number }) {
    this.capUsd = opts.capUsd;
    this.nearLimitBps = opts.nearLimitBps ?? 7500; // economize at 75% of cap
  }

  /** Throw BudgetExceeded if this call would cross the cap. Call it pre-flight. */
  check(estimateUsd: number): void {
    if (this.spentUsd + estimateUsd > this.capUsd) {
      throw new BudgetExceeded(estimateUsd, this.advisory());
    }
  }

  /** Record actual spend after a call settles. */
  record(amountUsd: number): void {
    this.spentUsd += amountUsd;
  }

  advisory(): Advisory {
    const remainingUsd = Math.max(0, this.capUsd - this.spentUsd);
    const usedBps =
      this.capUsd <= 0
        ? 10000
        : Math.min(10000, Math.round((this.spentUsd / this.capUsd) * 10000));
    return {
      capUsd: this.capUsd,
      spentUsd: this.spentUsd,
      remainingUsd,
      usedBps,
      nearLimit: usedBps >= this.nearLimitBps,
      exhausted: remainingUsd <= 0.0001,
    };
  }
}
