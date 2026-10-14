const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FIELDS = ["base", "key", "helper", "model", "think", "timeout", "temp"];
const S = { base: "http://127.0.0.1:8081/v1", key: "", helper: "http://127.0.0.1:8787", model: "gemini-3.1-pro", think: "", timeout: 200, temp: "" };
let history = [], reveal = false;

// ---- storage (chrome.storage.local, falls back to defaults) ----
async function load() {
  try { Object.assign(S, (await chrome.storage.local.get("gc")).gc || {}); } catch {}
  FIELDS.forEach((k) => ($(k).value = S[k] ?? ""));
}
function read() { FIELDS.forEach((k) => (S[k] = $(k).value.trim())); S.base = S.base.replace(/\/+$/, ""); S.helper = S.helper.replace(/\/+$/, ""); }
async function persist() { try { await chrome.storage.local.set({ gc: S }); } catch {} }

// non-loopback hosts need a runtime permission (must run inside a user gesture)
async function ensureHost(url) {
  try {
    const u = new URL(url);
    if (["127.0.0.1", "localhost"].includes(u.hostname)) return true;
    return await chrome.permissions.request({ origins: [`${u.protocol}//${u.host}/*`] });
  } catch { return false; }
}

// ---- tabs ----
$("tabs").onclick = (e) => {
  const t = e.target.dataset?.t; if (!t) return;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b === e.target));
  ["session", "chat", "settings", "tools", "how", "disc"].forEach((s) => $(s).classList.toggle("hide", s !== t));
  if (t === "tools") snips();
};

// ---- proxy calls ----
async function call(path, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(S.base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout((Number(S.timeout) || 200) * 1000),
    });
    const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ok: r.ok, status: r.status, j, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e?.name === "TimeoutError" ? "Timed out. Raise the timeout in Settings." : `Proxy unreachable at ${S.base}. Start it: python gemini_web2api.py`;
    return { ok: false, status: 0, j: { error: msg }, ms: Date.now() - t0 };
  }
}
const errText = (r) => r.j?.error?.message || r.j?.error || r.j?.raw || "HTTP " + r.status;
const modelName = () => S.model + (S.think !== "" && !S.model.includes("@think=") ? "@think=" + S.think : "");

// ---- settings ----
$("showkey").onclick = () => { const k = $("key"); k.type = k.type === "password" ? "text" : "password"; $("showkey").textContent = k.type === "password" ? "Show" : "Hide"; };
$("save").onclick = async () => {
  read();
  const a = await ensureHost(S.base), b = await ensureHost(S.helper);
  await persist();
  $("savemeta").textContent = a && b ? "Saved." : "Saved, but host access was declined for a non-local URL.";
  setTimeout(() => ($("savemeta").textContent = ""), 3000);
};
$("refresh").onclick = async () => {
  read(); $("savemeta").textContent = "Loading...";
  const r = await call("/models");
  if (!r.ok) { $("savemeta").innerHTML = `<span class="bad">${esc(errText(r))}</span>`; return; }
  const ids = (r.j.data || []).map((m) => m.id), cur = $("model").value;
  $("model").innerHTML = ids.map((i) => `<option value="${esc(i)}">${esc(i)}</option>`).join("");
  labelModels();
  $("model").value = ids.includes(cur) ? cur : ids[0];
  $("savemeta").textContent = ids.length + " models.";
};
$("test").onclick = async () => {
  read(); const b = $("test"); b.disabled = true;
  $("health").innerHTML = '<p class="meta">Testing... can take a couple of minutes.</p>';
  const pill = (c, t, d) => `<p><span class="pill ${c}">${t}</span> ${d}</p>`;
  let html = ""; const m = await call("/models");
  html += m.ok ? pill("ok", "Proxy up", (m.j.data || []).length + " models listed") : pill("bad", "Proxy / key problem", esc(errText(m)));
  if (m.ok) {
    const r = await call("/chat/completions", { model: "gemini-3.1-pro", messages: [{ role: "user", content: "say authenticated-ok" }] });
    const c = r.j?.choices?.[0]?.message?.content;
    if (!r.ok) html += pill("bad", "Chat failed", esc(errText(r)) + (/400|xsrf/i.test(errText(r)) ? " Likely expired xsrf token: Sync again, restart proxy." : ""));
    else if (c == null) html += pill("bad", "Unhealthy", "null content: session expired. Sync again.");
    else if (r.j.model !== "gemini-3.1-pro") html += pill("warn", "Degraded", "asked pro, got " + esc(r.j.model) + ". Cookie not honored.");
    else html += pill("ok", "Healthy", `pro replied “${esc(String(c).trim())}” in ${(r.ms / 1000).toFixed(1)}s`);
  }
  $("health").innerHTML = html; b.disabled = false;
};

