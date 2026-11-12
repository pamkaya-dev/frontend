const $ = (id) => document.getElementById(id);
const API = String(window.NURO_CONFIG?.API_BASE_URL || "").trim().replace(/\/+$/, "");
const PLATFORMS = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"], [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"]
];
const cache = {};
let state = null, tab = "video";

$("issue").textContent = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const detect = (v) => { try { const h = new URL(v).hostname.toLowerCase(); return PLATFORMS.find(([re]) => re.test(h))?.[1] || ""; } catch { return ""; } };
function toast(msg, type = "") {
  const box = $("toasts");
  const dup = [...box.children].find(t => t.textContent === msg);
  if (dup) { clearTimeout(dup._t); dup.style.animation = "none"; dup.offsetWidth; dup.style.animation = ""; dup._t = setTimeout(() => dup.remove(), 3800); return; }
  while (box.children.length >= 3) box.firstChild.remove();   // never more than 3 on screen
  const t = document.createElement("div");
  t.className = `toast ${type}`; t.textContent = msg; t.onclick = () => t.remove();
  t._t = setTimeout(() => t.remove(), 3800);
  box.appendChild(t);
}

function status(msg, err = false) { $("status").textContent = msg; $("status").classList.toggle("err", err); }
function busy(on) { $("resolveBtn").disabled = on; $("resolveBtn").classList.toggle("loading", on); $("skeleton").classList.toggle("hidden", !on); }

