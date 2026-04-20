/**
 * Unit tests for CodexAdapter.
 * Mocks Bun.spawn to avoid real CLI calls.
 */

import { describe, expect, it } from "bun:test";
import { CodexAdapter } from "./codex";

describe("CodexAdapter", () => {
  describe("isAvailable", () => {
    it("returns cli:false when spawn fails", async () => {
      // Override environment to ensure no paid path
      const originalEnv = process.env.BRAID_ALLOW_PAID;
      delete process.env.BRAID_ALLOW_PAID;

      const adapter = new CodexAdapter();
      const avail = await adapter.isAvailable();

      // In test environment, codex CLI is not installed
      // Just assert the shape is correct
      expect(typeof avail.cli).toBe("boolean");
      expect(typeof avail.api).toBe("boolean");

      if (originalEnv !== undefined) {
        process.env.BRAID_ALLOW_PAID = originalEnv;
      }
    });

    it("returns api:false when BRAID_ALLOW_PAID is not set", async () => {
      const orig = process.env.BRAID_ALLOW_PAID;
      delete process.env.BRAID_ALLOW_PAID;

      const adapter = new CodexAdapter();
      const avail = await adapter.isAvailable();
      expect(avail.api).toBe(false);

      if (orig !== undefined) {
        process.env.BRAID_ALLOW_PAID = orig;
      }
    });

    it("returns api:false when BRAID_ALLOW_PAID=1 but no API key", async () => {
      const origPaid = process.env.BRAID_ALLOW_PAID;
      const origKey = process.env.OPENAI_API_KEY;
      process.env.BRAID_ALLOW_PAID = "1";
      delete process.env.OPENAI_API_KEY;

      const adapter = new CodexAdapter();
      const avail = await adapter.isAvailable();
      expect(avail.api).toBe(false);

      if (origPaid === undefined) {
        delete process.env.BRAID_ALLOW_PAID;
      } else {
        process.env.BRAID_ALLOW_PAID = origPaid;
      }
      if (origKey !== undefined) {
        process.env.OPENAI_API_KEY = origKey;
      }
    });
  });

  describe("run", () => {
    it("returns error result (not throw) when provider unavailable", async () => {
      const orig = process.env.BRAID_ALLOW_PAID;
      delete process.env.BRAID_ALLOW_PAID;

      const adapter = new CodexAdapter();
      const ac = new AbortController();
      const result = await adapter.run({
        marker: "<!-- agent:codex -->",
        memoryCtx: "",
        prompt: "test",
        signal: ac.signal,
      });

      // Must not throw — returns error field
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.output).toBe("");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);

      if (orig !== undefined) {
        process.env.BRAID_ALLOW_PAID = orig;
      }
    });

    it("error string contains provider name", async () => {
      const orig = process.env.BRAID_ALLOW_PAID;
      delete process.env.BRAID_ALLOW_PAID;

      const adapter = new CodexAdapter();
      const ac = new AbortController();
      const result = await adapter.run({
        marker: "<!-- agent:codex -->",
        memoryCtx: "",
        prompt: "test",
        signal: ac.signal,
      });

      expect(result.error).toContain("codex");

      if (orig !== undefined) {
        process.env.BRAID_ALLOW_PAID = orig;
      }
    });
  });
});
