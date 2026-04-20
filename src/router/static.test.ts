/**
 * Unit tests for the static router.
 */

import { describe, expect, it } from "bun:test";
import { buildAssignments, buildSectionPrompt, DEFAULT_SECTIONS } from "./static";

describe("DEFAULT_SECTIONS", () => {
  it("maps overview to gemini", () => {
    expect(DEFAULT_SECTIONS.overview).toBe("gemini");
  });

  it("maps setup to codex", () => {
    expect(DEFAULT_SECTIONS.setup).toBe("codex");
  });

  it("maps examples to ollama", () => {
    expect(DEFAULT_SECTIONS.examples).toBe("ollama");
  });
});

describe("buildAssignments", () => {
  it("returns exactly 3 assignments", () => {
    const assignments = buildAssignments("test task");
    expect(assignments.length).toBe(3);
  });

  it("each assignment has the correct marker format", () => {
    const assignments = buildAssignments("test task");
    for (const a of assignments) {
      expect(a.marker).toBe(`<!-- agent:${a.provider} -->`);
    }
  });

  it("uses default sections when no override provided", () => {
    const assignments = buildAssignments("test task");
    const overviewAssignment = assignments.find((a) => a.section === "overview");
    expect(overviewAssignment?.provider).toBe("gemini");
  });

  it("respects section map override", () => {
    const allOllama = {
      examples: "ollama" as const,
      overview: "ollama" as const,
      setup: "ollama" as const,
    };
    const assignments = buildAssignments("test task", allOllama);
    for (const a of assignments) {
      expect(a.provider).toBe("ollama");
      expect(a.marker).toBe("<!-- agent:ollama -->");
    }
  });

  it("each assignment has a non-empty prompt", () => {
    const assignments = buildAssignments("write a README");
    for (const a of assignments) {
      expect(a.prompt.length).toBeGreaterThan(0);
      expect(a.prompt).toContain("write a README");
    }
  });

  it("sections are overview, setup, examples", () => {
    const assignments = buildAssignments("test");
    const sections = assignments.map((a) => a.section);
    expect(sections).toContain("overview");
    expect(sections).toContain("setup");
    expect(sections).toContain("examples");
  });
});

describe("buildSectionPrompt", () => {
  it("overview prompt mentions the task", () => {
    const p = buildSectionPrompt("overview", "my task");
    expect(p).toContain("my task");
    expect(p.toLowerCase()).toContain("overview");
  });

  it("setup prompt mentions installation", () => {
    const p = buildSectionPrompt("setup", "my task");
    expect(p.toLowerCase()).toContain("install");
  });

  it("examples prompt mentions examples or usage", () => {
    const p = buildSectionPrompt("examples", "my task");
    expect(p.toLowerCase()).toMatch(/example|usage/);
  });
});
