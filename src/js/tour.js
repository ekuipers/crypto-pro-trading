// ══════════════ QUICK TOUR (Suite roadmap, 2026-08-08) ══════════════
// A short guided walkthrough, launched from the 🚀 Quick Tour button that
// sits just above "Overview" in the ❓ Help panel's left rail. Every step
// targets a DOM id that exists as soon as a tab's static skeleton is mounted
// (client/src/tabIndex.js concatenates every tab's HTML into the document up
// front — .page.active just toggles visibility), so no step ever waits on an
// API call or targets something that only exists after data loads.
const TOUR_STEPS = [
  { targetId: "nav-command", titleKey: "app:tour.step1Title", bodyKey: "app:tour.step1Body" },
  { tab: "command", sub: "command-overview", targetId: "tradingStatus", titleKey: "app:tour.step2Title", bodyKey: "app:tour.step2Body" },
  { tab: "command", sub: "command-overview", targetId: "apToggleBtn", titleKey: "app:tour.step3Title", bodyKey: "app:tour.step3Body" },
  { tab: "command", sub: "manual-trading", targetId: "subtab-manual-trading", titleKey: "app:tour.step4Title", bodyKey: "app:tour.step4Body" },
  { tab: "command", sub: "jobs", targetId: "subtab-jobs", titleKey: "app:tour.step5Title", bodyKey: "app:tour.step5Body" },
  { tab: "signals", targetId: "nav-signals", titleKey: "app:tour.step6Title", bodyKey: "app:tour.step6Body" },
  { tab: "port-overview", targetId: "nav-port-overview", titleKey: "app:tour.step7Title", bodyKey: "app:tour.step7Body" },
  { tab: "analytics", targetId: "nav-analytics", titleKey: "app:tour.step8Title", bodyKey: "app:tour.step8Body" },
  { tab: "settings", targetId: "nav-settings", titleKey: "app:tour.step9Title", bodyKey: "app:tour.step9Body" },
  { targetId: "helpBtn", titleKey: "app:tour.step10Title", bodyKey: "app:tour.step10Body" },
];

let tourIndex = 0;
let tourActive = false;
let tourReturnTab = null;

function tourEls() {
  return {
    backdrop: $("tourBackdrop"),
    spotlight: $("tourSpotlight"),
    card: $("tourCard"),
  };
}

function tourBuildDom() {
  if ($("tourBackdrop")) return;
  const backdrop = document.createElement("div");
  backdrop.id = "tourBackdrop";
  backdrop.className = "tour-backdrop";
  document.body.appendChild(backdrop);

  const spotlight = document.createElement("div");
  spotlight.id = "tourSpotlight";
  spotlight.className = "tour-spotlight";
  document.body.appendChild(spotlight);

  const card = document.createElement("div");
  card.id = "tourCard";
  card.className = "tour-card";
  card.innerHTML =
    '<h4 id="tourCardTitle"></h4>' +
    '<p id="tourCardBody"></p>' +
    '<div class="tour-card-foot">' +
    '<span class="tour-step-count" id="tourStepCount"></span>' +
    '<div class="tour-card-nav">' +
    '<button type="button" class="btn" id="tourPrevBtn"></button>' +
    '<button type="button" class="btn" id="tourSkipBtn"></button>' +
    '<button type="button" class="btn btn-green" id="tourNextBtn"></button>' +
    "</div></div>";
  document.body.appendChild(card);

  $("tourPrevBtn").addEventListener("click", tourPrev);
  $("tourNextBtn").addEventListener("click", tourNext);
  $("tourSkipBtn").addEventListener("click", tourEnd);
}

function tourPositionFor(step) {
  const target = $(step.targetId);
  if (!target) return null;
  const r = target.getBoundingClientRect();
  const pad = 6;
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
}

