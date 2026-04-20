/**
 * Unit tests for the README merger.
 */

import { describe, expect, it } from "bun:test";
import { mergeSections, SECTION_ORDER } from "./readme";
import type { SectionOutput } from "./readme.ts";

describe("SECTION_ORDER", () => {
  it("starts with summary", () => {
    expect(SECTION_ORDER[0]).toBe("summary");
  });

  it("has exactly 4 sections", () => {
    expect(SECTION_ORDER.length).toBe(4);
  });

  it("contains all required sections", () => {
    expect(SECTION_ORDER).toContain("summary");
    expect(SECTION_ORDER).toContain("overview");
    expect(SECTION_ORDER).toContain("setup");
    expect(SECTION_ORDER).toContain("examples");
  });
});

describe("mergeSections", () => {
  const makeSections = (): SectionOutput[] => [
    {
      content: "This is a summary. <!-- agent:gemini -->",
      provider: "gemini",
      section: "summary",
    },
    {
      content: "This is an overview. <!-- agent:gemini -->",
      provider: "gemini",
      section: "overview",
    },
    {
      content: "Install steps. <!-- agent:codex -->",
      provider: "codex",
      section: "setup",
    },
    {
      content: "Usage examples. <!-- agent:ollama -->",
      provider: "ollama",
      section: "examples",
    },
  ];

  it("contains all three agent markers", () => {
    const result = mergeSections(makeSections());
    expect(result.content).toContain("<!-- agent:gemini -->");
    expect(result.content).toContain("<!-- agent:codex -->");
    expect(result.content).toContain("<!-- agent:ollama -->");
  });

  it("section order is deterministic: summary before overview before setup before examples", () => {
    const result = mergeSections(makeSections());
    const summaryIdx = result.content.indexOf("## Summary");
    const overviewIdx = result.content.indexOf("## Overview");
    const setupIdx = result.content.indexOf("## Setup");
    const examplesIdx = result.content.indexOf("## Usage Examples");
    expect(summaryIdx).toBeLessThan(overviewIdx);
    expect(overviewIdx).toBeLessThan(setupIdx);
    expect(setupIdx).toBeLessThan(examplesIdx);
  });

  it("injects section markers as HTML comments", () => {
    const result = mergeSections(makeSections());
    expect(result.content).toContain("<!-- section:summary");
    expect(result.content).toContain("<!-- section:overview");
    expect(result.content).toContain("<!-- section:setup");
    expect(result.content).toContain("<!-- section:examples");
  });

  it("skips missing sections gracefully", () => {
    const partial: SectionOutput[] = [
      {
        content: "Overview. <!-- agent:gemini -->",
        provider: "gemini",
        section: "overview",
      },
    ];
    const result = mergeSections(partial);
    expect(result.content).toContain("Overview");
    expect(result.content).not.toContain("## Summary");
    expect(result.included).toContain("gemini");
  });

  it("included contains all providers that had content", () => {
    const result = mergeSections(makeSections());
    expect(result.included).toContain("gemini");
    expect(result.included).toContain("codex");
    expect(result.included).toContain("ollama");
  });

  it("handles empty content sections by skipping them", () => {
    const sections: SectionOutput[] = [
      { content: "", provider: "gemini", section: "overview" },
      { content: "Install steps.", provider: "codex", section: "setup" },
    ];
    const result = mergeSections(sections);
    expect(result.content).not.toContain("## Overview");
    expect(result.content).toContain("## Setup");
    expect(result.skipped).toContain("gemini");
  });

  it("produces consistent output for the same input", () => {
    const r1 = mergeSections(makeSections());
    const r2 = mergeSections(makeSections());
    expect(r1.content).toBe(r2.content);
  });
});
