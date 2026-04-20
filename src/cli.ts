/**
 * CLI entrypoint — Step 8 of the plan.
 * Plain process.argv parsing — no external CLI lib.
 * braid --help  → prints usage, exits 0
 * braid "<task>" → runs orchestrator + merger + writes ./README.md
 */

import { Logger } from "./logging.ts";
import { InMemoryClient } from "./memory/in-memory-client.ts";
import type { SectionOutput } from "./merger/readme.ts";
import { writeReadme } from "./merger/readme.ts";
import { runOrchestrator } from "./orchestrator.ts";
import { CodexAdapter } from "./providers/codex.ts";
import { GeminiAdapter } from "./providers/gemini.ts";
import { OllamaAdapter } from "./providers/ollama.ts";
import type { ProviderName, SectionName } from "./router/static.ts";
import { buildAssignments, DEFAULT_SECTIONS } from "./router/static.ts";

const USAGE = `
braid — Multi-provider AI agent orchestrator

USAGE:
  braid "<task>"          Run all providers in parallel, merge output to ./README.md
  braid --help            Show this help message

ENV VARS:
  BRAID_ALLOW_PAID=1      Enable paid API fallback (Codex/Gemini) when CLI unavailable
  BRAID_OLLAMA_MODEL      Ollama model name (default: llama3.2)
  OPENAI_API_KEY          Required for Codex API fallback (+ BRAID_ALLOW_PAID=1)
  GEMINI_API_KEY          Required for Gemini API fallback (+ BRAID_ALLOW_PAID=1)

PROVIDERS:
  codex    CLI: codex exec --prompt <file>   API: OpenAI responses endpoint (paid gate)
  gemini   CLI: gemini -p <prompt>           API: Gemini REST (paid gate)
  ollama   CLI: ollama run <model>           API: http://localhost:11434 (always free)

OUTPUT:
  ./README.md             Generated README (overwritten on each run)
  .braid/run-<ts>.jsonl   Structured event log for this run

EXAMPLES:
  braid "write a markdown README for a TypeScript project"
  BRAID_OLLAMA_MODEL=mistral braid "document a REST API"
  BRAID_ALLOW_PAID=1 OPENAI_API_KEY=sk-... braid "write setup guide"
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const task = args.join(" ");

  const logger = new Logger();
  const memory = new InMemoryClient();

  const providers = new Map([
    ["codex", new CodexAdapter() as import("./providers/types.ts").ProviderAdapter],
    ["gemini", new GeminiAdapter() as import("./providers/types.ts").ProviderAdapter],
    ["ollama", new OllamaAdapter() as import("./providers/types.ts").ProviderAdapter],
  ]);

  // Support section override for testing (BRAID_SECTION_OVERRIDE=all:ollama)
  let sectionMap: Record<SectionName, ProviderName> = { ...DEFAULT_SECTIONS };
  if (process.env.BRAID_SECTION_OVERRIDE) {
    const override = process.env.BRAID_SECTION_OVERRIDE;
    if (override.startsWith("all:")) {
      const provider = override.slice(4) as ProviderName;
      sectionMap = { examples: provider, overview: provider, setup: provider };
    }
  }

  const assignments = buildAssignments(task, sectionMap);

  console.error(`[braid] Starting run: ${logger.id}`);
  console.error(`[braid] Task: ${task}`);
  console.error(`[braid] Providers: ${[...providers.keys()].join(", ")}`);

  const result = await runOrchestrator({
    assignments,
    logger,
    memory,
    providers,
    task,
  });

  // Assemble sections for merger: summary first, then phase-1 sections
  const allSections: SectionOutput[] = [];
  if (result.summary) {
    allSections.push(result.summary);
  }
  allSections.push(...result.sections);

  const mergeResult = await writeReadme("./README.md", allSections);

  logger.emit({
    duration_ms: 0,
    event: "merge.complete",
    included: mergeResult.included,
    skipped: mergeResult.skipped,
  });

  console.error("[braid] README.md written");
  console.error(`[braid] Included providers: ${mergeResult.included.join(", ")}`);

  if (result.skippedProviders.length > 0) {
    console.error(`[braid] Skipped providers: ${result.skippedProviders.join(", ")}`);
  }
  if (result.failedProviders.length > 0) {
    console.error(`[braid] Failed providers: ${result.failedProviders.join(", ")}`);
  }

  console.error(`[braid] Log: ${logger.logFile}`);

  // Exit 0 even if some providers failed (fail-soft — AC-8)
  process.exit(0);
}

main().catch((err) => {
  console.error("[braid] Fatal error:", err);
  process.exit(1);
});
