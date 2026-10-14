# Gemini Web Connector

Use the Gemini subscription you already pay for as an **OpenAI-compatible endpoint** on your own machine.
A Chrome extension syncs your signed-in Gemini session to a local proxy, and anything that speaks the OpenAI API
(scripts, agents, chat apps, Claude via MCP) can then call it.

**Website:** https://arpanguria68-ui.github.io/gemini-web-connector/

> **Unofficial. Personal use only.** This automates your browser login, not a Google API. Your account can be
> flagged, it can break without notice, and there is no support. For anything with real users, use the official
> [Gemini API](https://ai.google.dev/). Not affiliated with or endorsed by Google.

## What's in the box

| Part | What it does |
|---|---|
| **Chrome extension** (`extension/`) | Side panel with Session (inspect, sync to proxy), Chat, Settings (API keys, health check, model benchmark), Tools (copy-paste snippets), How it works, Disclaimer. Detects first-time setup and guides you. |
| **Local helper** (`ui-server.mjs`) | Loopback-only server. Writes your synced session into the proxy config and manages API keys. Also serves a web UI at `http://127.0.0.1:8787`. |
| **MCP server** (`server.mjs`) | Tools `gemini_chat`, `gemini_models`, `gemini_health` for Claude Code and other MCP clients. |
| **Setup** (`setup.py`) | One command: downloads the proxy at a pinned version, applies our fixes, installs dependencies, creates your own random API key and config. |
| **Proxy patch** (`proxy-patch/`) | Fixes for [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api): non-streaming calls ~100s → ~4–15s, timeouts and retries, build-id auto-refresh, thinking-depth validation. |

## How it works

```
Chrome (signed in to gemini.google.com)
   └─ Gemini Connector extension ── Sync ──► helper :8787 ──► proxy config.json + gemini-auth.json
Your tools / extension chat / MCP ── API key ──► proxy :8081 (/v1/chat/completions) ──► gemini.google.com
```

Gemini's web app sends a cookie, a session id and a rotating security token with every request. The proxy replays
that handshake, so Google sees your login. The API key is a random password for **your local proxy**; Google never sees it.

## Quick start

Needs Python 3.10+, Node 20+, git, Chrome, and your own Gemini account.

```bash
git clone https://github.com/arpanguria68-ui/gemini-web-connector
cd gemini-web-connector
python setup.py                 # prints your API key
```

Then:

1. Start the proxy: `cd ../gemini-web2api && python gemini_web2api.py`
2. Start the helper: `npm run ui`
3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → this repo's `extension/` folder
4. Open the extension (side panel) → **Session** tab → paste your key → sign in at gemini.google.com → **Inspect** → **Sync to proxy**
5. Restart the proxy → **Settings → Run health check**

Use the same `python` for `setup.py` and the proxy (it installs `httpx` into that interpreter).

## Use it from other tools

| Field | Value |
|---|---|
| Base URL | `http://127.0.0.1:8081/v1` |
| API key | your key (from `setup.py`, or `api_keys` in the proxy's `config.json`) |
| Model | `gemini-3.6-flash`, `gemini-3.1-pro`, `gemini-3.5-flash-thinking`, … (`GET /v1/models`) |

```python
from openai import OpenAI
c = OpenAI(base_url="http://127.0.0.1:8081/v1", api_key="sk-...", timeout=120)
print(c.chat.completions.create(model="gemini-3.6-flash",
      messages=[{"role": "user", "content": "hi"}]).choices[0].message.content)
```

Claude Code:
```bash
claude mcp add gemini-web2api -e GEMINI_API_KEY=sk-... -- node "<path-to>/gemini-web-connector/server.mjs"
```

Thinking depth: append `@think=N` (integer 0–4, 0 = deepest) to a model name, or use the `think` field in the extension/MCP tool.

## API keys

- Made by `setup.py` on your computer (`secrets.token_hex(16)`), stored in the proxy's `config.json` → `api_keys`.
- Same key for every browser and tool on **your** computer; each browser stores its own copy (paste once).
- Other people run their own setup and get their own key. Never share yours.
- Extension **Settings → API key**: *Add a key for this browser* (others keep working) or *Replace all keys* (revoke everything, e.g. after a leak). Restart the proxy afterwards; keys load at startup.

## Sharing

`python pack.py` builds `dist/gemini-connector-kit.zip` from an allowlist and aborts if it finds a key or cookie.
See [SHARING.md](SHARING.md). One person, one Google account, one proxy.

**Never share or commit:** `gemini-auth.json` (live Google login), the proxy's `config.json` (key + session token),
`.mcp.json`, `.env`. All are git-ignored.

## Known issues

- **Pro may actually be Flash.** Google now ignores the model number the proxy sends unless a model header is
  present; see upstream [#82](https://github.com/Sophomoresty/gemini-web2api/issues/82). The proxy echoes the
  requested name, so the label can't prove routing. Fix in progress.
- **Chats don't appear in your Gemini history**, even with `temporary_chats: false`.
- Sessions expire. Symptoms: HTTP 400 / xsrf errors or empty replies. Fix: refresh the Gemini tab → Sync → restart proxy.
- Response times vary a lot between runs (a few seconds to ~20s for short prompts).

## Security

- Proxy and helper bind to `127.0.0.1` only. To reach them elsewhere use Tailscale, never a public port.
- The helper only answers `chrome-extension://` origins for session/key endpoints, requires a current API key for
  writes, rejects foreign `Host` headers (DNS rebinding), and never returns keys from its status endpoint.
- If your session leaks: myaccount.google.com → Security → Your devices → sign out that session, then re-sync.

## Credits & license

MIT, see [LICENSE](LICENSE). Built on [Sophomoresty/gemini-web2api](https://github.com/Sophomoresty/gemini-web2api)
(MIT); see [NOTICE.md](NOTICE.md) for derived files. Inspired by NeuraFinity's field guide on running gemini-web2api.
