---
name: braid-poc-spec
description: Deep interview spec for `braid` — a Bun/TypeScript CLI that orchestrates multiple free-tier AI coding agents (Codex, Gemini, Ollama) with capability-based routing and shared memory via mempalace
generated: 2026-04-19
---

# Deep Interview Spec: `braid` — Multi-Provider AI Agent Orchestrator

## Metadata
- Interview ID: deep-interview-braid-2026-04-19
- Rounds: 9
- Final Ambiguity Score: 11%
- Type: greenfield
- Generated: 2026-04-19
- Threshold: 20%
- Status: PASSED (below threshold)
- Ontology stability: 100% across final 6 rounds (converged)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 0.40 | 0.38 |
| Constraint Clarity | 0.80 | 0.30 | 0.24 |
| Success Criteria Clarity | 0.90 | 0.30 | 0.27 |
| **Total Clarity** | | | **0.89** |
| **Ambiguity** | | | **0.11** |

## Goal
Build `braid`, a Bun + TypeScript CLI that, given a single natural-language task, dispatches it in parallel across three free-tier AI coding agents (Codex, Gemini, Ollama), routes sub-tasks by capability, lets agents share context through a mempalace-backed memory layer, and merges their outputs into a single deliverable — maximizing the user's effective productivity on free tiers alone.

## Primary Acceptance Test (POC v0.1 pass condition)
Running:
```
braid "write a markdown README for a TypeScript project"
```
Must:
1. Launch Codex, Gemini, and Ollama **in parallel**.
2. Each agent writes a section of the README.
3. Agents read/write to a shared mempalace memory during their work.
4. `braid` merges the three sections into a single `README.md`.
5. The resulting file contains a verifiable marker from **each** of the three agents (so we can assert all three contributed).

Pass criteria (testable):
- [ ] `README.md` exists after invocation
- [ ] File contains a Codex marker string
- [ ] File contains a Gemini marker string
- [ ] File contains an Ollama marker string
- [ ] All three agent invocations ran concurrently (wall-clock < sum of individual times)
- [ ] mempalace memory shows at least one write from each agent

