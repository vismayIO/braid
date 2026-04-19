/**
 * Merger — Step 7 of the plan.
 * Deterministic section order: summary, overview, setup, examples.
 * Each section is wrapped with HTML comment markers for testability.
 */

export type SectionOutput = {
  section: "summary" | "overview" | "setup" | "examples";
  content: string;
  /** Provider that generated this content. */
  provider: string;
};

/** Canonical section order — must not change without updating tests. */
export const SECTION_ORDER: SectionOutput["section"][] = [
  "summary",
  "overview",
  "setup",
  "examples",
];

export type MergeResult = {
  /** Final merged README markdown string. */
  content: string;
  /** Which sections were included (providers that succeeded). */
  included: string[];
  /** Which providers were skipped (failed or no output). */
  skipped: string[];
};

/**
 * Merge section outputs into a single README string.
 * Sections absent from `sections` are omitted from output (fail-soft).
 */
export function mergeSections(sections: SectionOutput[]): MergeResult {
  const bySection = new Map<string, SectionOutput>();
  for (const s of sections) {
    bySection.set(s.section, s);
  }

  const included: string[] = [];
  const skipped: string[] = [];
  const parts: string[] = ["# README\n"];

  for (const name of SECTION_ORDER) {
    const s = bySection.get(name);
    if (!s || !s.content.trim()) {
      if (s) skipped.push(s.provider);
      continue;
    }

    included.push(s.provider);

    // Section heading map
    const headings: Record<string, string> = {
      summary: "## Summary",
      overview: "## Overview",
      setup: "## Setup & Installation",
      examples: "## Usage Examples",
    };

    const heading = headings[name] ?? `## ${name}`;
    parts.push(`<!-- section:${name} provider:${s.provider} -->`);
    parts.push(heading);
    parts.push("");
    parts.push(s.content.trim());
    parts.push("");
  }

  return {
    content: parts.join("\n"),
    included,
    skipped,
  };
}

/**
 * Write merged README to a file path.
 * Returns the content written.
 */
export async function writeReadme(
  filePath: string,
  sections: SectionOutput[]
): Promise<MergeResult> {
  const result = mergeSections(sections);
  await Bun.write(filePath, result.content);
  return result;
}
