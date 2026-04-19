/**
 * Integration tests for the orchestrator — AC-3, AC-5, AC-6, AC-7, AC-9, AC-11.
 *
 * Uses three mock adapters each with a 100ms artificial delay.
 * Asserts:
 *  (a) three provider.start timestamps within 50ms of each other (parallelism)
 *  (b) total wall-clock < sum of individual durations × 0.8
 *  (c) all three markers present in merged output
 *  (d) each agent has exactly one memory.write in phase 1 (AC-6)
 *  (e) at least one cross-agent memory.read (AC-7)
 *  (f) failure isolation: one mock throws → others still produce output
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runOrchestrator } from "../../src/orchestrator.ts";
import { buildAssignments } from "../../src/router/static.ts";
import { InMemoryClient } from "../../src/memory/in-memory-client.ts";
import { Logger } from "../../src/logging.ts";
import { mergeSections } from "../../src/merger/readme.ts";
import type { ProviderAdapter, RunOpts, RunResult } from "../../src/providers/types.ts";
import { readFileSync, unlinkSync, existsSync } from "fs";

const DELAY_MS = 100;

/** Mock adapter that succeeds after a fixed delay. */
function makeMockAdapter(
  name: string,
  delayMs = DELAY_MS
): ProviderAdapter & { startTimes: number[] } {
  const startTimes: number[] = [];
  return {
    name,
    startTimes,
    async isAvailable() {
      return { cli: true, api: false };
    },
    async run(opts: RunOpts): Promise<RunResult> {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, delayMs));
      return {
        output: `Section content from ${name}. ${opts.marker}`,
        duration_ms: delayMs,
        via: "cli",
      };
    },
  };
}

/** Mock adapter that is unavailable. */
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

/** Mock adapter whose run() returns an error result. */
function makeFailingAdapter(name: string): ProviderAdapter {
  return {
    name,
    async isAvailable() {
      return { cli: true, api: false };
    },
    async run(): Promise<RunResult> {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return {
        output: "",
        duration_ms: DELAY_MS,
        via: "cli",
        error: `${name} failed intentionally`,
      };
    },
  };
}

