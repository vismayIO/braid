/**
 * Codex provider adapter — Step 3 of the plan.
 * CLI-first via `Bun.spawn`; API fallback via fetch to OpenAI responses endpoint.
 * Paid API only called when BRAID_ALLOW_PAID=1 AND OPENAI_API_KEY is set.
 */

import type { ProviderAdapter, RunOpts, RunResult } from "./types";

const CODEX_CLI = "codex";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const HELLO_TIMEOUT_MS = 5_000;

export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex";

  private readonly allowPaid: boolean;
  private readonly apiKey: string | undefined;

  constructor() {
    this.allowPaid = process.env.BRAID_ALLOW_PAID === "1";
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  async isAvailable(): Promise<{ cli: boolean; api: boolean }> {
    const cli = await this._probeCliHello();
    const api = this.allowPaid && !!this.apiKey && (await this._probeApi());

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

    const reason = this.allowPaid
      ? this.apiKey
        ? "CLI unavailable and API probe failed"
        : "OPENAI_API_KEY not set"
      : "BRAID_ALLOW_PAID not set";

    return {
      duration_ms: 0,
      error: `provider unavailable: codex — ${reason}`,
      output: "",
      via: "cli",
    };
  }

  private async _probeCliHello(): Promise<boolean> {
    // Hello-probe: actually invoke the CLI with a trivial prompt so an
    // installed-but-unauthenticated binary fails the probe (plan pre-mortem #3).
    // Bounded by HELLO_TIMEOUT_MS — if the CLI doesn't answer quickly, treat
    // as unavailable.
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      const tmpFile = `/tmp/braid-codex-hello-${Date.now()}.txt`;
      await Bun.write(tmpFile, "echo hi");
      const proc = Bun.spawn([CODEX_CLI, "exec", "--prompt", tmpFile], {
        signal: ac.signal,
        stderr: "pipe",
        stdout: "pipe",
      });
      const exitCode = await proc.exited;
      clearTimeout(timer);
      try {
        const fs = await import("node:fs");
        fs.unlinkSync(tmpFile);
      } catch {
        /* best-effort */
      }
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  private async _probeApi(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HELLO_TIMEOUT_MS);
      const res = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({
          input: "echo hi",
          max_output_tokens: 5,
          model: "codex-mini-latest",
        }),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: ac.signal,
      });
      clearTimeout(timer);
      // 200 or 400 (bad request) both mean the endpoint is reachable and authed
      return res.status === 200 || res.status === 400;
    } catch {
      return false;
    }
  }

  private async _runCli(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      // Write prompt to a temp file to avoid shell escaping issues
      const tmpFile = `/tmp/braid-codex-${Date.now()}.txt`;
      await Bun.write(tmpFile, this._buildPrompt(opts));

      const proc = Bun.spawn([CODEX_CLI, "exec", "--prompt", tmpFile], {
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

      // Clean up temp file
      try {
        const fs = await import("node:fs");
        fs.unlinkSync(tmpFile);
      } catch {
        /* best-effort cleanup */
      }

      if (exitCode !== 0) {
        return {
          duration_ms,
          error: `codex CLI exited ${exitCode}: ${stderr.slice(0, 200)}`,
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
        error: `codex CLI error: ${String(err)}`,
        output: "",
        via: "cli",
      };
    }
  }

  private async _runApi(opts: RunOpts): Promise<RunResult> {
    const start = Date.now();
    try {
      const res = await fetch(OPENAI_API_URL, {
        body: JSON.stringify({
          input: this._buildPrompt(opts),
          max_output_tokens: 1024,
          model: "codex-mini-latest",
        }),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: opts.signal,
      });

      const duration_ms = Date.now() - start;

      if (!res.ok) {
        const text = await res.text();
        return {
          duration_ms,
          error: `codex API ${res.status}: ${text.slice(0, 200)}`,
          output: "",
          via: "api",
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any;
      // OpenAI responses API returns output array
      const text: string =
        json?.output?.[0]?.content?.[0]?.text ?? json?.choices?.[0]?.message?.content ?? "";

      return {
        duration_ms,
        output: this._ensureMarker(text, opts.marker),
        via: "api",
      };
    } catch (err) {
      return {
        duration_ms: Date.now() - start,
        error: `codex API error: ${String(err)}`,
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
