/**
 * Unit tests for InMemoryClient.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryClient } from "./in-memory-client.ts";

describe("InMemoryClient", () => {
  let client: InMemoryClient;

  beforeEach(() => {
    client = new InMemoryClient();
  });

  describe("read", () => {
    it("returns null for missing key", async () => {
      const entry = await client.read("missing");
      expect(entry).toBeNull();
    });

    it("returns written entry", async () => {
      await client.write("k1", "hello", "agent1");
      const entry = await client.read("k1");
      expect(entry).not.toBeNull();
      expect(entry!.value).toBe("hello");
      expect(entry!.agent).toBe("agent1");
      expect(entry!.key).toBe("k1");
    });

    it("entry has a timestamp", async () => {
      const before = Date.now();
      await client.write("k2", "v", "a");
      const entry = await client.read("k2");
      const after = Date.now();
      expect(entry!.ts).toBeGreaterThanOrEqual(before);
      expect(entry!.ts).toBeLessThanOrEqual(after);
    });
  });

  describe("write", () => {
    it("overwrites existing key", async () => {
      await client.write("k", "v1", "a1");
      await client.write("k", "v2", "a2");
      const entry = await client.read("k");
      expect(entry!.value).toBe("v2");
      expect(entry!.agent).toBe("a2");
    });
  });

  describe("list", () => {
    it("returns empty array when no entries", async () => {
      const entries = await client.list();
      expect(entries).toEqual([]);
    });

    it("returns all written entries", async () => {
      await client.write("k1", "v1", "agent1");
      await client.write("k2", "v2", "agent2");
      const entries = await client.list();
      expect(entries.length).toBe(2);
    });

    it("entries have correct shape", async () => {
      await client.write("mykey", "myval", "myagent");
      const entries = await client.list();
      expect(entries[0]!.key).toBe("mykey");
      expect(entries[0]!.value).toBe("myval");
      expect(entries[0]!.agent).toBe("myagent");
      expect(typeof entries[0]!.ts).toBe("number");
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      await client.write("k1", "v1", "a1");
      await client.write("k2", "v2", "a2");
      client.clear();
      const entries = await client.list();
      expect(entries).toEqual([]);
    });
  });

  describe("multi-agent scenario", () => {
    it("tracks entries from different agents", async () => {
      await client.write("codex:draft", "code section", "codex");
      await client.write("gemini:draft", "overview section", "gemini");
      await client.write("ollama:draft", "examples section", "ollama");

      const all = await client.list();
      expect(all.length).toBe(3);

      const agents = all.map((e) => e.agent);
      expect(agents).toContain("codex");
      expect(agents).toContain("gemini");
      expect(agents).toContain("ollama");
    });

    it("cross-agent read: can read entry written by another agent", async () => {
      await client.write("gemini:note", "I wrote the overview", "gemini");
      // codex reads gemini's entry
      const entry = await client.read("gemini:note");
      expect(entry).not.toBeNull();
      expect(entry!.agent).toBe("gemini");
    });
  });
});
