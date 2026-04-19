/**
 * Unit tests for GeminiAdapter.
 */

import { describe, it, expect } from "bun:test";
import { GeminiAdapter } from "./gemini.ts";

describe("GeminiAdapter", () => {
  describe("isAvailable", () => {
    it("returns api:false when BRAID_ALLOW_PAID is not set", async () => {
      const orig = process.env["BRAID_ALLOW_PAID"];
      delete process.env["BRAID_ALLOW_PAID"];

      const adapter = new GeminiAdapter();
      const avail = await adapter.isAvailable();
      expect(avail.api).toBe(false);

      if (orig !== undefined) process.env["BRAID_ALLOW_PAID"] = orig;
    });

    it("returns api:false when BRAID_ALLOW_PAID=1 but no API key", async () => {
      const origPaid = process.env["BRAID_ALLOW_PAID"];
      const origKey = process.env["GEMINI_API_KEY"];
      process.env["BRAID_ALLOW_PAID"] = "1";
      delete process.env["GEMINI_API_KEY"];

      const adapter = new GeminiAdapter();
      const avail = await adapter.isAvailable();
      expect(avail.api).toBe(false);

      if (origPaid !== undefined) process.env["BRAID_ALLOW_PAID"] = origPaid;
      else delete process.env["BRAID_ALLOW_PAID"];
      if (origKey !== undefined) process.env["GEMINI_API_KEY"] = origKey;
    });

    it("returns boolean shape", async () => {
      const adapter = new GeminiAdapter();
      const avail = await adapter.isAvailable();
      expect(typeof avail.cli).toBe("boolean");
      expect(typeof avail.api).toBe("boolean");
    });
  });

  describe("run", () => {
    it("returns error result without throwing when unavailable", async () => {
      const orig = process.env["BRAID_ALLOW_PAID"];
      delete process.env["BRAID_ALLOW_PAID"];

      const adapter = new GeminiAdapter();
      const ac = new AbortController();

      // Must not throw
      const result = await adapter.run({
        prompt: "test",
        marker: "<!-- agent:gemini -->",
        memoryCtx: "",
        signal: ac.signal,
      });

      expect(result.error).toBeDefined();
      expect(result.output).toBe("");
      expect(result.error).toContain("gemini");

      if (orig !== undefined) process.env["BRAID_ALLOW_PAID"] = orig;
    });
  });
});
