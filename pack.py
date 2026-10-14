#!/usr/bin/env python3
"""Build a shareable zip of the connector kit, with no secrets in it.

Usage:  python pack.py            -> dist/gemini-connector-kit.zip
Includes an allowlist of files only, then scans every file for keys/cookies and aborts if any are found.
"""
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "dist" / "gemini-connector-kit.zip"
INCLUDE = [
    "extension", "ui", "proxy-patch",
    "server.mjs", "ui-server.mjs", "package.json", "package-lock.json",
    "setup.py", "pack.py", "README.md", "SHARING.md", "LICENSE", "NOTICE.md", ".gitignore",
]
# never ship these, whatever the allowlist says
DENY = {".mcp.json", ".env", "config.json", "gemini-auth.json", "node_modules", "dist", "brag-output"}
SECRET = re.compile(
    r"sk-[0-9a-f]{32}"                      # generated proxy keys
    r"|(?:__Secure-[13]PSID|SAPISID|SSID|OSID)=[A-Za-z0-9_\-./]{8,}"  # Google cookies
    r"|\"xsrf_token\"\s*:\s*\"[^\"]{8,}\""  # session token
    r"|g\.a000[A-Za-z0-9_\-]{20,}"          # Google session cookie value
)


def files():
    for name in INCLUDE:
        p = HERE / name
        if not p.exists():
            continue
        for f in ([p] if p.is_file() else sorted(p.rglob("*"))):
            if f.is_file() and not (set(f.relative_to(HERE).parts) & DENY):
                yield f


def main():
    found = list(files())
    leaks = []
    for f in found:
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in SECRET.finditer(text):
            leaks.append(f"{f.relative_to(HERE)}: {m.group(0)[:12]}...")
    if leaks:
        print("ABORTED, possible secrets found (remove them, then rerun):")
        print("\n".join("  " + l for l in leaks))
        sys.exit(1)
    OUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in found:
            z.write(f, Path("gemini-connector") / f.relative_to(HERE))
    print(f"OK: {OUT}  ({len(found)} files, secret scan clean)")


if __name__ == "__main__":
    main()
