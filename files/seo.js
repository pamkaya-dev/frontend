(() => {
  const $ = (id) => document.getElementById(id);
  const API = String(window.NURO_CONFIG?.API_BASE_URL || "").trim().replace(/\/+$/, "");
  const STORAGE = { campaigns: "nuro_seo_campaigns_v1", backlinks: "nuro_seo_backlinks_v1" };
  let latestCampaign = "";
  let toastTimer;

  function toast(message, error = false) {
    const box = $("toast");
    box.textContent = message;
    box.classList.toggle("error", error);
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("show"), 2800);
  }
  function readStore(key) {
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { toast("Unable to save. Device storage may be full or disabled.", true); return false; }
  }
  function safeUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ""; }
    catch { return ""; }
  }
  function switchPanel(name) {
    document.querySelectorAll(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${name}`));
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.panel === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function requestAI(payload) {
    if (!API || !/^https:\/\//i.test(API)) throw new Error("Set the Railway HTTPS API URL in config.js first.");
    let response;
    try {
      response = await fetch(`${API}/api/seo/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(65000)
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("AI request took too long. Please try again.");
      throw new Error("Cannot connect to the backend. Check Railway and the API URL.");
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") throw new Error("The backend returned an invalid response.");
    if (!response.ok || !data.status) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function formData(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.site && !safeUrl(data.site)) throw new Error("Enter a valid website URL starting with https://.");
    return data;
  }
  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
  document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => switchPanel(button.dataset.open)));

  document.querySelectorAll("form[data-action]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const action = form.dataset.action;
    const resultId = `${action}Result`;
    const outputId = `${action}Output`;
    let payload;
    try { payload = formData(form); }
    catch (error) { toast(error.message, true); return; }
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "GENERATING…";
    try {
      const result = await requestAI({ action, ...payload });
      $(outputId).textContent = result.text;
      $(resultId).classList.remove("hidden");
      if (action === "campaign") latestCampaign = result.text;
      toast("AI result is ready.");
      $(resultId).scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }));

  document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
    const value = $(button.dataset.copy)?.textContent || "";
    if (!value) return toast("Nothing to copy yet.", true);
    try { await navigator.clipboard.writeText(value); toast("Copied to clipboard."); }
    catch { toast("Clipboard access is unavailable in this browser.", true); }
  }));

  function renderCampaigns() {
    const items = readStore(STORAGE.campaigns);
    $("campaignCount").textContent = `${items.length} saved`;
    const target = $("savedCampaigns");
    target.replaceChildren();
    if (!items.length) { target.textContent = "No saved plans yet."; target.className = "empty-state"; return; }
    target.className = "";
    items.forEach(item => {
      const row = document.createElement("div"); row.className = "record";
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = item.title;
      const meta = document.createElement("small"); meta.textContent = `${item.date} · ${item.text.slice(0, 180)}${item.text.length > 180 ? "…" : ""}`;
      content.append(title, meta);
      const actions = document.createElement("div"); actions.className = "record-actions";
      const copy = document.createElement("button"); copy.className = "subtle-btn"; copy.type = "button"; copy.textContent = "COPY"; copy.addEventListener("click", () => navigator.clipboard?.writeText(item.text).then(() => toast("Plan copied.")).catch(() => toast("Copy failed.", true)));
      const del = document.createElement("button"); del.className = "delete-btn"; del.type = "button"; del.setAttribute("aria-label", "Delete saved campaign"); del.textContent = "×"; del.addEventListener("click", () => { writeStore(STORAGE.campaigns, readStore(STORAGE.campaigns).filter(x => x.id !== item.id)); renderCampaigns(); });
      actions.append(copy, del); row.append(content, actions); target.append(row);
    });
  }
  $("saveCampaign").addEventListener("click", () => {
    if (!latestCampaign) return toast("Generate a campaign plan first.", true);
    const items = readStore(STORAGE.campaigns);
    items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: `SEO Campaign ${items.length + 1}`, date: new Date().toLocaleDateString(), text: latestCampaign });
    if (writeStore(STORAGE.campaigns, items.slice(0, 30))) { renderCampaigns(); toast("Campaign saved on this device."); }
  });

  function renderBacklinks() {
    const items = readStore(STORAGE.backlinks);
    $("backlinkCount").textContent = `${items.length} tracked`;
    const target = $("backlinkList"); target.replaceChildren();
    if (!items.length) { target.textContent = "No backlink records yet."; target.className = "empty-state"; return; }
    target.className = "";
    items.forEach(item => {
      const row = document.createElement("div"); row.className = "record";
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = item.source;
      const meta = document.createElement("small"); meta.textContent = `Target: ${item.target} · Anchor: ${item.anchor || "—"}${item.notes ? ` · ${item.notes}` : ""}`;
      content.append(title, meta);
      const actions = document.createElement("div"); actions.className = "record-actions";
      const status = document.createElement("span"); status.className = "record-status"; status.textContent = item.status;
      const del = document.createElement("button"); del.className = "delete-btn"; del.type = "button"; del.setAttribute("aria-label", "Delete backlink record"); del.textContent = "×"; del.addEventListener("click", () => { writeStore(STORAGE.backlinks, readStore(STORAGE.backlinks).filter(x => x.id !== item.id)); renderBacklinks(); });
      actions.append(status, del); row.append(content, actions); target.append(row);
    });
  }
  $("backlinkForm").addEventListener("submit", event => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries());
    const source = safeUrl(data.source), target = safeUrl(data.target);
    if (!source || !target) return toast("Enter valid HTTPS or HTTP URLs for both pages.", true);
    const items = readStore(STORAGE.backlinks);
    items.unshift({ ...data, source, target, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    if (writeStore(STORAGE.backlinks, items.slice(0, 500))) { form.reset(); renderBacklinks(); toast("Backlink record added locally."); }
  });
  $("exportBacklinks").addEventListener("click", () => {
    const items = readStore(STORAGE.backlinks); if (!items.length) return toast("No records to export.", true);
    const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Source URL", "Target URL", "Anchor", "Status", "Notes"], ...items.map(x => [x.source, x.target, x.anchor, x.status, x.notes])];
    const csv = rows.map(row => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "nuro-backlink-tracker.csv"; link.click(); URL.revokeObjectURL(url);
  });

  async function checkAI() {
    if (!API) { $("aiStatus").textContent = "API URL missing"; return; }
    try {
      const response = await fetch(`${API}/api/seo/health`, { signal: AbortSignal.timeout(9000) });
      const data = await response.json();
      $("aiStatus").textContent = data.aiConfigured ? `Connected · ${data.model}` : "API key required";
      if (!data.aiConfigured) $("aiStatus").style.color = "#ffbd82";
    } catch { $("aiStatus").textContent = "Backend unavailable"; $("aiStatus").style.color = "#ff8c8c"; }
  }
  renderCampaigns(); renderBacklinks(); checkAI();
})();
