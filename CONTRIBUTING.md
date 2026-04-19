# Contributing to braid

Thanks for considering a contribution. `braid` is an early-stage POC, so the goal right now is to keep the code small, the contract stable, and the provider surface extensible.

## Ground Rules

- **Bun + TypeScript, strict mode.** No runtime dependencies; keep it that way if possible.
- **Adapters must not throw.** Return `{ error }` on failure so `Promise.allSettled` can isolate bad providers.
- **Free-tier first.** Any paid API call must be gated behind `BRAID_ALLOW_PAID=1`. Ollama is exempt (local only).
- **Shared memory protocol over a specific backend.** Program against `MemoryClient`; don't leak `InMemoryClient` or future `MempalaceClient` specifics into orchestration code.

## Development Setup

```bash
git clone https://github.com/vismayIO/braid.git
cd braid
bun install
bun test
bun run build
```

## Running the Tests

```bash
bun test                         # unit + integration (58 tests)
bun test tests/integration/      # orchestration contract
RUN_E2E=1 bun test tests/e2e/    # requires a running Ollama daemon
```

## Adding a Provider

1. Implement `ProviderAdapter` in `src/providers/<name>.ts`.
2. Expose `isAvailable()` as a true hello-probe (not just `--version`) bounded by 5 seconds.
3. Honour `BRAID_ALLOW_PAID` for any paid API fallback.
4. Register it in `src/cli.ts` and add a default section mapping in `src/router/static.ts`.
5. Add an integration test in `tests/integration/` using a 100 ms mock.

## Filing Issues

Please include:

- `braid --help` output
- The `.braid/run-<timestamp>.jsonl` log from the failing run (redact any API keys)
- Platform, Bun version, and whether the CLI or API path was used (`via` field in the log)

## Pull Requests

- One concern per PR.
- Keep tests passing: `bun test` before pushing.
- Update `README.md` if you change CLI flags, env vars, or routing defaults.
