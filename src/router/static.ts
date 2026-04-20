/**
 * Static router — Step 5 of the plan.
 * Maps section names to provider names based on capability strengths.
 * v0.2 follow-up: swap for a dynamic LLM-planner router without changing this interface.
 */

export type SectionName = "overview" | "setup" | "examples";
export type ProviderName = "gemini" | "codex" | "ollama";

export type SectionAssignment = {
  section: SectionName;
  provider: ProviderName;
  /** Marker string the provider must embed in its output. */
  marker: string;
  /** Prompt fragment specific to this section. */
  prompt: string;
};

/**
 * Default section → provider mapping.
 * gemini: long-context strength → overview
 * codex: code-centric → setup
 * ollama: local/private → examples
 */
export const DEFAULT_SECTIONS: Record<SectionName, ProviderName> = {
  examples: "ollama",
  overview: "gemini",
  setup: "codex",
};

export function buildSectionPrompt(section: SectionName, task: string): string {
  switch (section) {
    case "overview":
      return (
        `You are writing the "Overview" section of a README for the following task:\n${task}\n\n` +
        "Write 2-4 paragraphs that describe what the project does, why it exists, and who it is for. " +
        "Be clear, concise, and engaging. Do NOT include installation instructions or code examples."
      );
    case "setup":
      return (
        `You are writing the "Setup & Installation" section of a README for the following task:\n${task}\n\n` +
        "Write step-by-step installation and configuration instructions. " +
        "Include prerequisite requirements, install commands, and environment variable setup. " +
        "Use markdown code blocks for commands."
      );
    case "examples":
      return (
        `You are writing the "Usage Examples" section of a README for the following task:\n${task}\n\n` +
        "Write 2-3 concrete usage examples with real commands and expected output. " +
        "Use markdown code blocks. Show common use cases and edge cases."
      );
  }
}

/**
 * Build the full list of section assignments for a given task.
 * Accepts an optional override map for testing (e.g. route all to ollama).
 */
export function buildAssignments(
  task: string,
  sectionMap: Record<SectionName, ProviderName> = DEFAULT_SECTIONS,
): SectionAssignment[] {
  const sections: SectionName[] = ["overview", "setup", "examples"];
  return sections.map((section) => ({
    marker: `<!-- agent:${sectionMap[section]} -->`,
    prompt: buildSectionPrompt(section, task),
    provider: sectionMap[section],
    section,
  }));
}
