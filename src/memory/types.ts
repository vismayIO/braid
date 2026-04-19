/**
 * MemoryClient interface — Step 4 of the plan.
 * Abstracts the shared-memory backend so tests use InMemoryClient
 * and production can swap to MempalaceClient without touching orchestrator code.
 */

export type MemEntry = {
  key: string;
  value: string;
  /** Name of the provider agent that wrote this entry. */
  agent: string;
  /** Unix epoch milliseconds. */
  ts: number;
};

export interface MemoryClient {
  read(key: string): Promise<MemEntry | null>;
  write(key: string, value: string, agent: string): Promise<void>;
  list(): Promise<MemEntry[]>;
}
