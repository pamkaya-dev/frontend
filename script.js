const $ = (id) => document.getElementById(id);
const API = String(window.NURO_CONFIG?.API_BASE_URL || "").trim().replace(/\/+$/, "");
const PLATFORMS = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"]
];
const cache = Object.create(null);
let state = null;
let tab = "video";

const detect = (value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] || "";
  } catch {
    return "";
  }
};

function toast(message, type = "") {
  const box = $("toasts");
  const duplicate = [...box.children].find((item) => item.textContent === message);
  if (duplicate) {
    duplicate.remove();
  }
  while (box.children.length >= 3) box.firstChild.remove();

  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  item.setAttribute("role", "status");
  item.onclick = () => item.remove();
  item._timer = setTimeout(() => item.remove(), 3900);
  box.appendChild(item);
}

function status(message = "", isError = false) {
  const element = $("status");
  element.textContent = message;
  element.classList.toggle("err", isError);
}

function busy(isBusy) {
  $("resolveBtn").disabled = isBusy;
  $("resolveBtn").classList.toggle("loading", isBusy);
  $("skeleton").classList.toggle("hidden", !isBusy);
}

async function api(link, format) {
  if (!API || !/^https:\/\/[^/]+/i.test(API)) {
    throw new Error("Set a valid Railway HTTPS URL in config.js.");
  }

  const key = `${link}|${format}`;
  if (cache[key]) return cache[key];

  let response;
  try {
    const endpoint = `${API}/api/resolve?format=${encodeURIComponent(format)}&url=${encodeURIComponent(link)}`;
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(45000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw new Error("Unable to connect to the server. Check your Railway service and API URL.");
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok || !data.status) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  if (!Array.isArray(data.items)) {
    throw new Error("No downloadable options were found in the server response.");
  }

  cache[key] = data;
  return data;
}

/* Media classification. Explicit image/photo metadata takes priority over a generic "media" label. */
function sourceLooksLikePhoto(link = "") {
  try {
    const url = new URL(link);
    const path = `${url.pathname}${url.search}`.toLowerCase();
    return /\/photo(?:s)?(?:\/|\.php|\?|$)/i.test(path) || /[?&](?:type|media_type)=photo\b/i.test(path);
  } catch {
    return false;
  }
}

function hasTrueFlag(object, keys) {
  return keys.some((key) => object?.[key] === true || object?.[key] === 1 || object?.[key] === "true");
}

function getMediaCategory(item, data = state?.data) {
  const photoFlags = ["isPhoto", "is_photo", "isImage", "is_image", "photo", "image"];
  const videoFlags = ["isVideo", "is_video"];
  const audioFlags = ["isAudio", "is_audio"];

  if (hasTrueFlag(item, photoFlags) || hasTrueFlag(data, photoFlags)) return "photo";
  if (hasTrueFlag(item, audioFlags) || hasTrueFlag(data, audioFlags)) return "audio";
  if (hasTrueFlag(item, videoFlags) || hasTrueFlag(data, videoFlags)) return "video";

  const imageCollections = ["images", "photos", "image_url", "imageUrl", "photo_url", "photoUrl"];
  if (imageCollections.some((key) => {
    const value = item?.[key] ?? data?.[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  })) return "photo";

  const nestedHints = [];
  const collectHints = (object, depth = 0) => {
    if (!object || typeof object !== "object" || depth > 3) return;
    Object.entries(object).forEach(([key, value]) => {
      if (/(mime|type|kind|format|extension|ext|photo|image|video|audio|media|file|label)/i.test(key)) {
        if (typeof value === "string" || typeof value === "number") nestedHints.push(String(value));
        if (value === true) nestedHints.push(key);
      }
      if (value && typeof value === "object" && !Array.isArray(value)) collectHints(value, depth + 1);
    });
  };
  collectHints(item);
  collectHints(data);

  const fields = [
    item?.mediaType, item?.media_type, item?.mimeType, item?.mime_type,
    item?.contentType, item?.content_type, item?.fileType, item?.file_type,
    item?.type, item?.format, item?.extension, item?.ext, item?.label,
    item?.filename, item?.fileName, item?.name, item?.url, item?.proxy,
    data?.mediaType, data?.media_type, data?.mimeType, data?.mime_type,
    data?.contentType, data?.content_type, data?.type, data?.kind,
    ...nestedHints
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();

  if (/(image|photo|picture|jpeg|jpg|png|webp|gif|avif|heic|heif|bmp|tiff)/i.test(fields)) return "photo";
  if (/(audio|mp3|m4a|aac|wav|ogg|flac)/i.test(fields)) return "audio";
  if (/(video|mp4|m4v|mov|webm|mkv|mpeg)/i.test(fields)) return "video";
  if (sourceLooksLikePhoto(state?.link || "")) return "photo";
  return "video";
}

function getFileExtension(item, category = "") {
  // Prefer MIME/extension metadata and actual file URLs over a generic format label.
  const candidates = [item?.mime_type, item?.mimeType, item?.extension, item?.ext, item?.url, item?.proxy, item?.format];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.toLowerCase();
    const mimeMatch = value.match(/(?:image|audio)\/(jpeg|jpg|png|webp|gif|avif|heic|mpeg|mp4|aac|wav|ogg|flac)/);
    if (mimeMatch) {
      const token = mimeMatch[1].toLowerCase();
      const result = token === "jpeg" ? "JPG" : token === "mpeg" ? "MP3" : token === "mp4" ? "M4A" : token.toUpperCase();
      if (category === "photo" && ["MP4", "M4V", "MOV", "WEBM", "MKV", "M4A", "MP3"].includes(result)) continue;
      return result;
    }
    const extensionMatch = value.match(/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff|mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i);
    if (extensionMatch) {
      const extension = extensionMatch[1].toUpperCase();
      if (category === "photo" && ["MP4", "M4V", "MOV", "WEBM", "MKV"].includes(extension)) continue;
      return extension === "JPEG" ? "JPG" : extension;
    }
    if (/^(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|flac|jpe?g|png|webp|gif|avif|heic|heif)$/i.test(value.trim())) {
      const extension = value.trim().toUpperCase();
      if (category === "photo" && ["MP4", "M4V", "MOV", "WEBM", "MKV"].includes(extension)) continue;
      return extension === "JPEG" ? "JPG" : extension;
    }
  }
  return "";
}

function displayFileName(item, category) {
  const rawLabel = typeof item?.label === "string" ? item.label.trim() : "";
  if (category === "photo") return "Photo";
  if (category === "audio") return rawLabel && !/^media$/i.test(rawLabel) ? rawLabel : "Audio";
  return rawLabel && !/^media$/i.test(rawLabel) ? rawLabel : "Video";
}

function displayFileMeta(item, category) {
  const extension = getFileExtension(item, category);
  const quality = item?.quality ? String(item.quality).trim() : "";

  if (category === "photo") {
    const imageFormat = extension && !["MP4", "M4V", "MOV", "WEBM", "MKV"].includes(extension) ? extension : "IMAGE";
    return quality ? `${imageFormat} · ${quality}` : imageFormat;
  }

  const format = extension || (category === "audio" ? "AUDIO" : "MP4");
  return quality ? `${format} · ${quality}` : format;
}

/* ---- Routing: #/ = home, #/video = results ---- */
function route() {
  const showDetail = location.hash === "#/video" && Boolean(state);
  $("home").classList.toggle("hidden", showDetail);
  $("detail").classList.toggle("hidden", !showDetail);
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (showDetail) {
    renderDetail();
    return;
  }

  state = null;
  tab = "video";
  $("videoUrl").value = "";
  $("detected").textContent = "";
  $("clearBtn").classList.add("hidden");
  status("");
  if (location.hash === "#/video") history.replaceState(null, "", "#/");
}
window.addEventListener("hashchange", route);
$("backBtn").onclick = () => {
  if (history.length > 1) history.back();
  else location.hash = "#/";
};

async function resolve() {
  const link = $("videoUrl").value.trim();
  try {
    if (!link) throw new Error("Paste a video or photo link to get started.");

    const platform = detect(link);
    if (!platform) throw new Error("Please use a valid YouTube, Instagram, TikTok or Facebook link.");

    status("");
    busy(true);
    const data = await api(link, "mp4");
    state = { link, platform, data };
    tab = "video";
    location.hash = "#/video";
  } catch (error) {
    toast(error?.message || "Something went wrong. Please try again.", "err");
  } finally {
    busy(false);
  }
}

function renderDetail() {
  if (!state) return;
  const { platform, data } = state;
  loadThumb(data);
  $("plat").textContent = platform.toUpperCase();
  $("title").textContent = data.title || `${platform} media`;
  renderTabs(data);
  renderList(data);
}

function renderTabs(data) {
  const hasPhotos = data.items.some((item) => getMediaCategory(item, data) === "photo");
  const tabDefinitions = [
    { id: "video", label: "Video", visible: true },
    { id: "photo", label: "Photo", visible: hasPhotos },
    { id: "audio", label: "Audio", visible: true }
  ];

  $("tabs").innerHTML = "";
  tabDefinitions.filter((item) => item.visible).forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${tab === item.id ? " active" : ""}`;
    button.dataset.tab = item.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab === item.id));
    button.textContent = item.label;
    $("tabs").appendChild(button);
  });
}

function iconForCategory(category) {
  if (category === "photo") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  }
  if (category === "audio") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>';
}

function renderList(data) {
  const list = $("list");
  const items = data.items.filter((item) => getMediaCategory(item, data) === tab);
  list.innerHTML = "";
  $("resultsCount").textContent = `${items.length} ${items.length === 1 ? "OPTION" : "OPTIONS"}`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = tab === "photo" ? "No photo options were found for this link." : tab === "audio" ? "No audio options are available for this link." : "No video options are available for this link.";
    list.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const category = getMediaCategory(item, data);
    const row = document.createElement("div");
    row.className = "download-row";
    row.style.setProperty("--i", index);

    const info = document.createElement("div");
    info.className = "file-info";

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.innerHTML = iconForCategory(category);

    const copy = document.createElement("span");
    copy.className = "file-copy";
    const name = document.createElement("strong");
    name.textContent = displayFileName(item, category);
    const meta = document.createElement("small");
    meta.textContent = displayFileMeta(item, category);
    copy.append(name, meta);
    info.append(icon, copy);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-btn";
    button.textContent = "Download ↓";
    button.onclick = () => download(item, button);

    row.append(info, button);
    list.appendChild(row);
  });
}

function loadThumb(data) {
  const image = $("thumb");
  const video = $("thumbVid");
  const cover = $("cover");
  const sources = [data.thumbnail_data, data.thumbnail_proxy && makeApiUrl(data.thumbnail_proxy), data.thumbnail].filter(Boolean);

  const fallback = () => {
    image.classList.add("hidden");
    const firstVideo = data.items.find((item) => getMediaCategory(item, data) === "video" && item.proxy);
    if (firstVideo) {
      video.src = `${makeApiUrl(firstVideo.proxy)}#t=0.5`;
      video.classList.remove("hidden");
      video.onerror = () => {
        video.classList.add("hidden");
        cover.classList.add("nothumb");
      };
    } else {
      cover.classList.add("nothumb");
    }
  };

  cover.classList.remove("nothumb");
  video.classList.add("hidden");
  video.removeAttribute("src");
  image.classList.remove("hidden");
  let index = 0;
  image.onerror = () => {
    index += 1;
    if (index < sources.length) image.src = sources[index];
    else fallback();
  };

  if (sources.length) image.src = sources[0];
  else fallback();
}

