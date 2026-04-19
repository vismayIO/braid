/**
 * Core provider protocol — Step 2 of the plan.
 * Every concrete adapter implements ProviderAdapter; no provider-specific
 * logic leaks above this boundary.
 */

export interface ProviderAdapter {
  /** Stable identifier used in log events and marker strings. */
  readonly name: string;

  /**
   * Lightweight availability probe (hello-probe, not just --version).
   * Must complete within 5 seconds.
   * Returns { cli: true } if the CLI binary is reachable and authenticated,
   * { api: true } if the HTTP API is reachable.
   */
  isAvailable(): Promise<{ cli: boolean; api: boolean }>;

  /**
   * Run the provider with the given options.
   * MUST NOT throw — return error field on failure.
   */
  run(opts: RunOpts): Promise<RunResult>;
}

export type RunOpts = {
  /** Full prompt text to send to the provider. */
  prompt: string;
  /** HTML-comment marker this provider must include, e.g. "<!-- agent:codex -->". */
  marker: string;
  /** Serialised memory context from other providers (phase-1 notes). */
  memoryCtx: string;
  /** Abort signal — callers set a 60s deadline. */
  signal: AbortSignal;
};

export type RunResult = {
  /** Raw text output from the provider. */
  output: string;
  /** Wall-clock duration in milliseconds. */
  duration_ms: number;
  /** Whether the CLI binary or HTTP API was used. */
  via: "cli" | "api";
  /** Set when the run failed; output will be empty string. */
  error?: string;
};
