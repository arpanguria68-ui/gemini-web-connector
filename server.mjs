#!/usr/bin/env node
// MCP connector for a local gemini-web2api proxy (OpenAI-compatible).
// Env: GEMINI_BASE_URL (default http://localhost:8081/v1), GEMINI_API_KEY (default sk-local),
//      GEMINI_MODEL (default gemini-3.1-pro), GEMINI_TIMEOUT_MS (default 120000)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.GEMINI_BASE_URL || "http://localhost:8081/v1").replace(/\/+$/, "");
const KEY = process.env.GEMINI_API_KEY || "sk-local";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro";
const TIMEOUT = Number(process.env.GEMINI_TIMEOUT_MS || 120000);

const FIX =
  "Fix: reopen gemini.google.com/app, refresh, Inspect Session > Export in the cookie extension, restart the proxy.";

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = /xsrf/i.test(text) ? ` ${FIX}` : "";
    throw new Error(`HTTP ${res.status} from proxy: ${text.slice(0, 500)}${hint}`);
  }
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON from proxy: ${text.slice(0, 300)}`); }
}

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (e) => ({
  isError: true,
  content: [{
    type: "text",
    text: e?.cause?.code === "ECONNREFUSED" || e?.name === "TypeError"
      ? `Proxy unreachable at ${BASE}. Start it: python gemini_web2api.py`
      : String(e?.message || e),
  }],
});

const server = new McpServer({ name: "gemini-web2api", version: "1.0.0" });

server.tool(
  "gemini_chat",
  "Send a prompt to Gemini through the local gemini-web2api proxy. Optional system prompt, model, thinking depth, history.",
  {
    prompt: z.string().describe("User message"),
    system: z.string().optional().describe("System prompt"),
    model: z.string().optional().describe("e.g. gemini-3.1-pro, gemini-3.6-flash, gemini-auto"),
    think: z.number().int().min(0).max(4).optional().describe("Thinking depth 0-4 (0 = deepest, 4 = shallowest). Appended as @think=N"),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional()
      .describe("Prior turns, oldest first"),
    temperature: z.number().optional(),
  },
  async ({ prompt, system, model, think, history, temperature }) => {
    try {
      let m = model || DEFAULT_MODEL;
      if (think !== undefined && !m.includes("@think=")) m += `@think=${think}`;
      const messages = [
        ...(system ? [{ role: "system", content: system }] : []),
        ...(history || []),
        { role: "user", content: prompt },
      ];
      const body = { model: m, messages, ...(temperature !== undefined && { temperature }) };
      const r = await api("/chat/completions", { method: "POST", body: JSON.stringify(body) });
      const out = r?.choices?.[0]?.message?.content;
      if (out == null)
        return fail(new Error(`Empty content (null). Session likely expired. ${FIX}`));
      const served = r.model && r.model !== m.split("@")[0] ? `\n\n[note: requested ${m}, served ${r.model}]` : "";
      return ok(out + served);
    } catch (e) { return fail(e); }
  },
);

server.tool("gemini_models", "List models the proxy exposes.", {}, async () => {
  try {
    const r = await api("/models");
    return ok((r.data || []).map((x) => x.id).join("\n") || JSON.stringify(r));
  } catch (e) { return fail(e); }
});

server.tool(
  "gemini_health",
  "Check proxy is up and the Gemini session is still authenticated (pro must not downgrade to flash).",
  {},
  async () => {
    try {
      const r = await api("/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "gemini-3.1-pro", messages: [{ role: "user", content: "say authenticated-ok" }] }),
      });
      const c = r?.choices?.[0]?.message?.content;
      if (c == null) return ok(`UNHEALTHY: null content. ${FIX}`);
      if (r.model !== "gemini-3.1-pro") return ok(`DEGRADED: asked pro, got ${r.model}. ${FIX}`);
      return ok(`HEALTHY: ${r.model} replied "${String(c).trim()}"`);
    } catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());
