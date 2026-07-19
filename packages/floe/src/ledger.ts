import type { SpendEvent } from "./types.ts";

/**
 * The unified ledger. Every call — whether it settled through the real Floe proxy,
 * the Gemini adapter, or the local shim — lands here in the same shape. That single
 * pane across every vendor is the thing Floe sells; this is the client-side view of it.
 */
export class Ledger {
  readonly events: SpendEvent[] = [];
  private listeners = new Set<(e: SpendEvent) => void>();

  record(event: SpendEvent): SpendEvent {
    this.events.push(event);
    for (const fn of this.listeners) fn(event);
    return event;
  }

  /** Subscribe to new rows (used to stream the ledger to the UI live). */
  onEvent(fn: (e: SpendEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get totalUsd(): number {
    return this.events.reduce((sum, e) => sum + e.amountUsd, 0);
  }

  byVendor(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.events) {
      out[e.vendor] = (out[e.vendor] ?? 0) + e.amountUsd;
    }
    return out;
  }
}
