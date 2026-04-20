/**
 * E2E smoke test: single-section Ollama run.
 * Opt-in via RUN_E2E=1 environment variable.
 * Requires a running Ollama instance with the configured model pulled.
 *
 * Run: RUN_E2E=1 bun test tests/e2e/ollama.smoke.ts
 */

import { describe, expect, it } from "bun:test";
import { OllamaAdapter } from "../../src/providers/ollama.ts";

const RUN_E2E = process.env.RUN_E2E === "1";

describe("E2E: Ollama single-section smoke", () => {
  it("ollama is available or test is skipped", async () => {
    if (!RUN_E2E) {
      console.log("Skipping e2e test — set RUN_E2E=1 to run");
      return;
    }

    const adapter = new OllamaAdapter();
    const avail = await adapter.isAvailable();

    if (!(avail.cli || avail.api)) {
      console.log("Skipping: Ollama not available in this environment");
      return;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);

    try {
      const result = await adapter.run({
        marker: "<!-- agent:ollama -->",
        memoryCtx: "",
        prompt: "Write a single paragraph describing what TypeScript is. Keep it under 100 words.",
        signal: ac.signal,
      });

      clearTimeout(timer);

      expect(result.error).toBeUndefined();
      expect(result.output.length).toBeGreaterThan(10);
      expect(result.output).toContain("<!-- agent:ollama -->");
      expect(result.duration_ms).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
    }
  });
});
