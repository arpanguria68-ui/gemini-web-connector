#!/usr/bin/env node
// Local UI for the gemini-web2api connector. Serves ui/index.html and relays /api/* to the proxy.
// Env: UI_PORT (default 8787), GEMINI_BASE_URL (default http://127.0.0.1:8081/v1)
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.UI_PORT || 8787);
const DEFAULT_BASE = (process.env.GEMINI_BASE_URL || "http://127.0.0.1:8081/v1").replace(/\/+$/, "");
const HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "index.html");
const PROXY_DIR = process.env.PROXY_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "gemini-web2api");
const MCP_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".mcp.json");
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    // block DNS-rebinding: only answer to our own loopback host name
    if (!HOSTS.has(req.headers.host)) return send(res, 403, { error: "bad host" });

    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html"))
      return send(res, 200, await readFile(HTML, "utf8"), "text/html; charset=utf-8");

    // Endpoints for the Gemini Connector extension. Only chrome-extension:// origins; writes need a current key.
    if (["/sync", "/status", "/keys"].includes(req.url)) {
      const origin = req.headers.origin || "";
      if (!origin.startsWith("chrome-extension://")) return send(res, 403, { error: "extension origin required" });
      const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
      const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }); res.end(JSON.stringify(obj)); };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      const cfgPath = path.join(PROXY_DIR, "config.json");
      const loadCfg = async () => { try { return JSON.parse(await readFile(cfgPath, "utf8")); } catch { return null; } };

      // Setup state for onboarding. Never returns a key.
      if (req.url === "/status") {
        const cfg = await loadCfg();
        let synced = false;
        if (cfg) { try { await readFile(path.resolve(PROXY_DIR, cfg.cookie_file || "gemini-auth.json")); synced = true; } catch {} }
        return reply(200, { proxyDir: PROXY_DIR, configFound: Boolean(cfg), keyCount: (cfg?.api_keys || []).length, sessionSynced: synced });
      }
      if (req.method !== "POST") return reply(405, { error: "POST only" });
      try {
        const cfg = await loadCfg();
        if (!cfg) return reply(404, { error: `No config.json in ${PROXY_DIR}. Run: python setup.py` });
        const tok = Buffer.from(String(req.headers["x-sync-token"] || ""));
        const okKey = (cfg.api_keys || []).some((k) => { const b = Buffer.from(String(k)); return b.length === tok.length && timingSafeEqual(b, tok); });
        if (!okKey) return reply(401, { error: "Current key not accepted (use a key from api_keys in config.json)" });
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 200000) return reply(413, { error: "too large" }); chunks.push(c); }
        const d = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

        // Key management: "add" keeps old keys (other browsers/tools keep working), "replace" revokes all others.
        if (req.url === "/keys") {
          if (!["add", "replace"].includes(d.action)) return reply(400, { error: "action must be add or replace" });
          const key = "sk-" + randomBytes(16).toString("hex");
          cfg.api_keys = d.action === "replace" ? [key] : [...(cfg.api_keys || []), key]; // never empty: empty disables auth
          await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
          let mcpNote = "";
          if (d.action === "replace") {
            try {
              const mcp = JSON.parse(await readFile(MCP_FILE, "utf8"));
              mcp.mcpServers["gemini-web2api"].env.GEMINI_API_KEY = key;
              await writeFile(MCP_FILE, JSON.stringify(mcp, null, 2) + "\n");
              mcpNote = " Updated .mcp.json too.";
            } catch {}
          }
          return reply(200, { key, keyCount: cfg.api_keys.length, message: `${d.action === "replace" ? "Replaced all keys" : "Added a key"} (${cfg.api_keys.length} in config.json).${mcpNote} Restart the proxy to apply.` });
        }

        if (typeof d.cookie !== "string" || !d.cookie || typeof d.sapisid !== "string" || typeof d.xsrf_token !== "string")
          return reply(400, { error: "cookie, sapisid, xsrf_token required" });
        const authFile = path.resolve(PROXY_DIR, cfg.cookie_file || "gemini-auth.json");
        await writeFile(authFile, JSON.stringify({ cookie: d.cookie, sapisid: d.sapisid, auth_user: d.auth_user ?? null, xsrf_token: d.xsrf_token, gemini_bl: d.gemini_bl ?? null }, null, 2) + "\n", { mode: 0o600 });
        cfg.xsrf_token = d.xsrf_token;
        if (d.gemini_bl) cfg.gemini_bl = d.gemini_bl;
        cfg.auth_user = d.auth_user ?? null;
        await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
        return reply(200, { message: `Wrote ${path.basename(authFile)} and updated xsrf_token${d.gemini_bl ? ", gemini_bl" : ""} in config.json.` });
      } catch (e) { return reply(500, { error: String(e?.message || e) }); }
    }

    if (req.url === "/api/default-base") return send(res, 200, { base: DEFAULT_BASE });

    if (req.url.startsWith("/api/")) {
      const base = (req.headers["x-target-base"] || DEFAULT_BASE).replace(/\/+$/, "");
      let target;
      try {
        target = new URL(base + req.url.slice(4));
        if (!/^https?:$/.test(target.protocol)) throw 0;
      } catch { return send(res, 400, { error: "invalid base URL" }); }

      const chunks = [];
      for await (const c of req) chunks.push(c);
      const timeout = Math.min(Number(req.headers["x-timeout-ms"]) || 200000, 600000);
      const t0 = Date.now();
      try {
        const up = await fetch(target, {
          method: req.method,
          headers: { "Content-Type": "application/json", Authorization: req.headers.authorization || "" },
          body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
          signal: AbortSignal.timeout(timeout),
        });
        const text = await up.text();
        res.writeHead(up.status, {
          "Content-Type": up.headers.get("content-type") || "application/json",
          "X-Elapsed-Ms": String(Date.now() - t0),
          "Cache-Control": "no-store",
        });
        return res.end(text);
      } catch (e) {
        const refused = e?.cause?.code === "ECONNREFUSED";
        return send(res, 502, {
          error: refused ? `Proxy unreachable at ${base}. Start it: python gemini_web2api.py` : String(e?.message || e),
        });
      }
    }
    send(res, 404, { error: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`UI: http://127.0.0.1:${PORT}`));
