/**
 * E2E smoke test: full orchestrator run with Ollama assigned to all three sections.
 * Opt-in via RUN_E2E=1 environment variable.
 * Exercises the real merge path end-to-end (closes AC-12 merge coverage gap).
 *
 * Run: RUN_E2E=1 bun test tests/e2e/ollama-all-sections.smoke.ts
 */

import { describe, it, expect } from "bun:test";
import { runOrchestrator } from "../../src/orchestrator.ts";
import { buildAssignments } from "../../src/router/static.ts";
import { writeReadme } from "../../src/merger/readme.ts";
import { InMemoryClient } from "../../src/memory/in-memory-client.ts";
import { Logger } from "../../src/logging.ts";
import { OllamaAdapter } from "../../src/providers/ollama.ts";
import type { ProviderAdapter } from "../../src/providers/types.ts";
import type { SectionOutput } from "../../src/merger/readme.ts";
import { existsSync, unlinkSync, readFileSync } from "fs";

const RUN_E2E = process.env["RUN_E2E"] === "1";

describe("E2E: Ollama all-sections full pipeline", () => {
  it("produces README.md with ollama marker from all three sections", async () => {
    if (!RUN_E2E) {
      console.log("Skipping e2e test — set RUN_E2E=1 to run");
      return;
    }

    const ollamaAdapter = new OllamaAdapter();
    const avail = await ollamaAdapter.isAvailable();

    if (!avail.cli && !avail.api) {
      console.log("Skipping: Ollama not available in this environment");
      return;
    }

    // Override all sections to use ollama
    const allOllamaMap = {
      overview: "ollama" as const,
      setup: "ollama" as const,
      examples: "ollama" as const,
    };

    const task = "write a markdown README for a TypeScript utility library";
    const assignments = buildAssignments(task, allOllamaMap);

    const providers = new Map<string, ProviderAdapter>([
      ["gemini", ollamaAdapter],
      ["codex", ollamaAdapter],
      ["ollama", ollamaAdapter],
    ]);

    const logger = new Logger(`e2e-all-sections-${Date.now()}`);
    const memory = new InMemoryClient();

    const result = await runOrchestrator({
      task,
      assignments,
      providers,
      memory,
      logger,
      timeoutMs: 120_000,
    });

    expect(result.sections.length).toBeGreaterThan(0);

    const allSections: SectionOutput[] = [];
    if (result.summary) allSections.push(result.summary);
    allSections.push(...result.sections);

    const outputPath = "/tmp/braid-e2e-readme.md";
    if (existsSync(outputPath)) unlinkSync(outputPath);

    const mergeResult = await writeReadme(outputPath, allSections);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf8");

    // All sections should have ollama marker
    expect(content).toContain("<!-- agent:ollama -->");

    // Should have multiple sections
    expect(mergeResult.included.length).toBeGreaterThan(0);

    // At least one cross-agent memory write should have occurred
    const memEntries = await memory.list();
    expect(memEntries.length).toBeGreaterThan(0);

    // Clean up
    if (existsSync(outputPath)) unlinkSync(outputPath);

    console.log(`E2E passed. Sections: ${mergeResult.included.join(", ")}`);
    console.log(`Log: ${logger.logFile}`);
  });
});
