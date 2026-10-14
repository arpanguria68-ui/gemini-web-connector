# Third-party code

Parts of this project derive from [Sophomoresty/gemini-web2api](https://github.com/Sophomoresty/gemini-web2api)
(MIT License, Copyright (c) 2026 its authors):

- `extension/session-core.js`: forked from `gemini-cookie-sync-extension/popup.js` (UI code removed, logic unchanged).
- `proxy-patch/gemini_web2api.patch`: changes to `gemini_web2api.py`, applied by `setup.py` to a clone of that repo.

The proxy itself is not included here; `setup.py` downloads it from the upstream repository at a pinned commit.
This project is not affiliated with or endorsed by Google.