async function api(link, format) {
  if (!API || !/^https:\/\/[^/]+/i.test(API)) throw new Error("config.js හි API_BASE_URL එකට Railway HTTPS domain එක දාන්න.");
  const key = `${link}|${format}`;
  if (cache[key]) return cache[key];
  let res;
  try {
    res = await fetch(`${API}/api/resolve?format=${format}&url=${encodeURIComponent(link)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(45000)
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("Server එකෙන් පිළිතුර ලැබීමට වැඩි කාලයක් ගතවුණා. නැවත උත්සාහ කරන්න.");
    throw new Error("Server එකට සම්බන්ධ විය නොහැක. Railway server එක සහ API_BASE_URL පරීක්ෂා කරන්න.");
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error("Server එකෙන් නිවැරදි JSON response එකක් ලැබුණේ නැහැ.");
  if (!res.ok || !data.status) throw new Error(data.error || `Request failed (${res.status})`);
  if (!Array.isArray(data.items)) throw new Error("Server response එකේ download options හමු වුණේ නැහැ.");
  return (cache[key] = data);
}

/* ---- routing: #/ = home, #/video = details page ---- */
function route() {
  const detail = location.hash === "#/video" && state;
  $("home").classList.toggle("hidden", !!detail);
  $("detail").classList.toggle("hidden", !detail);
  window.scrollTo(0, 0);
  if (detail) { renderDetail(); return; }
  // back on home: forget the old link & results
  state = null; tab = "video";
  $("videoUrl").value = ""; $("detected").textContent = ""; $("clearBtn").classList.add("hidden"); status("");
  if (location.hash === "#/video") history.replaceState(null, "", "#/");
  // replay home animations
  document.querySelectorAll("#home .r").forEach(el => { el.style.animation = "none"; el.offsetWidth; el.style.animation = ""; });
}
window.addEventListener("hashchange", route);
$("backBtn").onclick = () => (history.length > 1 ? history.back() : (location.hash = "#/"));

async function resolve() {
  const raw = $("videoUrl").value.trim();
  try {
    if (!raw) throw new Error("Video link එකක් ඇතුළත් කරන්න.");
    const platform = detect(raw);
    if (!platform) throw new Error("YouTube, Instagram, TikTok හෝ Facebook link එකක් භාවිත කරන්න.");
    status(""); busy(true);
    const data = await api(raw, "mp4");
    state = { link: raw, platform, data }; tab = "video";
    location.hash = "#/video";
  } catch (e) { toast(e.message, "err"); }
  finally { busy(false); }
}

function renderDetail() {
  const { platform, data } = state;
  loadThumb(data);
  $("plat").textContent = platform.toUpperCase();
  $("title").textContent = data.title || `${platform} video`;
  renderList(data);
}

function renderList(data) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const items = data.items.filter(i => i.type === tab), list = $("list");
  list.innerHTML = "";
  if (!items.length) { list.innerHTML = '<div class="empty">මෙම වර්ගයට options නැහැ.</div>'; return; }
  items.forEach((it, n) => {
    const row = document.createElement("div"); row.className = "row"; row.style.setProperty("--i", n);
    const info = document.createElement("div"); info.innerHTML = "<b></b><small></small>";
    info.querySelector("b").textContent = it.label || it.format;
    info.querySelector("small").textContent = `${it.format}${it.quality ? " · " + it.quality : ""}`;
    const btn = document.createElement("button"); btn.className = "dl"; btn.textContent = "Download ↓";
    btn.onclick = () => download(it, btn);
    row.append(info, btn); list.appendChild(row);
  });
}

function loadThumb(data) {
  const img = $("thumb"), vid = $("thumbVid"), cover = img.parentElement;
  const srcs = [data.thumbnail_data, data.thumbnail_proxy && API + data.thumbnail_proxy, data.thumbnail].filter(Boolean);
  const fallback = () => {
    img.classList.add("hidden");
    const first = data.items.find(i => i.type === "video" && i.proxy);
    if (first) { vid.src = API + first.proxy + "#t=0.5"; vid.classList.remove("hidden"); vid.onerror = () => { vid.classList.add("hidden"); cover.classList.add("nothumb"); }; }
    else cover.classList.add("nothumb");
  };
  cover.classList.remove("nothumb"); vid.classList.add("hidden"); vid.removeAttribute("src"); img.classList.remove("hidden");
  let n = 0;
  img.onerror = () => (++n < srcs.length ? (img.src = srcs[n]) : fallback());
  srcs.length ? (img.src = srcs[0]) : fallback();
}

function download(it, btn) {
  const a = document.createElement("a");
  a.href = it.proxy ? API + it.proxy : it.url; a.rel = "noopener noreferrer";
  if (!it.proxy) a.target = "_blank";
  document.body.appendChild(a); a.click(); a.remove();
  btn.textContent = "Started ✓"; btn.classList.add("done"); toast("Download ආරම්භ විය.", "ok");
  setTimeout(() => { btn.textContent = "Download ↓"; btn.classList.remove("done"); }, 2500);
}

$("tabs").addEventListener("click", async (e) => {
  const b = e.target.closest(".tab"); if (!b || b.dataset.tab === tab || !state) return;
  const prev = tab; tab = b.dataset.tab;
  try {
    let d = state.data;
    if (state.platform === "YouTube") { $("tabs").style.opacity = .5; d = await api(state.link, tab === "audio" ? "mp3" : "mp4"); }
    renderList(d);
  } catch (err) { tab = prev; toast(err.message, "err"); }
  finally { $("tabs").style.opacity = 1; }
});

const input = $("videoUrl");
input.addEventListener("input", () => {
  const p = detect(input.value.trim());
  $("detected").textContent = p ? `✓ ${p.toUpperCase()}` : "";
  $("clearBtn").classList.toggle("hidden", !input.value);
});
input.addEventListener("keydown", e => { if (e.key === "Enter") resolve(); });
$("clearBtn").onclick = () => { input.value = ""; input.dispatchEvent(new Event("input")); input.focus(); };
$("resolveBtn").onclick = resolve;
$("pasteBtn").onclick = async () => {
  try { input.value = (await navigator.clipboard.readText()).trim(); input.dispatchEvent(new Event("input")); if (detect(input.value)) resolve(); }
  catch { toast("Clipboard access නැහැ. Link එක අතින් paste කරන්න.", "err"); }
};
route();

/* theme picker */
const THEMES = [["cyan", "Ocean", "#00e5ff", "#0099ff", "#041016"], ["gold", "Gold", "#e8c27a", "#d49a3c", "#110c04"], ["violet", "Amethyst", "#a78bfa", "#7c3aed", "#0b0618"], ["rose", "Ruby", "#ff5c8a", "#e11d48", "#140509"], ["green", "Emerald", "#31e89b", "#10b981", "#031109"]];
const swStyle = ([, , a, a2, bg]) => `--k1:${a};--k2:${a2};--kb:${bg}`;
const menu = $("themeMenu");
THEMES.forEach(t => {
  const b = document.createElement("button");
  b.type = "button"; b.dataset.t = t[0]; b.setAttribute("role", "menuitemradio");
  b.innerHTML = `<span class="sw" style="${swStyle(t)}"></span><span class="nm">${t[1]}</span><svg class="ck" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  menu.appendChild(b);
});
function setMenu(open) { menu.classList.toggle("hidden", !open); $("themeBtn").setAttribute("aria-expanded", open); }
function theme(id) {
  const t = THEMES.find(x => x[0] === id) || THEMES[0];
  document.documentElement.dataset.theme = t[0];
  $("themeSw").style.cssText = swStyle(t);
  menu.querySelectorAll("button").forEach(b => { b.classList.toggle("on", b.dataset.t === t[0]); b.setAttribute("aria-checked", b.dataset.t === t[0]); });
  document.querySelector("meta[name=theme-color]").content = t[4];
  try { localStorage.setItem("nuro-theme", t[0]); } catch {}
}
$("themeBtn").onclick = (e) => { e.stopPropagation(); setMenu(menu.classList.contains("hidden")); };
menu.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { theme(b.dataset.t); setMenu(false); } });
document.addEventListener("click", e => { if (!e.target.closest("#theme")) setMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
let saved = "cyan"; try { saved = localStorage.getItem("nuro-theme") || "cyan"; } catch {}
theme(saved);
