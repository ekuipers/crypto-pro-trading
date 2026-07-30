// ══════════════ USER MANUAL (roadmap: red ❓ Help button, unfolds from the left) ══════════════
// Static, hand-written reference content — no markdown fetch, no external file.
// Mirrors the pattern CryptoPro Charts uses for its own in-app manual (helpBtn +
// off-canvas #manualPanel + TOC/content/search), ported as a classic global script
// since this project's src/js/*.js files share one scope instead of ES modules.

// Section titles come from the "app" i18n namespace via titleKey + manualTitle()
// (a function call, not a baked string) so they re-translate whenever the
// manual panel is opened/re-rendered after a language switch — unlike a plain
// `title: "Overview"` field, which would freeze at whatever language was
// active when this module-level array was first evaluated. The section
// bodies are translated the same way: `html` is a getter over bodyKey, and the
// prose itself lives in client/src/i18n/locales/app/<lang>.json under
// manual.body<Section> — editing a section means editing all four files.
const MANUAL_SECTIONS = [
  {
    id: "overview",
    titleKey: "app:manual.sectionOverview",
    bodyKey: "app:manual.bodyOverview",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "command",
    titleKey: "app:manual.sectionCommand",
    bodyKey: "app:manual.bodyCommand",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "trade",
    titleKey: "app:manual.sectionTrade",
    bodyKey: "app:manual.bodyTrade",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "portfolio",
    titleKey: "app:manual.sectionPortfolio",
    bodyKey: "app:manual.bodyPortfolio",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "analysis",
    titleKey: "app:manual.sectionAnalysis",
    bodyKey: "app:manual.bodyAnalysis",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "settings",
    titleKey: "app:manual.sectionSettings",
    bodyKey: "app:manual.bodySettings",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "account",
    titleKey: "app:manual.sectionAccount",
    bodyKey: "app:manual.bodyAccount",
    get html() { return window.t(this.bodyKey); },
  },
  {
    id: "shortcuts",
    titleKey: "app:manual.sectionShortcuts",
    bodyKey: "app:manual.bodyShortcuts",
    get html() { return window.t(this.bodyKey); },
  },
];

function manualTitle(section) {
  return window.t(section.titleKey);
}

function manualTocHtml(filter) {
  const q = (filter || "").trim().toLowerCase();
  return MANUAL_SECTIONS
    .filter((s) => !q || manualTitle(s).toLowerCase().includes(q) || s.html.toLowerCase().includes(q))
    .map((s) => `<button type="button" class="manual-toc-btn" data-id="${s.id}">${manualTitle(s)}</button>`)
    .join("");
}

function manualContentHtml(id) {
  const section = MANUAL_SECTIONS.find((s) => s.id === id) || MANUAL_SECTIONS[0];
  return `<h3>${manualTitle(section)}</h3>${section.html}`;
}

function manualSelectSection(id) {
  const content = $("manualContent");
  if (content) content.innerHTML = manualContentHtml(id);
  const buttons = document.querySelectorAll("#manualToc .manual-toc-btn");
  buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.id === id));
}

function manualRenderToc(filter) {
  const toc = $("manualToc");
  if (toc) toc.innerHTML = manualTocHtml(filter);
}

function toggleManualPanel(open) {
  const panel = $("manualPanel");
  if (!panel) return;
  const shouldOpen = open === undefined ? !panel.classList.contains("open") : open;
  panel.classList.toggle("open", shouldOpen);
}

function initManualGuide() {
  const helpBtn = $("helpBtn");
  const panel = $("manualPanel");
  const closeBtn = $("closeManualBtn");
  const search = $("manualSearch");
  if (!helpBtn || !panel) return;

  manualRenderToc("");
  manualSelectSection(MANUAL_SECTIONS[0].id);

  helpBtn.addEventListener("click", () => toggleManualPanel());
  if (closeBtn) closeBtn.addEventListener("click", () => toggleManualPanel(false));

  if (search) {
    search.addEventListener("input", () => manualRenderToc(search.value));
  }

  $("manualToc").addEventListener("click", (e) => {
    const btn = e.target.closest(".manual-toc-btn");
    if (btn) manualSelectSection(btn.dataset.id);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) toggleManualPanel(false);
  });
}

initManualGuide();
