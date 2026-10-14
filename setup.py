#!/usr/bin/env python3
"""One-command setup for the Gemini connector kit.

Creates everything a new person needs on THEIR machine, with THEIR own secrets:
  1. clones gemini-web2api at a pinned commit (skipped if already present)
  2. applies proxy-patch/gemini_web2api.patch (speed + timeout + think fixes)
  3. pip installs httpx
  4. writes the proxy config.json with a fresh random API key (keeps an existing one)
  5. writes .mcp.json and .env for this connector, then npm installs

Usage:  python setup.py [--proxy-dir PATH] [--new-key]
Nothing here contains or copies anyone's Google session. Each person syncs their own.
"""
import argparse
import json
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "https://github.com/Sophomoresty/gemini-web2api"
PINNED = "2bb988bfcbb82a7fab5d2c99aa5560ff40d64f7e"  # version the patch was made against
HERE = Path(__file__).resolve().parent
PATCH = HERE / "proxy-patch" / "gemini_web2api.patch"


def run(cmd, cwd=None, check=True):
    print("  $", " ".join(str(c) for c in cmd))
    return subprocess.run(cmd, cwd=cwd, check=check, capture_output=not check, text=True)


def step(msg):
    print(f"\n== {msg}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy-dir", default=str(HERE.parent / "gemini-web2api"), help="where the proxy lives / will be cloned")
    ap.add_argument("--new-key", action="store_true", help="replace the existing API key with a new random one")
    args = ap.parse_args()
    proxy = Path(args.proxy_dir).resolve()

    for tool in ("git", "node"):
        if not shutil.which(tool):
            sys.exit(f"Missing '{tool}'. Install it and rerun.")

    step(f"Proxy source: {proxy}")
    if not (proxy / "gemini_web2api.py").exists():
        run(["git", "clone", REPO, str(proxy)])
        run(["git", "checkout", "-q", PINNED], cwd=proxy)
    else:
        print("  already present, not re-cloning")

    step("Proxy patch")
    already = run(["git", "apply", "--check", "--reverse", "--ignore-whitespace", str(PATCH)], cwd=proxy, check=False)
    if already.returncode == 0:
        print("  already applied")
    else:
        ok = run(["git", "apply", "--check", "--ignore-whitespace", str(PATCH)], cwd=proxy, check=False)
        if ok.returncode != 0:
            sys.exit("  Patch does not apply (proxy version differs). Use a fresh clone or apply by hand:\n" + ok.stderr)
        run(["git", "apply", "--ignore-whitespace", str(PATCH)], cwd=proxy)

    step("Python dependency")
    run([sys.executable, "-m", "pip", "install", "-q", "httpx>=0.25"])

    step("Proxy config.json (your own, never share it)")
    cfg_path = proxy / "config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        print("  existing config kept")
    else:
        cfg = json.loads((proxy / "config.example.json").read_text(encoding="utf-8"))
        cfg.update({"xsrf_token": None, "auth_user": None})
    keys = [k for k in cfg.get("api_keys") or [] if k and k != "sk-gemini"]
    if args.new_key or not keys:
        keys = ["sk-" + secrets.token_hex(16)]
        print("  generated a new random API key")
    cfg.update({
        "host": "127.0.0.1",  # local only; use Tailscale to reach it elsewhere (never a public port)
        "api_keys": keys,
        "default_model": cfg.get("default_model") or "gemini-3.6-flash",
        "cookie_file": str(proxy / "gemini-auth.json").replace("\\", "/"),
    })
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    key = keys[0]

    step("Connector files")
    (HERE / ".env").write_text(f"PROXY_DIR={proxy.as_posix()}\nGEMINI_BASE_URL=http://127.0.0.1:{cfg.get('port', 8081)}/v1\n", encoding="utf-8")
    mcp = {"mcpServers": {"gemini-web2api": {
        "command": "node",
        "args": [(HERE / "server.mjs").as_posix()],
        "env": {"GEMINI_BASE_URL": f"http://127.0.0.1:{cfg.get('port', 8081)}/v1", "GEMINI_API_KEY": key, "GEMINI_MODEL": "gemini-3.6-flash"},
    }}}
    (HERE / ".mcp.json").write_text(json.dumps(mcp, indent=2) + "\n", encoding="utf-8")
    npm = shutil.which("npm")
    if npm:
        run([npm, "install", "--silent"], cwd=HERE)
    else:
        print("  npm not found: run 'npm install' in this folder later")

    print(f"""
== Done. Your proxy API key: {key}
   (made on this machine; only guards your local proxy. Google never sees it.)

Next:
 1. Start the proxy:        cd "{proxy}" && python gemini_web2api.py
 2. Start the helper:       cd "{HERE}" && npm run ui
 3. Chrome: chrome://extensions -> Developer mode -> Load unpacked -> {(HERE / 'extension')}
 4. Extension Session tab:  paste the key, sign in at gemini.google.com, Inspect, Sync to proxy
 5. Restart the proxy, then Settings -> Run health check
 Claude Code: claude mcp add gemini-web2api -e GEMINI_API_KEY={key} -- node "{(HERE / 'server.mjs').as_posix()}"
""")


if __name__ == "__main__":
    main()