function makeApiUrl(path) {
  if (!path) return "";
  try {
    return new URL(path, `${API}/`).href;
  } catch {
    return `${API}${String(path).startsWith("/") ? "" : "/"}${path}`;
  }
}

function download(item, button) {
  const destination = item.proxy ? makeApiUrl(item.proxy) : item.url;
  if (!destination) {
    toast("The download link is missing from the server response.", "err");
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = destination;
  anchor.rel = "noopener noreferrer";
  if (!item.proxy) anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  button.textContent = "Started ✓";
  button.classList.add("done");
  toast("Your download has started.", "ok");
  setTimeout(() => {
    button.textContent = "Download ↓";
    button.classList.remove("done");
  }, 2500);
}

$("tabs").addEventListener("click", async (event) => {
  const button = event.target.closest(".tab");
  if (!button || button.dataset.tab === tab || !state) return;

  const previousTab = tab;
  tab = button.dataset.tab;
  let data = state.data;

  try {
    if (state.platform === "YouTube" && tab === "audio") {
      $("tabs").style.opacity = ".55";
      data = await api(state.link, "mp3");
    }
    renderTabs(state.data);
    renderList(data);
  } catch (error) {
    tab = previousTab;
    renderTabs(state.data);
    toast(error?.message || "Unable to load this format.", "err");
  } finally {
    $("tabs").style.opacity = "1";
  }
});

/* Link input */
const input = $("videoUrl");
input.addEventListener("input", () => {
  const platform = detect(input.value.trim());
  $("detected").textContent = platform ? `✓ ${platform} link detected` : "";
  $("clearBtn").classList.toggle("hidden", !input.value);
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") resolve();
});
$("clearBtn").onclick = () => {
  input.value = "";
  input.dispatchEvent(new Event("input"));
  input.focus();
};
$("resolveBtn").onclick = resolve;
$("pasteBtn").onclick = async () => {
  try {
    input.value = (await navigator.clipboard.readText()).trim();
    input.dispatchEvent(new Event("input"));
    if (detect(input.value)) resolve();
    else if (input.value) toast("That clipboard text is not a supported platform link.", "err");
  } catch {
    toast("Clipboard access is unavailable. Paste your link into the field.", "err");
  }
};

/* Appearance: independent light/dark mode and accent color. */
const COLOR_PRESETS = [
  { name: "Teal", color: "#2B7880" },
  { name: "Aqua", color: "#00BFC8" },
  { name: "Blue", color: "#4285F4" },
  { name: "Violet", color: "#8B70E8" },
  { name: "Rose", color: "#E66D91" },
  { name: "Amber", color: "#D79A45" },
  { name: "Mint", color: "#39B88A" }
];
const root = document.documentElement;
const paletteGrid = $("paletteGrid");
const palettePanel = $("palettePanel");
const paletteControl = $("paletteControl");

COLOR_PRESETS.forEach(({ name, color }) => {
  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "palette-swatch";
  swatch.style.setProperty("--swatch", color);
  swatch.dataset.color = color;
  swatch.title = name;
  swatch.setAttribute("aria-label", `${name} accent`);
  swatch.onclick = () => setAccent(color);
  paletteGrid.appendChild(swatch);
});

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function setAccent(color, save = true) {
  if (!validHex(color)) return;
  const normalized = color.toUpperCase();
  root.style.setProperty("--accent-base", normalized);
  $("paletteDot").style.background = normalized;
  $("customColor").value = normalized;

  paletteGrid.querySelectorAll(".palette-swatch").forEach((swatch) => {
    const active = swatch.dataset.color.toUpperCase() === normalized;
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-pressed", String(active));
  });

  if (save) {
    try { localStorage.setItem("nuro-accent-v2", normalized); } catch { /* storage may be disabled */ }
  }
  updateThemeColor();
}

function setMode(mode, save = true) {
  const selectedMode = mode === "light" ? "light" : "dark";
  root.dataset.mode = selectedMode;
  const isDark = selectedMode === "dark";
  $("modeName").textContent = isDark ? "Dark" : "Light";
  $("modeBtn").setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  $("modeBtn").title = `Switch to ${isDark ? "light" : "dark"} mode`;
  $("modeIcon").innerHTML = isDark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>';
  if (save) {
    try { localStorage.setItem("nuro-mode", selectedMode); } catch { /* storage may be disabled */ }
  }
  updateThemeColor();
}

function updateThemeColor() {
  const color = root.dataset.mode === "light" ? "#F4F8F7" : "#080D10";
  document.querySelector('meta[name="theme-color"]').content = color;
}

function setPaletteOpen(open) {
  palettePanel.classList.toggle("hidden", !open);
  $("paletteBtn").setAttribute("aria-expanded", String(open));
}

$("modeBtn").onclick = () => setMode(root.dataset.mode === "dark" ? "light" : "dark");
$("paletteBtn").onclick = (event) => {
  event.stopPropagation();
  setPaletteOpen(palettePanel.classList.contains("hidden"));
};
$("paletteClose").onclick = () => setPaletteOpen(false);
$("customColor").addEventListener("input", (event) => setAccent(event.target.value));
document.addEventListener("click", (event) => {
  if (!event.target.closest("#paletteControl")) setPaletteOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setPaletteOpen(false);
});

let savedAccent = "#00E5FF";
let savedMode = "dark";
try {
  savedAccent = localStorage.getItem("nuro-accent-v2") || savedAccent;
  savedMode = localStorage.getItem("nuro-mode") || savedMode;
} catch { /* use defaults */ }
setAccent(savedAccent, false);
setMode(savedMode, false);
route();


/* ── PREMIUM INTERACTION LAYER ─────────────────────────────────────── */
(() => {
  const progress = $("scrollProgress");
  const topButton = $("backToTop");
  const glow = $("pointerGlow");
  const canvas = $("ambientCanvas");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let scrollTicking = false;
  const updateScrollUI = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const percent = maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0;
    if (progress) progress.style.width = `${percent}%`;
    if (topButton) topButton.classList.toggle("visible", window.scrollY > 420);
    scrollTicking = false;
  };
  window.addEventListener("scroll", () => {
    if (!scrollTicking) {
      requestAnimationFrame(updateScrollUI);
      scrollTicking = true;
    }
  }, { passive: true });
  updateScrollUI();

  topButton?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" }));

  if (!reducedMotion && glow && window.matchMedia("(pointer:fine)").matches) {
    window.addEventListener("pointermove", (event) => {
      glow.style.setProperty("--px", `${event.clientX}px`);
      glow.style.setProperty("--py", `${event.clientY}px`);
      glow.style.opacity = "0.13";
    }, { passive: true });
    document.addEventListener("pointerleave", () => { glow.style.opacity = "0"; });
  }

  /* Lightweight ambient particles: no libraries and no network requests. */
  if (!reducedMotion && canvas) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (ctx) {
      let width = 0, height = 0, particles = [], frame = 0;
      const countForWidth = () => Math.min(54, Math.max(22, Math.floor(window.innerWidth / 25)));
      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        width = window.innerWidth; height = window.innerHeight;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        particles = Array.from({ length: countForWidth() }, () => ({
          x: Math.random() * width, y: Math.random() * height,
          r: Math.random() * 1.7 + .35,
          vx: (Math.random() - .5) * .22,
          vy: (Math.random() - .5) * .2,
          phase: Math.random() * Math.PI * 2
        }));
      };
      const draw = () => {
        ctx.clearRect(0, 0, width, height);
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-base").trim() || "#00E5FF";
        particles.forEach((p, i) => {
          p.x += p.vx; p.y += p.vy; p.phase += .012;
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
          if (p.y < -10) p.y = height + 10;
          if (p.y > height + 10) p.y = -10;
          const alpha = .16 + (Math.sin(p.phase) + 1) * .13;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = accent;
          ctx.globalAlpha = alpha;
          ctx.fill();
          if (i % 3 === 0) {
            const q = particles[(i + 1) % particles.length];
            const dx = p.x - q.x, dy = p.y - q.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 115) {
              ctx.beginPath();
              ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
              ctx.strokeStyle = accent;
              ctx.globalAlpha = (1 - distance / 115) * .075;
              ctx.lineWidth = .7; ctx.stroke();
            }
          }
        });
        ctx.globalAlpha = 1;
        frame = requestAnimationFrame(draw);
      };
      resize();
      draw();
      window.addEventListener("resize", resize, { passive: true });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancelAnimationFrame(frame);
        else if (!frame) draw();
      });
    }
  }

  /* Small entrance reveal for sections as they enter the viewport. */
  if (!reducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12 });
    document.querySelectorAll(".feature-item, .results-heading, .detail-copy").forEach((el) => observer.observe(el));
  }
})();
