/**
 * Gemini provider adapter — Step 3 of the plan.
 * CLI-first via `gemini -p <prompt>`; API fallback via Gemini REST.
 * Paid API only called when BRAID_ALLOW_PAID=1 AND GEMINI_API_KEY is set.
 */

import type { ProviderAdapter, RunOpts, RunResult } from "./types.ts";

const GEMINI_CLI = "gemini";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const HELLO_TIMEOUT_MS = 5_000;

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";

  private readonly allowPaid: boolean;
  private readonly apiKey: string | undefined;

  constructor() {
    this.allowPaid = process.env["BRAID_ALLOW_PAID"] === "1";
    this.apiKey = process.env["GEMINI_API_KEY"];
  }

  async isAvailable(): Promise<{ cli: boolean; api: boolean }> {
    const cli = await this._probeCliHello();
    const api =
      this.allowPaid &&
      !!this.apiKey &&
      (await this._probeApi());

    return { cli, api };
  }

  async run(opts: RunOpts): Promise<RunResult> {
    const avail = await this.isAvailable();

    if (avail.cli) {
      return this._runCli(opts);
    }
    if (avail.api) {
      return this._runApi(opts);
    }

    const reason = !this.allowPaid
      ? "BRAID_ALLOW_PAID not set"
      : !this.apiKey
      ? "GEMINI_API_KEY not set"
      : "CLI unavailable and API probe failed";

    return {
      output: "",
      duration_ms: 0,
      via: "cli",
      error: `provider unavailable: gemini — ${reason}`,
    };
  }

  private async _probeCliHello(): Promise<boolean> {
    // Hello-probe: invoke with a trivial prompt so an unauthenticated CLI
    // fails fast (plan pre-mortem #3). Bounded by HELLO_TIMEOUT_MS.
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      const proc = Bun.spawn([GEMINI_CLI, "-p", "echo hi"], {
        stdout: "pipe",
        stderr: "pipe",
        signal: ac.signal,
      });
      const exitCode = await proc.exited;
      clearTimeout(timer);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  private async _probeApi(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      const url = `${GEMINI_API_URL}?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      return res.status === 200 || res.status === 400;
    } catch {
      return false;
    }
  }

  private async _runCli(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      const prompt = this._buildPrompt(opts);
      const proc = Bun.spawn([GEMINI_CLI, "-p", prompt], {
        stdout: "pipe",
        stderr: "pipe",
        signal: opts.signal,
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const duration_ms = Date.now() - start;

      if (exitCode !== 0) {
        return {
          output: "",
          duration_ms,
          via: "cli",
          error: `gemini CLI exited ${exitCode}: ${stderr.slice(0, 200)}`,
        };
      }

      return {
        output: this._ensureMarker(stdout, opts.marker),
        duration_ms,
        via: "cli",
      };
    } catch (err) {
      return {
        output: "",
        duration_ms: Date.now() - start,
        via: "cli",
        error: `gemini CLI error: ${String(err)}`,
      };
    }
  }

  private async _runApi(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      const url = `${GEMINI_API_URL}?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: this._buildPrompt(opts) }] }],
          generationConfig: { maxOutputTokens: 2048 },
        }),
        signal: opts.signal,
      });

      const duration_ms = Date.now() - start;

      if (!res.ok) {
        const text = await res.text();
        return {
          output: "",
          duration_ms,
          via: "api",
          error: `gemini API ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any;
      const text: string =
        json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      return {
        output: this._ensureMarker(text, opts.marker),
        duration_ms,
        via: "api",
      };
    } catch (err) {
      return {
        output: "",
        duration_ms: Date.now() - start,
        via: "api",
        error: `gemini API error: ${String(err)}`,
      };
    }
  }

  private _buildPrompt(opts: RunOpts): string {
    const parts: string[] = [];
    if (opts.memoryCtx) {
      parts.push(`## Context from other agents\n${opts.memoryCtx}\n`);
    }
    parts.push(opts.prompt);
    parts.push(`\nIMPORTANT: You must include the exact string "${opts.marker}" somewhere in your output.`);
    return parts.join("\n");
  }

  private _ensureMarker(output: string, marker: string): string {
    if (output.includes(marker)) return output;
    return `${output}\n\n${marker}`;
  }
}
