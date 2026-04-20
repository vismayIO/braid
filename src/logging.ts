/**
 * Observability — Step 9 of the plan.
 * Writes structured JSONL events to .braid/run-<ISO>.jsonl.
 * Also emits a one-line console summary per event.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";

export type EventType =
  | "provider.start"
  | "provider.end"
  | "memory.read"
  | "memory.write"
  | "merge.complete"
  | "run.complete";

export type LogEvent = {
  event: EventType;
  timestamp_ms: number;
  /** Provider name, when relevant. */
  provider?: string;
  /** Memory key, when relevant. */
  key?: string;
  /** Agent that performed memory op. */
  agent?: string;
  /** Duration in ms (provider.end, merge.complete, run.complete). */
  duration_ms?: number;
  /** Exit code from CLI process. */
  exit_code?: number;
  /** Transport used (cli | api). */
  via?: "cli" | "api";
  /** Error message if the event represents a failure. */
  error?: string;
  /** Free-form extra data. */
  [key: string]: unknown;
};

export class Logger {
  private readonly filePath: string;
  private readonly runId: string;

  constructor(runId?: string) {
    this.runId = runId ?? new Date().toISOString().replace(/[:.]/g, "-");
    const dir = ".braid";
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = `${dir}/run-${this.runId}.jsonl`;
  }

  emit(event: Omit<LogEvent, "timestamp_ms">): void {
    const entry: LogEvent = {
      ...event,
      timestamp_ms: Date.now(),
    } as LogEvent;
    appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    // One-line console summary
    const parts: string[] = [`[${entry.event}]`];
    if (entry.provider) {
      parts.push(`provider=${entry.provider}`);
    }
    if (entry.key) {
      parts.push(`key=${entry.key}`);
    }
    if (entry.agent) {
      parts.push(`agent=${entry.agent}`);
    }
    if (entry.duration_ms !== undefined) {
      parts.push(`duration=${entry.duration_ms}ms`);
    }
    if (entry.error) {
      parts.push(`error=${entry.error}`);
    }
    console.error(parts.join(" "));
  }

  get logFile(): string {
    return this.filePath;
  }

  get id(): string {
    return this.runId;
  }
}
