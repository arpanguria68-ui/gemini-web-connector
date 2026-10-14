# gemini-web2api MCP connector

Thin MCP client for a local [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api) proxy
(OpenAI-compatible, `http://localhost:8081/v1`). Does no scraping or auth itself.

## Quick setup (new machine)
`python setup.py` does everything below and prints your key. Sharing with others: see SHARING.md.

## Setup
1. Run proxy per guide (`python gemini_web2api.py`), set `api_keys` in its config.json.
2. `npm install`
3. Add `.mcp.json` entry to Claude (set `GEMINI_API_KEY` to a key from proxy `api_keys`).
   Claude Code: `claude mcp add gemini-web2api -e GEMINI_API_KEY=sk-... -- node "<path-to>/gemini-connector/server.mjs"`

## Tools
- `gemini_chat` prompt, system, model, think (0-4, 0 = deepest), history, temperature
- `gemini_models`
- `gemini_health` detects expired session (HTTP 400 xsrf, pro->flash downgrade, null content)

## Notes
- Session export (`gemini-auth.json`) is a live login. Never commit/share.
- Personal use only. Own agents/prototypes. Account can be flagged; no SLA.
- Token expires: re-export cookies, restart proxy.

## UI
`npm run ui` then open http://127.0.0.1:8787. Tabs: Chat, Settings (base URL, API key, model, thinking, timeout),
Use in other tools (copy-paste snippets), How it works, Disclaimer. Settings stay in browser localStorage.

## Chrome extension (replaces the stock cookie-sync extension)
`extension/` = Gemini Connector side panel: Session (inspect / Sync to proxy / save file), Chat, Settings,
Tools, How it works, Disclaimer. Session logic is forked unchanged from gemini-web2api's cookie-sync extension.
1. chrome://extensions -> Developer mode -> Load unpacked -> `F:\agent ransack\gemini-connector\extension`
2. `npm run ui` (helper; loopback only). Needed for "Sync to proxy" only.
3. Settings: API key = proxy `api_keys` entry. Sync requires that same key, and only accepts chrome-extension:// origins.
4. Session tab -> Sync to proxy -> restart proxy -> Settings -> health check.