// ---- model speed benchmark ----
let bench = {}, benchStop = false;
function labelModels() {
  [...$("model").options].forEach((o) => {
    const id = o.dataset.id || (o.dataset.id = o.value);
    o.value = id; // pin value so the label text below doesn't change the model id
    const b = bench[id];
    o.textContent = id + (b ? (b.ok ? ` · ${b.s.toFixed(1)}s` : " · failed") : "");
  });
}
function benchRow(m, time, result, cls = "") {
  let tr = [...$("benchtbl").tBodies[0].rows].find((r) => r.dataset.m === m);
  if (!tr) { tr = $("benchtbl").tBodies[0].insertRow(); tr.dataset.m = m; }
  tr.innerHTML = `<td><code>${esc(m)}</code></td><td>${esc(time)}</td><td class="${cls}">${esc(result)}</td>`;
}
function showBench() {
  const rows = Object.entries(bench);
  if (!rows.length) return;
  $("benchtbl").classList.remove("hide"); $("benchtbl").tBodies[0].innerHTML = "";
  rows.sort((a, b) => (a[1].ok ? a[1].s : 1e9) - (b[1].ok ? b[1].s : 1e9))
    .forEach(([m, b]) => benchRow(m, b.ok ? b.s.toFixed(1) + "s" : "–", b.ok ? "✓ " + b.reply : b.err, b.ok ? "ok" : "bad"));
  const at = rows[0][1].at; if (at) $("benchmeta").textContent = "Last run " + new Date(at).toLocaleString();
}
$("benchstop").onclick = () => { benchStop = true; $("benchmeta").textContent = "Stopping after current model…"; };
$("bench").onclick = async () => {
  read(); if (!S.key) { $("benchmeta").textContent = "Set your API key first."; return; }
  const list = await call("/models");
  if (!list.ok) { $("benchmeta").innerHTML = `<span class="bad">${esc(errText(list))}</span>`; return; }
  const ids = (list.j.data || []).map((m) => m.id);
  benchStop = false; $("bench").disabled = true; $("benchstop").classList.remove("hide");
  $("benchtbl").classList.remove("hide"); $("benchtbl").tBodies[0].innerHTML = "";
  ids.forEach((m) => benchRow(m, "…", "waiting"));
  const fresh = {}, at = Date.now();
  for (const [i, m] of ids.entries()) {
    if (benchStop) break;
    $("benchmeta").textContent = `${i + 1}/${ids.length}: ${m}`;
    benchRow(m, "…", "running");
    const r = await call("/chat/completions", { model: m, messages: [{ role: "user", content: "say authenticated-ok" }] });
    const c = r.j?.choices?.[0]?.message?.content;
    fresh[m] = r.ok && c != null
      ? { ok: true, s: r.ms / 1000, reply: String(c).trim().slice(0, 40), at }
      : { ok: false, err: r.ok ? "null content (session expired?)" : errText(r), at };
    benchRow(m, fresh[m].ok ? fresh[m].s.toFixed(1) + "s" : "–", fresh[m].ok ? "✓ " + fresh[m].reply : fresh[m].err, fresh[m].ok ? "ok" : "bad");
    if (i < ids.length - 1 && !benchStop) await new Promise((res) => setTimeout(res, 2000));
  }
  bench = { ...bench, ...fresh };
  try { await chrome.storage.local.set({ bench }); } catch {}
  showBench(); labelModels();
  $("bench").disabled = false; $("benchstop").classList.add("hide");
  if (benchStop) $("benchmeta").textContent += " (stopped early)";
};

// ---- chat ----
function add(cls, text) { const d = document.createElement("div"); d.className = "msg " + cls; d.textContent = text; $("log").appendChild(d); return d; }
async function send() {
  read(); const p = $("prompt").value.trim(); if (!p) return;
  if (!S.key) { add("a", "Set your API key in Settings first."); return; }
  add("u", p); $("prompt").value = ""; const w = add("a", "..."); $("send").disabled = true;
  const sys = $("sys").value.trim();
  const body = { model: modelName(), messages: [...(sys ? [{ role: "system", content: sys }] : []), ...history, { role: "user", content: p }] };
  if (S.temp !== "") body.temperature = Number(S.temp);
  const r = await call("/chat/completions", body);
  const out = r.j?.choices?.[0]?.message?.content;
  if (r.ok && out != null) {
    w.textContent = out; history.push({ role: "user", content: p }, { role: "assistant", content: out });
    $("chatmeta").textContent = `${r.j.model} · ${(r.ms / 1000).toFixed(1)}s`;
  } else { w.textContent = "Error: " + (r.ok ? "empty content (session likely expired)" : errText(r)); w.classList.add("bad"); }
  $("send").disabled = false;
}
$("send").onclick = send;
$("prompt").onkeydown = (e) => { if (e.ctrlKey && e.key === "Enter") send(); };
$("clear").onclick = () => { history = []; $("log").innerHTML = ""; $("chatmeta").textContent = ""; };

