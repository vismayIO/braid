# Implementation Plan: `braid` POC v0.1 (APPROVED)

> **Status:** Consensus reached in 2 iterations. Architect: APPROVE (v2). Critic: APPROVE (v2). 2026-04-19.
>
> **Source spec:** `.omc/specs/deep-interview-braid.md` (deep-interview ambiguity 11%).
>
> Deliberate mode enabled (subprocess orchestration, external CLI dependencies, parallel I/O).
>
> **v1 → v2 changelog:** Applied all 8 must-fix items from Architect + Critic (Step 0 renumbered; Step 6 phase-2 provider fallback chain; Step 4 `MemoryClient` interface with two backends; R1 mitigation clarified; §3 Option A justification strengthened; AC-3 timing assertion concretized; AC-6 tightened; AC-7 + AC-8 explicit verification steps in §8; `BRAID_ALLOW_PAID` gate in Step 3; second e2e test for merge coverage; manual gate flagged separately; hello-probe quota caveat noted).

## 1. Requirements Summary

`braid` is a Bun + TypeScript CLI that accepts a single natural-language task, fans it out to three free-tier AI coding agents (Codex, Gemini, Ollama) in parallel, lets them share context through a mempalace-backed memory layer, and merges their outputs into a single deliverable.

**POC v0.1 acceptance command:**
```
braid "write a markdown README for a TypeScript project"
```
Must produce a `README.md` containing verifiable markers from all three agents, with wall-clock time < sum of individual agent times (proof of parallelism).

## 2. Acceptance Criteria (testable)

