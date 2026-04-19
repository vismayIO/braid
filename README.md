# braid

A Bun + TypeScript CLI that dispatches a single natural-language task to three free-tier AI coding agents (Codex, Gemini, Ollama) in parallel, lets them share context through a shared memory layer, and merges their outputs into a single deliverable.

## What It Does

`braid` accepts one task description and fans it out to three providers concurrently:

- **Gemini** writes the **Overview** section (long-context strength)
- **Codex** writes the **Setup & Installation** section (code-centric)
- **Ollama** writes the **Usage Examples** section (local, private, free)

All three providers write to a shared memory store during phase 1. In phase 2, the best-available provider re-reads all notes and writes an executive summary — proving cross-agent memory sharing. The result is merged deterministically into `./README.md`.

## Install

```bash
git clone https://github.com/vismayIO/braid.git
cd braid
bun install
bun run build
bun link
```

After linking, `braid` is available as a global command.

## Provider Setup

### Ollama (recommended — fully local, always free)

```bash
# Install Ollama
brew install ollama

# Pull the default model
ollama pull llama3.2

# Start the Ollama server
ollama serve
```

### Codex CLI (optional)

```bash
npm install -g @openai/codex
codex login   # follow auth flow
```

### Gemini CLI (optional)

```bash
npm install -g @google/gemini-cli
gemini auth   # follow auth flow
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAID_ALLOW_PAID` | unset | Set to `1` to enable paid API fallback for Codex/Gemini when CLI is unavailable |
| `BRAID_OLLAMA_MODEL` | `llama3.2` | Ollama model to use |
| `OPENAI_API_KEY` | unset | Required for Codex API fallback (also needs `BRAID_ALLOW_PAID=1`) |
| `GEMINI_API_KEY` | unset | Required for Gemini API fallback (also needs `BRAID_ALLOW_PAID=1`) |
| `BRAID_SECTION_OVERRIDE` | unset | Route all sections to one provider, e.g. `all:ollama` |

**Important:** `BRAID_ALLOW_PAID=1` is a deliberate safety gate. Without it, `braid` never makes paid API calls. Ollama is always free and never gated.

## Usage

```bash
# Basic usage
braid "write a markdown README for a TypeScript project"

# Use a different Ollama model
BRAID_OLLAMA_MODEL=mistral braid "document a REST API"

# Enable paid fallback when CLI tools are not installed
BRAID_ALLOW_PAID=1 OPENAI_API_KEY=sk-... GEMINI_API_KEY=AI... braid "write setup guide"

# Route all sections to Ollama (useful for testing)
BRAID_SECTION_OVERRIDE=all:ollama braid "write a README"

# Help
braid --help
```

## Output

- `./README.md` — generated README (overwritten on each run)
- `.braid/run-<timestamp>.jsonl` — structured event log (one JSON line per event)

## Observability

Every run emits structured JSONL events to `.braid/run-<ISO>.jsonl`:

```jsonl
{"event":"provider.start","provider":"gemini","timestamp_ms":1713523200000}
{"event":"provider.end","provider":"gemini","duration_ms":1240,"via":"cli","timestamp_ms":1713523201240}
{"event":"memory.write","provider":"gemini","agent":"gemini","key":"phase1:gemini:draft","timestamp_ms":1713523201241}
{"event":"memory.read","provider":"gemini","agent":"gemini","key":"phase1:codex:note","timestamp_ms":1713523201350}
{"event":"merge.complete","timestamp_ms":1713523202100}
```

Verify parallelism:
```bash
cat .braid/*.jsonl | jq 'select(.event == "provider.start") | .timestamp_ms'
```

Verify cross-agent memory reads (AC-7):
```bash
cat .braid/*.jsonl | jq -s '
  map(select(.event == "memory.read" or .event == "memory.write")) |
  [.[] | select(.event == "memory.read")] as $reads |
  [.[] | select(.event == "memory.write")] as $writes |
  any($reads[]; .key as $k | .agent as $ra |
    any($writes[]; .key == $k and .agent != $ra)
  )
'
```

## Architecture

```
braid "<task>"
    │
    ├── Router (static): maps sections → providers
    │     overview→gemini, setup→codex, examples→ollama
    │
    ├── Orchestrator (two-phase):
    │     Phase 1: Promise.allSettled([gemini, codex, ollama])
    │               each writes draft + note to MemoryClient
    │     Phase 2: winner re-reads all notes → writes summary
    │
    ├── MemoryClient (InMemoryClient stub)
    │     interface: read / write / list
    │     v0.2: swap for MempalaceClient
    │
    └── Merger: summary → overview → setup → examples → README.md
```

## Memory Backend

The current backend is an in-process `InMemoryClient` (a `Map<string, MemEntry>`). This fully validates the shared-memory **protocol** (read/write/tag/list across providers); the claim is "provider-agnostic shared memory protocol" rather than "mempalace integration."

The [mempalace](https://github.com/mempalace/mempalace) project is Python-only (no JS/TS client). The `MempalaceClient` stub in `src/memory/mempalace-client.ts` marks the v0.2 integration point. See `.omc/drafts/mempalace-spike.md` for the spike decision.

## Running Tests

```bash
# All unit + integration tests
bun test

# Unit tests only
bun test src/

# Integration tests only
bun test tests/integration/

# E2E tests (requires running Ollama)
RUN_E2E=1 bun test tests/e2e/
```

## Provider Fallback Logic

```
For each provider:
  1. isAvailable() — lightweight hello probe (5s timeout)
     cli: runs a real invocation (e.g. `gemini -p "echo hi"`, `ollama list`)
          so an installed-but-unauthenticated binary fails the probe
     api: hits the endpoint with a minimal request
  2. If cli=true → use CLI
  3. If cli=false AND api=true AND BRAID_ALLOW_PAID=1 → use API
  4. If neither → log "provider unavailable: <reason>", skip, continue
```

Ollama's API fallback (`localhost:11434`) is **always allowed** — it's local and never paid.

## Gotchas

- **Auth:** `isAvailable()` runs a real hello-probe (e.g. `gemini -p "echo hi"`), so an installed-but-unauthenticated CLI is detected before dispatch. Still, run `codex login` / `gemini auth` at least once to cache credentials.
- **Ollama cold start:** The first prompt after `ollama serve` may take 10–30s to load the model. Subsequent runs are fast.
- **Parallelism:** All three providers start simultaneously. Wall-clock time ≈ max(individual times), not sum. Integration tests assert `wall_clock < sum × 0.8`.
- **Generated README:** `braid` overwrites `./README.md` in the current directory. Move any existing README before running.

## v0.2 Roadmap

- Swap `InMemoryClient` for real `MempalaceClient` once a JS MCP client wrapper exists
- Dynamic capability-based routing (LLM planner decomposes tasks)
- Provider health caching (avoid re-probing on every run)
- Free-tier budget tracker per provider
- Additional providers via the `ProviderAdapter` interface
- LLM-as-judge coherence scorer