function makeLogger(): Logger {
  // Use a unique run ID per test to avoid file conflicts
  return new Logger(`test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function readLogEvents(logger: Logger): Array<Record<string, unknown>> {
  const path = logger.logFile;
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("Orchestrator integration", () => {
  describe("AC-3: parallel dispatch", () => {
    it("all three provider.start timestamps are within 50ms of each other", async () => {
      const gemini = makeMockAdapter("gemini");
      const codex = makeMockAdapter("codex");
      const ollama = makeMockAdapter("ollama");

      const providers = new Map<string, ProviderAdapter>([
        ["gemini", gemini],
        ["codex", codex],
        ["ollama", ollama],
      ]);

      const logger = makeLogger();
      const memory = new InMemoryClient();

      const wallStart = Date.now();
      await runOrchestrator({
        task: "test task",
        assignments: buildAssignments("test task"),
        providers,
        memory,
        logger,
      });
      const wallEnd = Date.now();

      const events = readLogEvents(logger);
      const startEvents = events.filter((e) => e["event"] === "provider.start" && !String(e["provider"] ?? "").includes("phase2"));

      expect(startEvents.length).toBeGreaterThanOrEqual(3);

      const timestamps = startEvents.map((e) => e["timestamp_ms"] as number);
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      // All three starts within 50ms of each other
      expect(maxTs - minTs).toBeLessThan(50);
    });

    it("total wall-clock < sum of individual durations × 0.8", async () => {
      const DELAY = 150;
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini", DELAY)],
        ["codex", makeMockAdapter("codex", DELAY)],
        ["ollama", makeMockAdapter("ollama", DELAY)],
      ]);

      const logger = makeLogger();
      const memory = new InMemoryClient();

      const wallStart = Date.now();
      await runOrchestrator({
        task: "test task",
        assignments: buildAssignments("test task"),
        providers,
        memory,
        logger,
      });
      const wallMs = Date.now() - wallStart;

      // Sum of individual phase-1 durations = 3 × DELAY = 450ms
      // Total wall-clock should be well under 450 × 0.8 = 360ms
      const sumDurations = DELAY * 3;
      expect(wallMs).toBeLessThan(sumDurations * 0.8);
    });
  });

  describe("AC-5: all three markers in merged output", () => {
    it("merged output contains all three agent markers", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini")],
        ["codex", makeMockAdapter("codex")],
        ["ollama", makeMockAdapter("ollama")],
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

      const allSections = result.summary ? [result.summary, ...result.sections] : result.sections;
      const merged = mergeSections(allSections);

      expect(merged.content).toContain("<!-- agent:gemini -->");
      expect(merged.content).toContain("<!-- agent:codex -->");
      expect(merged.content).toContain("<!-- agent:ollama -->");
    });
  });

  describe("AC-6: exactly one memory.write per agent in phase 1", () => {
    it("each agent writes exactly once in phase 1 (draft key)", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini")],
        ["codex", makeMockAdapter("codex")],
        ["ollama", makeMockAdapter("ollama")],
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

      const events = readLogEvents(logger);
      const writeEvents = events.filter(
        (e) => e["event"] === "memory.write" && String(e["key"] ?? "").includes(":draft")
      );

      // Exactly one draft write per agent
      const byAgent = new Map<string, number>();
      for (const ev of writeEvents) {
        const agent = ev["agent"] as string;
        byAgent.set(agent, (byAgent.get(agent) ?? 0) + 1);
      }

      expect(byAgent.get("gemini")).toBe(1);
      expect(byAgent.get("codex")).toBe(1);
      expect(byAgent.get("ollama")).toBe(1);
    });
  });

  describe("AC-7: cross-agent memory.read", () => {
    it("at least one memory.read event reads a key written by a different agent", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini")],
        ["codex", makeMockAdapter("codex")],
        ["ollama", makeMockAdapter("ollama")],
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

      const events = readLogEvents(logger);
      const readEvents = events.filter((e) => e["event"] === "memory.read");
      const writeEvents = events.filter((e) => e["event"] === "memory.write");

      // Find at least one read where the key was written by a different agent
      const crossAgentRead = readEvents.some((readEv) => {
        const readKey = readEv["key"] as string;
        const readAgent = readEv["agent"] as string;
        return writeEvents.some(
          (writeEv) =>
            (writeEv["key"] as string) === readKey &&
            (writeEv["agent"] as string) !== readAgent
        );
      });

      expect(crossAgentRead).toBe(true);
    });
  });

  describe("AC-9: structured JSONL log", () => {
    it("log file contains provider.start and provider.end events for all providers", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini")],
        ["codex", makeMockAdapter("codex")],
        ["ollama", makeMockAdapter("ollama")],
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

      const events = readLogEvents(logger);

      // Each event has timestamp_ms
      for (const ev of events) {
        expect(typeof ev["timestamp_ms"]).toBe("number");
      }

      // provider.start events for phase 1
      const startProviders = events
        .filter((e) => e["event"] === "provider.start" && !String(e["provider"] ?? "").includes("phase2"))
        .map((e) => e["provider"]);

      expect(startProviders).toContain("gemini");
      expect(startProviders).toContain("codex");
      expect(startProviders).toContain("ollama");
    });
  });

  describe("Failure isolation", () => {
    it("one failing adapter does not prevent others from producing output", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeMockAdapter("gemini")],
        ["codex", makeFailingAdapter("codex")],  // codex fails
        ["ollama", makeMockAdapter("ollama")],
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

      // gemini and ollama should have produced sections
      const successNames = result.sections.map((s) => s.provider);
      expect(successNames).toContain("gemini");
      expect(successNames).toContain("ollama");

      // codex should be in failedProviders
      expect(result.failedProviders).toContain("codex");
    });

    it("run completes with exit-0 semantics even when a provider fails", async () => {
      const providers = new Map<string, ProviderAdapter>([
        ["gemini", makeFailingAdapter("gemini")],
        ["codex", makeFailingAdapter("codex")],
        ["ollama", makeMockAdapter("ollama")],
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

      expect(result.sections.length).toBeGreaterThanOrEqual(1);
      expect(result.failedProviders).toContain("gemini");
      expect(result.failedProviders).toContain("codex");
    });
  });
});
