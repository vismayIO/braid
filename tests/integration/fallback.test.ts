/**
 * Integration tests for AC-8: provider unavailability fallback.
 *
 * When a provider's isAvailable() returns {cli:false, api:false}:
 *  - It is skipped with a "provider unavailable" stderr message
 *  - Remaining providers continue
 *  - Run completes (no throw), exit code 0 semantics
 */

import { describe, it, expect } from "bun:test";
import { runOrchestrator } from "../../src/orchestrator.ts";
import { buildAssignments } from "../../src/router/static.ts";
import { InMemoryClient } from "../../src/memory/in-memory-client.ts";
import { Logger } from "../../src/logging.ts";
import type { ProviderAdapter, RunOpts, RunResult } from "../../src/providers/types.ts";
import { readFileSync, existsSync } from "fs";

function makeAvailableAdapter(name: string): ProviderAdapter {
  return {
    name,
    async isAvailable() {
      return { cli: true, api: false };
    },
    async run(opts: RunOpts): Promise<RunResult> {
      return {
        output: `Output from ${name}. ${opts.marker}`,
        duration_ms: 10,
        via: "cli",
      };
    },
  };
}

function makeUnavailableAdapter(name: string): ProviderAdapter {
  return {
    name,
    async isAvailable() {
      return { cli: false, api: false };
    },
    async run(): Promise<RunResult> {
      return {
        output: "",
        duration_ms: 0,
        via: "cli",
        error: `provider unavailable: ${name}`,
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
      task: "test",
      assignments: buildAssignments("test"),
      providers,
      memory,
      logger,
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
      task: "test",
      assignments: buildAssignments("test"),
      providers,
      memory,
      logger,
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
      task: "test",
      assignments: buildAssignments("test"),
      providers,
      memory,
      logger,
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
      task: "test",
      assignments: buildAssignments("test"),
      providers,
      memory,
      logger,
    });

    const path = logger.logFile;
    expect(existsSync(path)).toBe(true);

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const errorEnds = events.filter(
      (e) => e["event"] === "provider.end" && e["error"] !== undefined
    );

    // gemini and codex should have error end events
    const errorProviders = errorEnds.map((e) => e["provider"]);
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
      task: "write README",
      assignments: buildAssignments("write README"),
      providers,
      memory,
      logger,
    });

    const ollamaSection = result.sections.find((s) => s.provider === "ollama");
    expect(ollamaSection).toBeDefined();
    expect(ollamaSection!.content).toContain("<!-- agent:ollama -->");
  });
});
