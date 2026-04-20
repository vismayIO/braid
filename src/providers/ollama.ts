/**
 * Ollama provider adapter — Step 3 of the plan.
 * CLI-first via `ollama run <model> <prompt>`;
 * API fallback via http://localhost:11434/api/generate (always allowed — local, not paid).
 * Default model: llama3.2 (override via BRAID_OLLAMA_MODEL env var).
 */

import type { ProviderAdapter, RunOpts, RunResult } from "./types";

const OLLAMA_CLI = "ollama";
const OLLAMA_API_URL = "http://localhost:11434/api/generate";
const HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_MODEL = "llama3.2";

export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama";

  private readonly model: string;

  constructor() {
    this.model = process.env.BRAID_OLLAMA_MODEL ?? DEFAULT_MODEL;
  }

  async isAvailable(): Promise<{ cli: boolean; api: boolean }> {
    const [cli, api] = await Promise.all([this._probeCliHello(), this._probeApi()]);
    return { api, cli };
  }

  async run(opts: RunOpts): Promise<RunResult> {
    const avail = await this.isAvailable();

    if (avail.cli) {
      return this._runCli(opts);
    }
    if (avail.api) {
      return this._runApi(opts);
    }

    return {
      duration_ms: 0,
      error:
        `provider unavailable: ollama — CLI not found and API not reachable at ${OLLAMA_API_URL}. ` +
        `Run: brew install ollama && ollama pull ${this.model}`,
      output: "",
      via: "cli",
    };
  }

  private async _probeCliHello(): Promise<boolean> {
    // Hello-probe: `ollama list` hits the local daemon, so an installed-but-
    // not-running ollama fails fast (plan pre-mortem #3). Bounded by
    // HELLO_TIMEOUT_MS.
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      const proc = Bun.spawn([OLLAMA_CLI, "list"], {
        signal: ac.signal,
        stderr: "pipe",
        stdout: "pipe",
      });
      const exitCode = await proc.exited;
      clearTimeout(timer);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  private async _probeApi(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      // HEAD /api/tags is a lightweight Ollama health check
      const res = await fetch("http://localhost:11434/api/tags", {
        method: "GET",
        signal: ac.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _runCli(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      const prompt = this._buildPrompt(opts);
      const proc = Bun.spawn([OLLAMA_CLI, "run", this.model, prompt], {
        signal: opts.signal,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const duration_ms = Date.now() - start;

      if (exitCode !== 0) {
        return {
          duration_ms,
          error: `ollama CLI exited ${exitCode}: ${stderr.slice(0, 200)}`,
          output: "",
          via: "cli",
        };
      }

      return {
        duration_ms,
        output: this._ensureMarker(stdout, opts.marker),
        via: "cli",
      };
    } catch (err) {
      return {
        duration_ms: Date.now() - start,
        error: `ollama CLI error: ${String(err)}`,
        output: "",
        via: "cli",
      };
    }
  }

  private async _runApi(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      const res = await fetch(OLLAMA_API_URL, {
        body: JSON.stringify({
          model: this.model,
          prompt: this._buildPrompt(opts),
          stream: false,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: opts.signal,
      });

      const duration_ms = Date.now() - start;

      if (!res.ok) {
        const text = await res.text();
        return {
          duration_ms,
          error: `ollama API ${res.status}: ${text.slice(0, 200)}`,
          output: "",
          via: "api",
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any;
      const text: string = json?.response ?? "";

      return {
        duration_ms,
        output: this._ensureMarker(text, opts.marker),
        via: "api",
      };
    } catch (err) {
      return {
        duration_ms: Date.now() - start,
        error: `ollama API error: ${String(err)}`,
        output: "",
        via: "api",
      };
    }
  }

  private _buildPrompt(opts: RunOpts): string {
    const parts: string[] = [];
    if (opts.memoryCtx) {
      parts.push(`## Context from other agents\n${opts.memoryCtx}\n`);
    }
    parts.push(opts.prompt);
    parts.push(
      `\nIMPORTANT: You must include the exact string "${opts.marker}" somewhere in your output.`,
    );
    return parts.join("\n");
  }

  private _ensureMarker(output: string, marker: string): string {
    if (output.includes(marker)) {
      return output;
    }
    return `${output}\n\n${marker}`;
  }
}
