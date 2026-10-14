# Sharing this kit

## Send this
`dist/gemini-connector-kit.zip`, built with `python pack.py`. The build fails if it finds a key or cookie.

## Never send these (they are yours alone)
| File | Why |
|---|---|
| `gemini-web2api/gemini-auth.json` | Your live Google login. Anyone holding it is signed in as you. |
| `gemini-web2api/config.json` | Your proxy key and your session token (`xsrf_token`). |
| `gemini-connector/.mcp.json`, `.env` | Your proxy key and local paths. |

Don't paste any of them into chats either. If one leaks, sign that session out at
myaccount.google.com → Security → Your devices, then re-sync.

## What the other person does
Needs: Python 3.10+, Node 20+, git, Chrome, their **own** Gemini (Advanced) account.

```
unzip gemini-connector-kit.zip
cd gemini-connector
python setup.py
```
`setup.py` clones the proxy (pinned version), applies our fixes, installs dependencies, makes a fresh
random API key and their own `config.json`, and prints the remaining steps:
start proxy → `npm run ui` → load `extension/` in Chrome → paste key → Sync → restart proxy → health check.

Rerunning `setup.py` is safe. It keeps an existing key unless you pass `--new-key`.

## Rules worth repeating to them
- One person, one Google account, one proxy. Never point several people at one account's proxy:
  the account can get flagged, and they would all be acting as you.
- Personal use, prototypes, own agents only. Anything with real users: official Gemini API.
- It can break whenever Google changes its web app. No support, no SLA.
