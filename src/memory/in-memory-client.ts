/**
 * InMemoryClient — in-process stub backend for MemoryClient.
 * Used in all tests AND as the default runtime backend (mempalace is Python-only).
 * Thread-safe within a single Bun process (single-threaded JS event loop).
 */

import type { MemoryClient, MemEntry } from "./types.ts";

export class InMemoryClient implements MemoryClient {
  private readonly store = new Map<string, MemEntry>();

  async read(key: string): Promise<MemEntry | null> {
    return this.store.get(key) ?? null;
  }

  async write(key: string, value: string, agent: string): Promise<void> {
    this.store.set(key, {
      key,
      value,
      agent,
      ts: Date.now(),
    });
  }

  async list(): Promise<MemEntry[]> {
    return Array.from(this.store.values());
  }

  /** Test helper: reset all state between tests. */
  clear(): void {
    this.store.clear();
  }

  /** Test helper: snapshot the raw store for assertions. */
  snapshot(): Map<string, MemEntry> {
    return new Map(this.store);
  }
}
