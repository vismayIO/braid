/**
 * Unit tests for OllamaAdapter.
 */

import { describe, expect, it } from "bun:test";
import { OllamaAdapter } from "./ollama";

describe("OllamaAdapter", () => {
  describe("isAvailable", () => {
    it("returns boolean shape", async () => {
      const adapter = new OllamaAdapter();
      const avail = await adapter.isAvailable();
      expect(typeof avail.cli).toBe("boolean");
      expect(typeof avail.api).toBe("boolean");
    });

    it("uses BRAID_OLLAMA_MODEL env override", () => {
      const orig = process.env.BRAID_OLLAMA_MODEL;
      process.env.BRAID_OLLAMA_MODEL = "mistral";
      // Construct adapter — model set at construction time
      const adapter = new OllamaAdapter();
      // Access private field via type assertion for testing
      const adapterAny = adapter as unknown as { model: string };
      expect(adapterAny.model).toBe("mistral");
      if (orig === undefined) {
        delete process.env.BRAID_OLLAMA_MODEL;
      } else {
        process.env.BRAID_OLLAMA_MODEL = orig;
      }
    });

    it("defaults to llama3.2 when BRAID_OLLAMA_MODEL not set", () => {
      const orig = process.env.BRAID_OLLAMA_MODEL;
      delete process.env.BRAID_OLLAMA_MODEL;
      const adapter = new OllamaAdapter();
      const adapterAny = adapter as unknown as { model: string };
      expect(adapterAny.model).toBe("llama3.2");
      if (orig !== undefined) {
        process.env.BRAID_OLLAMA_MODEL = orig;
      }
    });
  });

  describe("run", () => {
    it("returns error result without throwing when unavailable", async () => {
      // In CI/test env, Ollama is not running
      const adapter = new OllamaAdapter();
      const ac = new AbortController();

      const avail = await adapter.isAvailable();
      if (avail.cli || avail.api) {
        // Ollama is actually available — skip this test
        return;
      }

      const result = await adapter.run({
        marker: "<!-- agent:ollama -->",
        memoryCtx: "",
        prompt: "test",
        signal: ac.signal,
      });

      expect(result.error).toBeDefined();
      expect(result.output).toBe("");
      expect(result.error).toContain("ollama");
    });
  });
});
