/**
 * MempalaceClient — real backend scaffold.
 *
 * Step 0 spike decision: mempalace is Python-only (pip install mempalace).
 * It has no JS/TS client library and no HTTP server surface.
 * This file is scaffolded with TODO markers for v0.2 when a JS MCP client
 * wrapper exists. Until then, InMemoryClient is the active backend.
 *
 * v0.2 integration path options:
 *   A) Run `mempalace` as a local MCP server and speak MCP protocol via stdio.
 *   B) Write a thin Python HTTP bridge that wraps mempalace and call it via fetch.
 *   C) Wait for an official JS/TS client package.
 */

import type { MemoryClient, MemEntry } from "./types.ts";

export class MempalaceClient implements MemoryClient {
  // TODO(v0.2): inject MCP client or HTTP base URL here
  constructor(
    _opts: {
      // TODO(v0.2): baseUrl?: string; sessionId?: string;
    } = {}
  ) {
    throw new Error(
      "MempalaceClient is not implemented: mempalace has no JS/TS client. " +
        "Use InMemoryClient for now. See .omc/drafts/mempalace-spike.md."
    );
  }

  // TODO(v0.2): implement read via MCP tool call or HTTP GET
  async read(_key: string): Promise<MemEntry | null> {
    throw new Error("Not implemented");
  }

  // TODO(v0.2): implement write via MCP tool call or HTTP POST
  async write(_key: string, _value: string, _agent: string): Promise<void> {
    throw new Error("Not implemented");
  }

  // TODO(v0.2): implement list via MCP tool call or HTTP GET /list
  async list(): Promise<MemEntry[]> {
    throw new Error("Not implemented");
  }
}