// ---- tool snippets ----
function snips() {
  read();
  const k = reveal ? S.key : S.key ? S.key.slice(0, 5) + "…(hidden)" : "<your-key>";
  document.querySelectorAll(".v-base").forEach((e) => (e.textContent = S.base));
  document.querySelectorAll(".v-key").forEach((e) => (e.textContent = k));
  document.querySelectorAll(".v-model").forEach((e) => (e.textContent = modelName()));
  $("s-py").textContent = `from openai import OpenAI\nc = OpenAI(base_url="${S.base}", api_key="${k}", timeout=${S.timeout || 200})\nprint(c.chat.completions.create(model="${modelName()}",\n  messages=[{"role":"user","content":"hi"}]).choices[0].message.content)`;
  $("s-curl").textContent = `curl ${S.base}/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer ${k}" -d '{"model":"${modelName()}","messages":[{"role":"user","content":"hi"}]}'`;
  $("s-mcp").textContent = `claude mcp add gemini-web2api -e GEMINI_BASE_URL=${S.base} -e GEMINI_API_KEY=${k} -e GEMINI_MODEL=${S.model} -- node "<path-to>/gemini-connector/server.mjs"`;
  $("s-env").textContent = `OPENAI_BASE_URL=${S.base}\nOPENAI_API_KEY=${k}`;
}
$("reveal").onclick = () => { reveal = !reveal; $("reveal").textContent = reveal ? "Hide key" : "Reveal key"; snips(); };
$("copykey").onclick = async () => { read(); try { await navigator.clipboard.writeText(S.key); $("copykey").textContent = "Copied"; setTimeout(() => ($("copykey").textContent = "Copy key"), 1500); } catch {} };

// ---- session (logic from session-core.js, forked from the original extension) ----
const sstatus = (m, c = "") => { $("sstatus").textContent = m; $("sstatus").className = c; };

function tokenAge(xsrf) {
  const ts = Number(String(xsrf || "").split(":")[1]);
  if (!ts) return "unknown age";
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 90 ? `${m} min old` : `${(m / 60).toFixed(1)} h old`;
}
function buildPayload(info) {
  return {
    cookie: buildCookieString(info),
    sapisid: info.selected.get("SAPISID").value,
    auth_user: info.authUser,
    xsrf_token: info.pageMetadata.xsrfToken,
    gemini_bl: info.pageMetadata.geminiBl,
  };
}
async function readyInfo() {
  const info = await buildInspection();
  if (!info.validation.valid || !info.pageMetadata.xsrfToken) throw new Error(inspectionMessage(info));
  return info;
}
function busy(ids, on) { ids.forEach((i) => ($(i).disabled = on)); }

$("open").onclick = () => chrome.tabs.create({ url: "https://gemini.google.com/app" });
$("inspect").onclick = async () => {
  busy(["inspect", "sync", "export"], true); sstatus("Inspecting session and page data…");
  try {
    const info = await buildInspection();
    const ready = info.validation.valid && Boolean(info.pageMetadata.xsrfToken);
    sstatus(inspectionMessage(info) + (info.pageMetadata.xsrfToken ? `\nXSRF token: ${tokenAge(info.pageMetadata.xsrfToken)}` : ""), ready ? "ok" : "warn");
  } catch (e) { sstatus(e?.message || String(e), "warn"); }
  busy(["inspect", "sync", "export"], false);
};
$("export").onclick = async () => {
  busy(["inspect", "sync", "export"], true); sstatus("Reading cookies and XSRF…");
  try {
    const info = await readyInfo();
    await downloadJson("gemini-auth.json", buildPayload(info));
    sstatus("Saved gemini-auth.json. Move it next to the proxy, copy xsrf_token and gemini_bl into config.json, restart the proxy. Never share the file.", "ok");
  } catch (e) { sstatus(e?.message || String(e), "warn"); }
  busy(["inspect", "sync", "export"], false);
};
$("sync").onclick = async () => {
  read(); busy(["inspect", "sync", "export"], true);
  if (!S.key) { sstatus("Add your proxy API key in the box above first (it authorizes the sync).", "warn"); keySetup(); $("key2").focus(); busy(["inspect", "sync", "export"], false); return; }
  if (!(await ensureHost(S.helper))) { sstatus("Host access to the helper URL was declined.", "warn"); busy(["inspect", "sync", "export"], false); return; }
  sstatus("Reading session…");
  try {
    const info = await readyInfo();
    const r = await fetch(S.helper + "/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": S.key },
      body: JSON.stringify(buildPayload(info)),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Helper replied HTTP " + r.status);
    sstatus(`Synced. Token ${tokenAge(info.pageMetadata.xsrfToken)}.\n${j.message}\n\nNow restart the proxy, then run the health check in Settings.`, "ok");
  } catch (e) {
    const m = e?.message || String(e);
    sstatus(/fetch|Failed|abort|Timeout/i.test(m) ? `Helper unreachable at ${S.helper}. Run: npm run ui (in gemini-connector), or use Save file…` : m, "warn");
  }
  busy(["inspect", "sync", "export"], false);
};