function tourPositionCard(rect) {
  const card = $("tourCard");
  if (!rect) {
    // Target not found (e.g. narrow viewport hid the sidebar) — center the card.
    card.style.top = "50%";
    card.style.left = "50%";
    card.style.transform = "translate(-50%, -50%)";
    return;
  }
  card.style.transform = "none";
  const cardH = card.offsetHeight || 160;
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  let top = spaceBelow > cardH + 20 ? rect.top + rect.height + 14 : rect.top - cardH - 14;
  top = Math.max(12, Math.min(top, window.innerHeight - cardH - 12));
  let left = rect.left;
  left = Math.max(12, Math.min(left, window.innerWidth - card.offsetWidth - 12));
  card.style.top = top + "px";
  card.style.left = left + "px";
}

function tourRenderStep() {
  const step = TOUR_STEPS[tourIndex];
  if (step.tab) {
    if (activeTab !== step.tab) switchTab(step.tab, $("nav-" + step.tab));
    if (step.sub) commandSubTab(step.sub);
  }

  const rect = tourPositionFor(step);
  const spotlight = $("tourSpotlight");
  if (rect) {
    spotlight.style.display = "block";
    spotlight.style.top = rect.top + "px";
    spotlight.style.left = rect.left + "px";
    spotlight.style.width = rect.width + "px";
    spotlight.style.height = rect.height + "px";
  } else {
    spotlight.style.display = "none";
  }

  $("tourCardTitle").textContent = window.t(step.titleKey);
  $("tourCardBody").textContent = window.t(step.bodyKey);
  $("tourStepCount").textContent = window.t("app:tour.stepOf", { n: tourIndex + 1, total: TOUR_STEPS.length });
  $("tourPrevBtn").textContent = window.t("app:tour.prev");
  $("tourPrevBtn").style.visibility = tourIndex === 0 ? "hidden" : "visible";
  $("tourSkipBtn").textContent = window.t("app:tour.skip");
  $("tourSkipBtn").style.display = tourIndex === TOUR_STEPS.length - 1 ? "none" : "inline-block";
  $("tourNextBtn").textContent = tourIndex === TOUR_STEPS.length - 1 ? window.t("app:tour.finish") : window.t("app:tour.next");

  tourPositionCard(rect);
}

function tourNext() {
  if (tourIndex >= TOUR_STEPS.length - 1) { tourEnd(); return; }
  tourIndex++;
  tourRenderStep();
}

function tourPrev() {
  if (tourIndex === 0) return;
  tourIndex--;
  tourRenderStep();
}

function tourEnd() {
  tourActive = false;
  const { backdrop, spotlight, card } = tourEls();
  if (backdrop) backdrop.style.display = "none";
  if (spotlight) spotlight.style.display = "none";
  if (card) card.style.display = "none";
  window.removeEventListener("resize", tourRenderStep);
  if (tourReturnTab && tourReturnTab !== activeTab) {
    try { switchTab(tourReturnTab, $("nav-" + tourReturnTab)); } catch (e) {}
  }
  tourReturnTab = null;
}

function startTour() {
  toggleManualPanel(false);
  tourBuildDom();
  tourActive = true;
  tourIndex = 0;
  tourReturnTab = activeTab;
  const { backdrop, card } = tourEls();
  backdrop.style.display = "block";
  card.style.display = "block";
  window.addEventListener("resize", tourRenderStep);
  tourRenderStep();
}

function initTour() {
  const btn = $("quickTourBtn");
  if (!btn) return;
  btn.addEventListener("click", startTour);

  document.addEventListener("keydown", (e) => {
    if (!tourActive) return;
    if (e.key === "Escape") tourEnd();
    else if (e.key === "ArrowRight") tourNext();
    else if (e.key === "ArrowLeft") tourPrev();
  });

  // Steps carry their own text via window.t() rather than data-i18n
  // attributes, so a language switch mid-tour needs an explicit re-render —
  // same reasoning as manual.js's own lang-changed listener.
  document.addEventListener("lang-changed", () => {
    if (tourActive) tourRenderStep();
  });
}

initTour();