- [ ] AC-1: `bun install && bun link` makes `braid` callable as a command
- [ ] AC-2: `braid --help` prints usage, exits 0
- [ ] AC-3: `braid "<task>"` invocation dispatches to all three providers concurrently. **Integration test** uses mock adapters with an artificial per-adapter delay (`await setTimeout(100ms)`) and asserts (a) the three `provider.start` timestamps are within 50ms of each other AND (b) total orchestrator wall-clock < sum of individual durations × 0.8. Pure arithmetic on instant-return mocks is explicitly not acceptable.
- [ ] AC-4: Each agent is instructed (via prompt scaffolding) to include a provider-specific marker string in its output — e.g. `<!-- agent:codex -->`, `<!-- agent:gemini -->`, `<!-- agent:ollama -->`
- [ ] AC-5: Final `README.md` in CWD contains all three marker strings
- [ ] AC-6: Each agent performs **exactly one** memory write in phase 1 (verified by reading the memory store after the run; tighter than spec's "at least one" to catch silent skips)
- [ ] AC-7: At least one agent reads a memory entry written by another agent (proves the shared-memory flow, not just concurrent writes). Verified by JSONL log: a `memory.read` event whose `key` matches a `memory.write` event whose `agent` differs.
- [ ] AC-8: When a provider CLI (e.g. `codex`) is missing, `braid` falls back to HTTP API if the matching API key env var is set; otherwise it prints a clear "provider unavailable: <reason>" message and continues with remaining providers (does not crash)
- [ ] AC-9: Structured JSONL log written to `.braid/run-<timestamp>.jsonl` with one event per provider start/stop, including duration_ms and exit_code
- [ ] AC-10: Unit tests for router, merger, and provider adapters pass (`bun test`)
- [ ] AC-11: Integration test passes end-to-end using mocked provider adapters (no real LLM calls)
- [ ] AC-12: At least one e2e smoke test runs against `ollama` locally (Ollama is the only provider we can run hermetically without external network)

## 3. RALPLAN-DR Summary

### Principles
1. **Free-tier first** — every design decision must be evaluated against "does this keep the user on free-tier usage?"
2. **Fail-soft, log-loud** — any single provider failure must not crash the run; the run logs the failure and continues with remaining providers.
3. **Deterministic merging** — merge order and marker injection must be reproducible so acceptance tests are stable.
4. **Pluggable provider protocol** — adding a fourth provider should require implementing one interface, not touching the router or CLI.
5. **Observability before optimization** — every child process run emits structured events; no perf tuning before we can see what's happening.

### Decision Drivers (top 3)
1. **POC-scope credibility** — the v0.1 must be demonstrable in a single terminal session within a weekend.
2. **Cross-provider heterogeneity** — Codex, Gemini, and Ollama have different CLI/API shapes; our abstraction must not leak provider-specifics upward.
3. **Shared-memory correctness** — the mempalace read/write flow is the hardest-to-test differentiator; it must be provably exercised in AC.

### Viable Options

#### Option A — "Worker pool + merger" (selected)
**Approach:** `braid` is a TS CLI that spawns one `ProviderWorker` per provider (Bun.spawn → provider CLI, or fetch → provider API). Each worker receives a scaffolded prompt including its marker string and mempalace-read context. Outputs are collected, then a deterministic `Merger` concatenates sections into `README.md`.
**Pros:** Simple mental model; easy to test each layer in isolation; parallelism is obvious; minimal external deps.
**Cons:** No true task-decomposition (each agent gets the full task); capability routing is a hand-coded section assignment, not dynamic.

#### Option B — "LLM router + task decomposer"
**Approach:** Use one LLM (cheapest, e.g. Gemini Flash free tier) as a planner that decomposes the user task into sub-tasks tagged with required capabilities, then assigns each sub-task to the best-fit provider.
**Pros:** Truer to user's "capability-based routing" vision; scales to non-README tasks.
**Cons:** Adds a 4th LLM call before any work starts (cost, latency); planner failure blocks the run; hard to make acceptance tests deterministic; doubles the scope for a POC.

#### Option C — "MCP server + multi-client"
**Approach:** Stand up a local MCP server wrapping mempalace; each provider runs as an MCP client. `braid` is just the dispatcher.
**Pros:** Clean memory protocol; aligns with modern agent ecosystem.
**Cons:** Requires each provider CLI to speak MCP or be wrapped — Codex/Gemini CLIs don't natively; invalidated by POC-scope driver.

**Invalidation rationale for B & C:** The user's Round 9 acceptance test (spec §Primary Acceptance Test) is explicitly "parallel dispatch + merged output with three markers" — it does **not** require dynamic capability decomposition. Option B would solve a problem the user has already said is not the v0.1 gate, at the cost of a 4th LLM call that blocks the run on planner failure and makes acceptance tests non-deterministic. Option C requires MCP-wrapping every provider CLI — neither Codex nor Gemini CLIs speak MCP natively, so this becomes a multi-week wrapper project. **Capability routing is therefore demoted to a stretch goal in Option A**, implemented as a static section→provider map (router hot-swappable in v0.2 with a dynamic planner, no Option-A interfaces need to change).

## 4. Implementation Steps

> All paths are relative to `/Users/vismaypatel/practice/memplace-poc/`.

### Step 0 — Mempalace spike (timeboxed, 30 min)
**Gate before Step 4.** Clone `github.com/mempalace/mempalace`, read the README, decide: (a) does it expose a JS/TS client library, (b) is it an HTTP server, or (c) neither (half-finished)? Run one manual read + write. Output a one-paragraph decision note in `.omc/drafts/mempalace-spike.md` committing to "real-client" or "stub-client" path. If timebox exceeds 30 min without a clear answer, **default to stub-client** and proceed.

### Step 1 — Project scaffold
Files:
- `package.json` — name `braid`, type `module`, bin `{"braid": "./dist/cli.js"}`, bun script, `bun test` for tests
- `bunfig.toml` — test config
- `tsconfig.json` — target ES2022, strict on
- `.gitignore` — node_modules, dist, .braid/, .env.local

### Step 2 — Provider protocol
File: `src/providers/types.ts`
- `interface ProviderAdapter { name: string; isAvailable(): Promise<{cli: boolean; api: boolean}>; run(opts: RunOpts): Promise<RunResult>; }`
- `type RunOpts = { prompt: string; marker: string; memoryCtx: string; signal: AbortSignal }`
- `type RunResult = { output: string; duration_ms: number; via: "cli" | "api"; error?: string }`

### Step 3 — Three concrete adapters
- `src/providers/codex.ts` — CLI: `codex exec --prompt <file>`; API fallback: `https://api.openai.com/v1/responses` iff `OPENAI_API_KEY` is set **AND** `BRAID_ALLOW_PAID=1` is set.
- `src/providers/gemini.ts` — CLI: `gemini -p <prompt>`; API fallback: Gemini REST iff `GEMINI_API_KEY` is set **AND** `BRAID_ALLOW_PAID=1` is set.
- `src/providers/ollama.ts` — CLI: `ollama run <model> <prompt>`; API fallback: `http://localhost:11434/api/generate` (always allowed — Ollama is local, not paid). Default model: `llama3.2` (override via `BRAID_OLLAMA_MODEL`).

Each adapter calls `Bun.spawn` with `stdout: "pipe"` and a 60s abort signal. On non-zero exit, return `error` field, no throw. The `BRAID_ALLOW_PAID` gate is read once at adapter construction and cached on the instance.

### Step 4 — Memory client (interface + two backends)
Files:
- `src/memory/types.ts` — `interface MemoryClient { read(key: string): Promise<MemEntry | null>; write(key: string, value: string, agent: string): Promise<void>; list(): Promise<MemEntry[]>; }` with `type MemEntry = { key: string; value: string; agent: string; ts: number }`.
- `src/memory/mempalace-client.ts` — real backend per Step 0 outcome.
- `src/memory/in-memory-client.ts` — stub backend: in-process `Map<string, MemEntry>`, used for tests AND as fallback if Step 0 spike says mempalace is unusable.

**Design rule (addresses R1):** `MemoryClient` is the contract; mempalace is one backend. ACs test the interface, not the backend. If the stub ships, the POC still validates the **shared-memory protocol** (read/write/tag/list) across providers, which remains a meaningful differentiator. The claim shifts from "mempalace integration" to "provider-agnostic shared memory protocol" — documented clearly in the POC README.

### Step 5 — Router (static v0.1)
File: `src/router/static.ts`
- Reads a `sections` config that maps section name → provider:
  ```ts
  const DEFAULT_SECTIONS = {
    overview:   "gemini",   // long-context strength
    setup:      "codex",    // code-centric
    examples:   "ollama",   // local/private
  };
  ```
- Produces 3 prompts, one per provider, asking each to write only its assigned section and include its marker.

### Step 6 — Orchestrator (parallel dispatch + memory context)
File: `src/orchestrator.ts`
- Creates mempalace session id
- For each (section, provider), spawns adapter.run in parallel via `Promise.all`
- Before each run: seeds prompt with memory context from other sections that have completed (for AC-7)
- To make AC-7 achievable within parallel dispatch, we use a **two-phase flow**: phase 1 = all three providers write their section draft + a one-line "what I learned" note to memory; phase 2 = **the first successful phase-1 provider (preferring Gemini for long-context)** re-reads all three notes and writes the top-of-file summary. If Gemini failed in phase 1, Codex is tried; then Ollama. This proves cross-agent memory usage deterministically AND fail-soft (if any one of the three survives phase 1, AC-7 still holds).

### Step 7 — Merger
File: `src/merger/readme.ts`
- Deterministic section order: summary, overview, setup, examples
- Appends each section with its provider marker as an HTML comment (survives markdown rendering)
- Writes to `./README.md` in CWD

### Step 8 — CLI entrypoint
File: `src/cli.ts`
- Parse args (plain `process.argv`, no external CLI lib for POC)
- `braid --help` → static usage string
- `braid "<task>"` → orchestrator → merger → exit code 0

### Step 9 — Observability
File: `src/logging.ts`
- Writes JSONL events to `.braid/run-<ISO>.jsonl`
- Events: `provider.start`, `provider.end`, `memory.read`, `memory.write`, `merge.complete`, `run.complete`
- One-line structured console output per event for live visibility

### Step 10 — Tests
- `src/providers/*.test.ts` — unit tests for each adapter using mocked `Bun.spawn`
- `src/router/static.test.ts` — unit test for section map → prompt list
- `src/merger/readme.test.ts` — unit test for deterministic merge and marker injection
- `tests/integration/orchestrator.test.ts` — integration with three mock adapters (each with artificial 100ms delay). Asserts AC-3 (timestamp overlap within 50ms + wall-clock < sum×0.8), AC-5, AC-6, AC-7, AC-9. Includes failure-isolation sub-test: one mock throws; run still completes with remaining outputs.
- `tests/integration/fallback.test.ts` — asserts AC-8: a mock adapter whose `isAvailable()` returns `{cli: false, api: false}` is skipped with a `provider unavailable` stderr message; remaining providers continue; exit code 0.
- `tests/e2e/ollama.smoke.ts` — opt-in via `RUN_E2E=1`; uses real local Ollama for single-section mode.
- `tests/e2e/ollama-all-sections.smoke.ts` — opt-in via `RUN_E2E=1`; overrides router to assign Ollama to all three sections, exercising the real merge path end-to-end.

### Step 11 — Documentation
- `README.md` (human-written, separate from the generated one) — how to run, env vars, gotchas

## 5. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Mempalace's API surface is not what we expect (HTTP server vs library, or project is unusable) | Medium | High | **Step 0 spike** before Step 4. 30-min timebox. If unfixable, ship the `InMemoryClient` stub that implements the same `MemoryClient` interface. The stub validates the shared-memory *protocol* (read/write/tag/list), keeping AC-6 and AC-7 meaningful — the differentiator claim shifts from "mempalace integration" to "provider-agnostic shared memory protocol." |
| R2 | Codex / Gemini CLI commands change or aren't stable | High | Medium | Abstract behind `ProviderAdapter`. Write adapter-level smoke test. Use `--version` probing in `isAvailable()`. |
| R3 | Ollama not installed / no default model | Medium | Medium | `isAvailable()` detects missing binary. Clear error message with install hint. Skip provider, continue run. |
| R4 | API fallback leaks paid quotas (e.g. OPENAI_API_KEY isn't free) | Medium | High | CLI-first ordering. Fallback only when `BRAID_ALLOW_PAID=1` env is set. Document this loudly. |
| R5 | Parallel spawn overwhelms the shell / hits rate limits | Low | Medium | Configurable `BRAID_MAX_CONCURRENCY` (default 3 for POC). Adapter-level 60s timeout. |
| R6 | `Promise.all` rejects on first failure, losing others' output | High | High | Use `Promise.allSettled`. Adapters must not throw — return `error` in `RunResult` instead. Merger skips failed providers, logs which ones. |
| R7 | AC-7 (cross-agent read) not deterministic | Medium | High | Two-phase flow (Step 6) forces at least one read-after-write. Integration test verifies via mempalace call log. |
| R8 | README output non-deterministic (hard to test) | Medium | Medium | Merger produces fixed section order; markers are static. Integration tests use mock adapters returning fixed strings. |

## 6. Pre-Mortem (deliberate mode)

### Scenario 1 — "It runs, but the acceptance test lies"
Two days in, `braid "write README"` produces a file. It contains all three markers. Tests pass. But wall-clock timing isn't actually parallel — Bun.spawn was inadvertently awaited sequentially in a loop. No one notices because the acceptance criteria didn't explicitly assert a timing bound.

**What fixed it:** AC-3 explicitly asserts `total_wall_clock < sum(individual_durations) * 0.8`. Integration test records start/end timestamps per provider and asserts overlap.

### Scenario 2 — "Mempalace is a ghost"
Mempalace turns out to be a half-finished project with no stable API. Four hours lost trying to make it work. User loses confidence.

**What fixed it:** Step 0 spike (R1 mitigation) is run FIRST, before any other implementation. If mempalace doesn't meet the bar, we ship the in-memory stub and document the substitution as "POC-v0.1 memory shim, swap for mempalace in v0.2".

### Scenario 3 — "Works for me, broken for everyone else"
Works on the author's laptop where Codex, Gemini, and Ollama CLIs are all pre-authenticated. Another user tries it — all three providers error out. The `isAvailable()` detection returns `true` for the binary but the CLIs fail on the first real call because they need interactive auth.

**What fixed it:** `isAvailable()` must also run a lightweight "hello" probe (e.g. `codex --version` is not enough; use `codex "echo hi"` with 5s timeout). **Caveat:** the hello probe itself consumes one free-tier request per run — acceptable for POC (3 probes/run max) but flagged as a follow-up to cache `isAvailable()` results for N minutes in v0.2. Document env var / auth requirements in README per provider.

## 7. Expanded Test Plan

| Layer | What we test | How | When it runs |
|-------|-------------|-----|--------------|
| **Unit** | Provider adapters (mocked spawn), router mapping, merger formatting, logger event shape | `bun test src/**/*.test.ts` | Every commit |
| **Integration** | Orchestrator with 3 mock adapters: parallelism (timestamp overlap), marker presence, memory read-after-write, failure isolation (one adapter throws, others still produce output) | `bun test tests/integration/*.test.ts` | Every commit |
| **E2E** | Full pipeline against real Ollama (hermetic, no external network), asserts README is produced with Ollama marker | `RUN_E2E=1 bun test tests/e2e/ollama.smoke.ts` | Manual / pre-release |
| **Observability** | Every run writes a JSONL trace with start/end events per provider; integration test asserts event counts and structure | Same `bun test` with log-capture fixture | Every commit |

**Coverage targets:** unit 80%, integration covers every AC-numbered criterion at least once.

## 8. Verification Steps

Automated gates (run in order):
1. `bun install` — dependency install succeeds [proves AC-1]
2. `bun test` — all unit + integration tests green [proves AC-3, AC-6, AC-7, AC-10, AC-11]
3. `bun run build && bun link` — CLI installable locally [proves AC-1]
4. `braid --help` — exits 0, prints usage [proves AC-2]
5. `ollama pull llama3.2` (one-time setup)
6. `braid "write a markdown README for a TypeScript project"` — produces `README.md`
7. `grep -c "agent:codex\|agent:gemini\|agent:ollama" README.md` — returns 3 [proves AC-4, AC-5]
8. `cat .braid/*.jsonl | jq 'select(.event == "provider.end") | .provider' | sort -u | wc -l` — returns 3 [proves AC-9]
9. **AC-7 verification:** `cat .braid/*.jsonl | jq -s 'map(select(.event == "memory.read" or .event == "memory.write")) | [.[] | select(.event == "memory.read")] as $reads | [.[] | select(.event == "memory.write")] as $writes | any($reads[]; .key as $k | .agent as $ra | any($writes[]; .key == $k and .agent != $ra))'` — returns `true` [proves AC-7 explicitly]
10. **AC-8 verification:** `PATH=/usr/bin:/bin braid "write README"` (strips Codex+Gemini CLIs from PATH; with paid gate off) — run completes with Ollama-only output, stderr logs `provider unavailable: codex`, `provider unavailable: gemini`, exit code is 0 [proves AC-8]
11. `RUN_E2E=1 bun test tests/e2e/ollama.smoke.ts` — passes locally with Ollama running [proves AC-12]
12. `RUN_E2E=1 bun test tests/e2e/ollama-all-sections.smoke.ts` — runs the full orchestrator with Ollama assigned to all three section providers, exercises real merge end-to-end [closes the merge-coverage gap flagged by Critic C5]

Manual gate (not automated, reviewer sign-off):
- M1. Visually inspect generated `README.md` for coherence — the three sections should read as one document, not three disconnected blobs. This is a known manual gate; a future improvement (v0.2) is an LLM-as-judge scorer.

## 9. Stretch Goals (NOT in POC v0.1)

- Dynamic capability-based routing (LLM planner decomposes tasks)
- Free-tier budget tracker per provider
- Additional providers (Claude, Anthropic, Mistral, local models)
- Web dashboard for run inspection
- Retry logic with exponential backoff per provider
- Provider health caching (avoid re-probing on every run — addresses hello-probe-consumes-quota caveat)
- LLM-as-judge coherence scorer (replaces manual gate M1)

## 10. Architecture Decision Record (ADR)

**Title:** `braid` POC v0.1 — worker-pool orchestrator with `MemoryClient` interface

**Status:** Accepted (2026-04-19), Architect + Critic consensus after 2 iterations.

**Decision:** Build `braid` as a Bun + TypeScript CLI using a worker-pool architecture (Option A). Each of three providers (Codex, Gemini, Ollama) is wrapped in a `ProviderAdapter` with CLI-first, API-fallback I/O (paid APIs gated behind `BRAID_ALLOW_PAID=1`). A `MemoryClient` interface abstracts the shared-memory backend, with a real `MempalaceClient` (contingent on a 30-min Step 0 spike) and an `InMemoryClient` stub as fallback. A two-phase orchestrator dispatches all three providers in parallel (phase 1), then the first successful phase-1 provider re-reads others' notes to write a summary (phase 2), proving cross-agent memory read. A deterministic `Merger` assembles sections into `README.md` with provider-specific markers.

**Drivers:**
1. POC-scope credibility — must be demonstrable in a weekend.
2. Cross-provider heterogeneity — three different CLI/API shapes must not leak upward.
3. Shared-memory correctness — the hardest-to-test differentiator must be provably exercised by AC.

**Alternatives considered:**
- **Option B (LLM router + task decomposer):** rejected — the user's Round 9 acceptance test explicitly does not require dynamic decomposition. Adding a 4th LLM planner call adds fragility and non-determinism the POC gate does not need.
- **Option C (MCP server + multi-client):** rejected — Codex and Gemini CLIs do not natively speak MCP, so wrapping them is a multi-week project outside POC scope.

**Why chosen:** Option A aligns with the Round 9 acceptance test (parallel dispatch + merged output), preserves all three differentiators (shared memory, capability routing via static section map, provider-agnostic protocol via `ProviderAdapter`), fits a weekend scope, and provides a clean upgrade path to Option B in v0.2 (swap the router module, no other interface changes).

**Consequences:**
- ✅ Three architectural differentiators remain demonstrable (capability routing is static in v0.1).
- ✅ `MemoryClient` interface protects the POC from mempalace project risk — stub fallback keeps ACs meaningful.
- ✅ Adding a 4th provider requires one new adapter file + one config entry.
- ⚠️ v0.1 ships with static section→provider assignment, not dynamic routing. Explicit v0.2 follow-up.
- ⚠️ Hello-probe adds ~3 free-tier requests per run. Acceptable at POC scale; v0.2 follow-up to cache.
- ⚠️ M1 manual coherence gate is a CI blind spot; v0.2 follow-up for LLM-as-judge scorer.

**Follow-ups (tracked for v0.2+):**
1. Dynamic LLM-router task decomposition (Option B carryover)
2. Provider health caching (addresses hello-probe quota burn)
3. LLM-as-judge coherence scorer (replaces M1)
4. Free-tier budget tracker per provider
5. Additional providers via the `ProviderAdapter` interface
6. Swap stub → real mempalace if Step 0 spike forced stub

## 11. Resolution Changelog (v1 → v2)

| Source | Must-fix item | Status | Landed in |
|--------|---------------|--------|-----------|
| Architect-1 | Step 6 phase-2 Gemini hard-coding | ✅ | Step 6 body (fallback Gemini → Codex → Ollama) |
| Architect-2 | R1 stub-validates-protocol reframe | ✅ | Step 4 design rule + R1 row |
| Architect-3 | Option A rationale cites Round 9 | ✅ | §3 invalidation rationale |
| Critic-1 | AC-3 timing non-vacuous | ✅ | AC-3 body + Step 10 test spec |
| Critic-2 | AC-8 verification step | ✅ | §8 step 10 |
| Critic-3 | AC-7 verification step | ✅ | §8 step 9 |
| Critic-4 | `BRAID_ALLOW_PAID` in Step 3 | ✅ | Step 3 Codex + Gemini adapters |
| Critic-5 | AC-12 merge coverage | ✅ | `ollama-all-sections.smoke.ts` + §8 step 12 |
| Critic-S1 | AC-6 tightened to "exactly one" | ✅ | AC-6 body |
| Critic-S2 | Step 0 renumbered explicitly | ✅ | §4 header |
| Critic-S3 | Manual gate flagged separately | ✅ | §8 M1 |
| Critic-S4 | Hello-probe quota caveat | ✅ | Pre-mortem Scenario 3 fix |