// ---- onboarding: work out whether this computer / this browser is new ----
function onboard(kind, title, text, needKey) {
  $("onboard").style.borderColor = kind === "ok" ? "var(--ok)" : kind === "bad" ? "var(--bad)" : "var(--warn)";
  $("ob-title").textContent = title; $("ob-text").textContent = text;
  $("keysetup").classList.toggle("hide", !needKey);
}
async function checkSetup() {
  read(); onboard("", "Checking setup…", "", false);
  let st = null;
  try {
    const r = await fetch(S.helper + "/status", { signal: AbortSignal.timeout(4000) });
    if (r.ok) st = await r.json();
  } catch {}
  if (st?.proxyDir) $("ob-cfg").textContent = st.proxyDir.replace(/\\/g, "/") + "/config.json";
  if (st && !st.configFound)
    return onboard("bad", "New here: this computer isn't set up yet",
      `No proxy config found in ${st.proxyDir}. In the gemini-connector folder run: python setup.py. It installs everything and prints your API key; paste it below.`, true);
  if (!S.key)
    return onboard("warn", st ? `Set up (${st.keyCount} key${st.keyCount === 1 ? "" : "s"}), but this browser has no key yet` : "This browser has no key yet",
      (st ? "" : "Couldn't reach the helper (npm run ui), so setup state is unknown. ") +
      "Keys are saved per browser, so each new browser needs the key once. Paste it below.", true);
  const m = await call("/models");
  if (m.status === 401)
    return onboard("bad", "Saved key was rejected",
      "The proxy doesn't accept this browser's key. It was probably replaced (Settings → Replace all keys) or this is another person's key. Paste your current key from config.json.", true);
  if (!m.ok)
    return onboard("bad", "Proxy not running", `Can't reach ${S.base}. Start it: python gemini_web2api.py (in the gemini-web2api folder).`, false);
  if (st && !st.sessionSynced)
    return onboard("warn", "Connected. Next: sync your Google session", "Sign in at gemini.google.com, refresh, then Inspect → Sync to proxy below, and restart the proxy.", false);
  onboard("ok", "Connected ✓", `Proxy accepts this browser's key${st ? ` (${st.keyCount} key${st.keyCount === 1 ? "" : "s"} on this proxy)` : ""}.`, false);
}
$("recheck").onclick = checkSetup;
$("savekey2").onclick = async () => {
  const k = $("key2").value.trim();
  if (!k) { $("key2").focus(); return; }
  $("key").value = k; read(); await persist(); $("key2").value = "";
  await checkSetup();
};
$("key2").onkeydown = (e) => { if (e.key === "Enter") $("savekey2").click(); };
$("save").addEventListener("click", () => setTimeout(checkSetup, 0));
function keySetup() { $("key2").focus(); checkSetup(); }

// ---- key management (through the helper; needs the current key) ----
async function changeKey(action) {
  read();
  if (!S.key) { $("keyresult").textContent = "Save your current key first; it authorizes the change."; $("keyresult").classList.remove("hide"); return; }
  if (action === "replace" && !confirm("Replace ALL keys?\n\nEvery browser and tool using an old key stops working after the proxy restarts, until you paste the new key there.")) return;
  try {
    const r = await fetch(S.helper + "/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": S.key },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Helper replied HTTP " + r.status);
    $("key").value = j.key; read(); await persist();
    $("keyresult").textContent = `${j.message}\n\nNew key (saved in this browser):\n${j.key}\n\nCopy it now for other tools. Until the proxy restarts, the old key keeps working and the new one is rejected.`;
    $("keyresult").className = "ok";
  } catch (e) {
    const msg = e?.message || String(e);
    $("keyresult").textContent = /fetch|Failed|abort|Timeout/i.test(msg) ? `Helper unreachable at ${S.helper}. Run: npm run ui` : msg;
    $("keyresult").className = "warn";
  }
  $("keyresult").classList.remove("hide");
}
$("addkey").onclick = () => changeKey("add");
$("replacekey").onclick = () => changeKey("replace");

load().then(async () => {
  checkSetup();
  try { bench = (await chrome.storage.local.get("bench")).bench || {}; } catch {}
  labelModels(); $("model").value = S.model; showBench();
});
