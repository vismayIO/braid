/**
 * Orchestrator — Step 6 of the plan.
 * Two-phase parallel dispatch with shared memory context.
 *
 * Phase 1: All three providers run concurrently via Promise.allSettled.
 *          Each writes its section draft + a "what I learned" note to memory.
 * Phase 2: First successful phase-1 provider (preferring Gemini → Codex → Ollama)
 *          re-reads all three notes and writes the top-of-file summary.
 *          This proves cross-agent memory read (AC-7).
 */

import type { Logger } from "./logging";
import type { MemoryClient } from "./memory/types";
import type { SectionOutput } from "./merger/readme";
import type { ProviderAdapter, RunResult } from "./providers/types";
import type { SectionAssignment } from "./router/static";

export type OrchestratorOpts = {
  task: string;
  assignments: SectionAssignment[];
  /** Provider instances keyed by name. */
  providers: Map<string, ProviderAdapter>;
  memory: MemoryClient;
  logger: Logger;
  /** Timeout per adapter in ms (default 60_000). */
  timeoutMs?: number;
};

export type OrchestratorResult = {
  sections: SectionOutput[];
  /** Phase-2 summary section, if produced. */
  summary: SectionOutput | null;
  /** Names of providers that were skipped (unavailable). */
  skippedProviders: string[];
  /** Names of providers that failed during phase 1. */
  failedProviders: string[];
};

const PHASE2_PREFERENCE: string[] = ["gemini", "codex", "ollama"];

export async function runOrchestrator(opts: OrchestratorOpts): Promise<OrchestratorResult> {
  const { task, assignments, providers, memory, logger, timeoutMs = 60_000 } = opts;

  const wallStart = Date.now();
  const sessionId = `session-${wallStart}`;
  const skippedProviders: string[] = [];
  const failedProviders: string[] = [];

  // ── Availability check ────────────────────────────────────────────────────
  const availMap = new Map<string, { cli: boolean; api: boolean }>();
  await Promise.all(
    Array.from(providers.entries()).map(async ([name, adapter]) => {
      const avail = await adapter.isAvailable();
      availMap.set(name, avail);
      if (!(avail.cli || avail.api)) {
        const msg = `provider unavailable: ${name} (cli=${avail.cli}, api=${avail.api})`;
        console.error(msg);
        skippedProviders.push(name);
        logger.emit({
          duration_ms: 0,
          error: msg,
          event: "provider.end",
          provider: name,
        });
      }
    }),
  );

  // ── Phase 1: Parallel dispatch ────────────────────────────────────────────
  const phase1Results = await Promise.allSettled(
    assignments.map(async (assignment) => {
      const { section, provider: providerName, marker, prompt } = assignment;
      const adapter = providers.get(providerName);

      if (!adapter || skippedProviders.includes(providerName)) {
        return null;
      }

      // Read existing memory context (from providers that may have written before)
      const allEntries = await memory.list();
      const memoryCtx = allEntries
        .filter((e) => e.agent !== providerName)
        .map((e) => `[${e.agent}] ${e.key}: ${e.value}`)
        .join("\n");

      if (memoryCtx) {
        logger.emit({
          agent: providerName,
          event: "memory.read",
          key: `session:${sessionId}:context`,
          provider: providerName,
        });
      }

      // Create abort controller for this adapter run
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);

      logger.emit({ event: "provider.start", provider: providerName });
      const startMs = Date.now();

      let result: RunResult;
      try {
        result = await adapter.run({
          marker,
          memoryCtx,
          prompt: `${prompt}\n\nTask: ${task}`,
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      logger.emit({
        duration_ms: result.duration_ms,
        error: result.error,
        event: "provider.end",
        provider: providerName,
        via: result.via,
      });

      if (result.error) {
        failedProviders.push(providerName);
        return null;
      }

      // AC-6: exactly one memory.write per provider in phase 1.
      // Single record packs both the draft excerpt and the "what I learned" note.
      const draftKey = `phase1:${providerName}:draft`;
      const note = `Wrote ${section} section for task: "${task}". Output length: ${result.output.length} chars.`;
      const payload = `note: ${note}\n---\ndraft: ${result.output.slice(0, 500)}`;
      await memory.write(draftKey, payload, providerName);
      logger.emit({
        agent: providerName,
        event: "memory.write",
        key: draftKey,
        provider: providerName,
      });

      const sectionOutput: SectionOutput = {
        content: result.output,
        provider: providerName,
        section: section as SectionOutput["section"],
      };

      return { providerName, sectionOutput, startMs };
    }),
  );

  // Collect successful phase-1 results
  const phase1Successes: Array<{
    sectionOutput: SectionOutput;
    providerName: string;
  }> = [];
  for (const settled of phase1Results) {
    if (settled.status === "fulfilled" && settled.value !== null) {
      phase1Successes.push(settled.value);
    } else if (settled.status === "rejected") {
      // Adapter threw (should not happen per contract, but handle defensively)
      console.error("Phase 1 provider threw unexpectedly:", settled.reason);
    }
  }

  // ── Phase 2: Summary by first successful provider ─────────────────────────
  let summary: SectionOutput | null = null;

  // Find the phase-2 provider in preference order
  const phase2ProviderName = PHASE2_PREFERENCE.find((name) =>
    phase1Successes.some((s) => s.providerName === name),
  );

  if (phase2ProviderName) {
    const phase2Adapter = providers.get(phase2ProviderName);
    if (phase2Adapter) {
      // Read ALL phase-1 notes (cross-agent reads — proves AC-7)
      const allNotes = await memory.list();
      const crossAgentNotes = allNotes
        .filter((e) => e.agent !== phase2ProviderName && e.key.startsWith("phase1:"))
        .map((e) => `[${e.agent}] ${e.value}`)
        .join("\n");

      // Log cross-agent memory reads for AC-7 verification
      for (const entry of allNotes) {
        if (entry.agent !== phase2ProviderName && entry.key.startsWith("phase1:")) {
          logger.emit({
            agent: phase2ProviderName,
            event: "memory.read",
            key: entry.key,
            provider: phase2ProviderName,
          });
        }
      }

      const summaryMarker = `<!-- agent:${phase2ProviderName} -->`;
      const summaryPrompt =
        "You are writing the executive summary for a README. " +
        `Other agents have written sections about this task: "${task}". ` +
        `Here are their notes:\n\n${crossAgentNotes}\n\n` +
        "Write a 2-3 sentence summary that ties all sections together. " +
        "Do NOT repeat the full content — just summarize the whole document.";

      const ac2 = new AbortController();
      const timer2 = setTimeout(() => ac2.abort(), timeoutMs);

      logger.emit({
        event: "provider.start",
        provider: `${phase2ProviderName}:phase2`,
      });

      try {
        const summaryResult = await phase2Adapter.run({
          marker: summaryMarker,
          memoryCtx: crossAgentNotes,
          prompt: summaryPrompt,
          signal: ac2.signal,
        });

        logger.emit({
          duration_ms: summaryResult.duration_ms,
          error: summaryResult.error,
          event: "provider.end",
          provider: `${phase2ProviderName}:phase2`,
          via: summaryResult.via,
        });

        if (!summaryResult.error) {
          summary = {
            content: summaryResult.output,
            provider: phase2ProviderName,
            section: "summary",
          };
        }
      } finally {
        clearTimeout(timer2);
      }
    }
  }

  logger.emit({ duration_ms: Date.now() - wallStart, event: "run.complete" });

  return {
    failedProviders,
    sections: phase1Successes.map((s) => s.sectionOutput),
    skippedProviders,
    summary,
  };
}
