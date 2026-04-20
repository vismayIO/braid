/**
 * Integration tests for AC-8: provider unavailability fallback.
 *
 * When a provider's isAvailable() returns {cli:false, api:false}:
 *  - It is skipped with a "provider unavailable" stderr message
 *  - Remaining providers continue
 *  - Run completes (no throw), exit code 0 semantics
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Logger } from "../../src/logging.ts";
import { InMemoryClient } from "../../src/memory/in-memory-client.ts";
import { runOrchestrator } from "../../src/orchestrator.ts";
import type { ProviderAdapter, RunOpts, RunResult } from "../../src/providers/types.ts";
import { buildAssignments } from "../../src/router/static.ts";

function makeAvailableAdapter(name: string): ProviderAdapter {
  return {
    async isAvailable() {
      return { api: false, cli: true };
    },
    name,
    async run(opts: RunOpts): Promise<RunResult> {
      return {
        duration_ms: 10,
        output: `Output from ${name}. ${opts.marker}`,
        via: "cli",
      };
    },
  };
}

function makeUnavailableAdapter(name: string): ProviderAdapter {
  return {
    async isAvailable() {
      return { api: false, cli: false };
    },
    name,
    async run(): Promise<RunResult> {
      return {
        duration_ms: 0,
        error: `provider unavailable: ${name}`,
        output: "",
        via: "cli",
      };
    },
  };
}

function makeLogger(): Logger {
  return new Logger(`fallback-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("AC-8: Fallback behavior", () => {
  it("unavailable providers are listed in skippedProviders", async () => {
    const providers = new Map<string, ProviderAdapter>([
      ["gemini", makeUnavailableAdapter("gemini")],
      ["codex", makeUnavailableAdapter("codex")],
      ["ollama", makeAvailableAdapter("ollama")],
    ]);

    const logger = makeLogger();
    const memory = new InMemoryClient();

    const result = await runOrchestrator({
      assignments: buildAssignments("test"),
      logger,
      memory,
      providers,
      task: "test",
    });

    expect(result.skippedProviders).toContain("gemini");
    expect(result.skippedProviders).toContain("codex");
  });

  it("available providers still produce output when others are unavailable", async () => {
    const providers = new Map<string, ProviderAdapter>([
      ["gemini", makeUnavailableAdapter("gemini")],
      ["codex", makeUnavailableAdapter("codex")],
      ["ollama", makeAvailableAdapter("ollama")],
    ]);

    const logger = makeLogger();
    const memory = new InMemoryClient();

    const result = await runOrchestrator({
      assignments: buildAssignments("test"),
      logger,
      memory,
      providers,
      task: "test",
    });

    const sections = result.sections;
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.some((s) => s.provider === "ollama")).toBe(true);
  });

  it("does not throw when all providers are unavailable", async () => {
    const providers = new Map<string, ProviderAdapter>([
      ["gemini", makeUnavailableAdapter("gemini")],
      ["codex", makeUnavailableAdapter("codex")],
      ["ollama", makeUnavailableAdapter("ollama")],
    ]);

    const logger = makeLogger();
    const memory = new InMemoryClient();

    // Must not throw
    const result = await runOrchestrator({
      assignments: buildAssignments("test"),
      logger,
      memory,
      providers,
      task: "test",
    });

    expect(result.sections.length).toBe(0);
    expect(result.skippedProviders.length).toBe(3);
  });

  it("JSONL log records provider.end with error for unavailable providers", async () => {
    const providers = new Map<string, ProviderAdapter>([
      ["gemini", makeUnavailableAdapter("gemini")],
      ["codex", makeUnavailableAdapter("codex")],
      ["ollama", makeAvailableAdapter("ollama")],
    ]);

    const logger = makeLogger();
    const memory = new InMemoryClient();

    await runOrchestrator({
      assignments: buildAssignments("test"),
      logger,
      memory,
      providers,
      task: "test",
    });

    const path = logger.logFile;
    expect(existsSync(path)).toBe(true);

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const errorEnds = events.filter((e) => e.event === "provider.end" && e.error !== undefined);

    // gemini and codex should have error end events
    const errorProviders = errorEnds.map((e) => e.provider);
    expect(errorProviders).toContain("gemini");
    expect(errorProviders).toContain("codex");
  });

  it("ollama-only run produces output with ollama marker", async () => {
    const providers = new Map<string, ProviderAdapter>([
      ["gemini", makeUnavailableAdapter("gemini")],
      ["codex", makeUnavailableAdapter("codex")],
      ["ollama", makeAvailableAdapter("ollama")],
    ]);

    const logger = makeLogger();
    const memory = new InMemoryClient();

    const result = await runOrchestrator({
      assignments: buildAssignments("write README"),
      logger,
      memory,
      providers,
      task: "write README",
    });

    const ollamaSection = result.sections.find((s) => s.provider === "ollama");
    expect(ollamaSection).toBeDefined();
    expect(ollamaSection!.content).toContain("<!-- agent:ollama -->");
  });
});