## Constraints
- **Runtime:** Bun
- **Language:** TypeScript
- **I/O model:** Hybrid — prefer each provider's CLI (`codex`, `gemini`, `ollama`) for free-tier usage; fall back to the provider's HTTP API when the CLI is missing; error clearly when neither is available.
- **Free-tier orientation:** design decisions should favor free-tier paths by default.
- **Memory backend:** [mempalace](https://github.com/mempalace/mempalace) — shared across all agents.
- **Distribution:** installable via `bun`/`npm` (exact packaging decision deferred).
- **OS:** macOS first (dev environment is Darwin); other POSIX OSes nice-to-have, Windows not in POC scope.

## Non-Goals (explicit scope exclusions)
- Not a Claude Code plugin, tmux dashboard, or web UI (rejected in Round 4).
- Not a replacement for OMC's `ccg` / `omc-teams` / `team` skills — `braid` is a standalone tool with different differentiators (shared memory, capability routing, provider-agnostic protocol).
- Not a headless CI/git-hook orchestrator (rejected via contrarian challenge in Round 4).
- Not a minimal 2-agent demo — user explicitly rejected the simplifier path in Round 6 and wants the full 3-agent + routing + memory vision.
- Not capability-routing-only (Option #2 acceptance test) — parallel dispatch + merged output is the v0.1 gate; capability routing is a stretch goal.
- Not a pure free-tier budget tracker — user de-selected this differentiator in Round 3.

## Differentiators vs Existing OMC Skills
Three orthogonal differentiators from `ccg` / `omc-teams`:
1. **Shared memory palace** — unified long-term memory via mempalace that all agents read and write during execution.
2. **Capability-based routing** — each agent has known strengths (Codex → code, Gemini → long-context, Ollama → private/offline); routing decisions use those strengths.
3. **Provider-agnostic protocol** — a plug-in interface so any LLM CLI can be registered as an agent, not just Claude / Codex / Gemini.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Directory name `memplace-poc` drives the CLI name | Asked explicitly | CLI named `braid`; directory name is incidental |
| "Multi-agent" means interactive operator-facing tool | Contrarian (R4): what if headless? | Operator-facing CLI is the product; headless out of scope |
| Full vision is too big for a POC | Simplifier (R6): smallest valuable slice? | Rejected — user wants 3 agents + routing + memory as minimum |
| Free-tier budget tracking is a differentiator | Offered alongside memory/routing/protocol in R3 | De-selected — not a POC differentiator |
| "Free tier" means API-only usage | Probed in R5 | Hybrid: CLIs first (true free tier), APIs as fallback |
| Language should match Claude Code / Node ecosystem | Offered 4 options in R7 | Bun + TypeScript — modern runtime, fast, good DX |

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Agent | core domain | provider, model, capabilities, free_limit, protocol_adapter | member of AgentTeam; reads/writes Memory |
| Task | core domain | description, sub-tasks, assignments, capability_requirements | dispatched by AgentTeam; recorded in Memory |
| AgentTeam | core domain | members, router, coordinator | executes Task; contains Agents |
| Router | core domain | capability_matcher, assignment_logic | owned by AgentTeam; operates on Tasks |
| Provider | supporting | name, cli_command, api_endpoint, auth, free_tier_limits | implemented via ProtocolAdapter |
| ProtocolAdapter | supporting | interface_spec, cli_invoker, api_invoker | bridges Agent ↔ Provider |
| Capability | supporting | name, fit_score_per_provider | used by Router to score assignments |
| Memory | external system | backed by mempalace; shared across agents | read/written by all Agents |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability |
|-------|-------------|-----|---------|--------|-----------|
| 1 | 5 | 5 | — | — | N/A (first round) |
| 3 | 8 | 3 (Router, ProtocolAdapter, Capability) | 0 | 5 | 63% |
| 4 | 8 | 0 | 0 | 8 | 100% |
| 5 | 8 | 0 | 0 | 8 | 100% |
| 6 | 8 | 0 | 0 | 8 | 100% |
| 7 | 8 | 0 | 0 | 8 | 100% |
| 8 | 8 | 0 | 0 | 8 | 100% |
| 9 | 8 | 0 | 0 | 8 | 100% |

Domain model converged from Round 4 onward — no new concepts surfaced despite probing language, packaging, simplification, naming, and acceptance criteria. Strong signal that the ontology is correct and complete for the POC scope.

## Technical Context (greenfield)
- Working directory: `/Users/vismaypatel/practice/memplace-poc/` (empty except `.omc/`)
- No prior source code, no package.json, no git history
- Directory name `memplace-poc` retained; CLI artifact named `braid` (package name decision deferred)
- Challenge modes used: Contrarian (R4, rejected), Simplifier (R6, rejected). Ontologist not triggered (ambiguity dropped before R8 threshold check).

## Open Questions Deferred to Planning Phase
These are explicitly NOT interview-phase concerns — they're for the planner/architect to resolve:
- Exact package name on npm (`braid` may be taken — needs availability check)
- Mempalace integration API surface (library vs HTTP vs MCP server)
- Subprocess orchestration library (Bun's native `Bun.spawn` vs `execa` vs custom)
- Output parsing strategy per CLI (each of codex/gemini/ollama emits differently)
- Router's initial capability heuristics (hardcoded table vs config file vs LLM-based)
- Authentication: how to detect/manage API keys for fallback path
- Observability: logging, tracing, dashboarding of parallel agent runs

## Interview Transcript

<details>
<summary>Full Q&A (9 rounds)</summary>

### Round 0 (initialization)
User invoked `/deep-interview` with no arguments. Directory `memplace-poc` contained only `.omc/`. Starting ambiguity: 100%.

### Round 1
**Q:** Directory is named 'memplace-poc' — is the idea related, or different?
**A:** Different idea entirely.
**Then:** What kind of thing? → "Something else" → AI/LLM-powered tool → Personal productivity → Free-text: "Tool where I can use all the AI coding agents available in the market for free. Like Codex gives a free limit, all tools give them; configure all, use all in one feature. For memory, there's mempalace. Make agent teams with Codex, Gemini, Ollama working together, so I can use free tier as much as possible for productivity."
**Ambiguity after:** 71% (Goal: 0.50, Constraints: 0.20, Criteria: 0.10)

### Round 2
**Q:** OMC already has `/ccg` and `/omc-teams` — what are you building relative to those?
**A:** Something net-new.
**Ambiguity after:** 65%

### Round 3
**Q:** What makes yours net-new? (Multi-select)
**A:** Shared memory palace + Capability-based routing + Provider-agnostic protocol. (Rejected free-tier budget router.)
**Ambiguity after:** 58% (Goal: 0.75). Ontology added: Router, ProtocolAdapter, Capability.

### Round 4 (Contrarian challenge)
**Q:** Describe a concrete success moment. Contrarian: what if this were headless (no operator)?
**A:** CLI: one command. (Stuck with operator-facing.)
**Ambiguity after:** 42% (Goal: 0.85).

### Round 5
**Q:** How does the CLI talk to Codex/Gemini/Ollama?
**A:** Hybrid: CLIs first, APIs fallback.
**Ambiguity after:** 37.5% (Constraints: 0.55).

### Round 6 (Simplifier challenge)
**Q:** What's the smallest valuable POC? Simplifier: pick one problem to prove in isolation.
**A:** 3 agents + routing + memory. (Rejected simplification.)
**Ambiguity after:** 29.5% (Criteria: 0.60).

### Round 7
**Q:** Language/runtime?
**A:** Bun + TypeScript. Also asked for a unique/trending CLI name.
**Ambiguity after:** 22%.

### Round 8
**Q:** Pick a name from: braid, weave, chord, mesh.
**A:** braid.
**Ambiguity after:** 20% (AT threshold).

### Round 9
**Q:** Concrete POC acceptance test?
**A:** Parallel dispatch + merged output (option #1).
**Ambiguity after:** 11% (BELOW threshold — crystallize).

</details>
