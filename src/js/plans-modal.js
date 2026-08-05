// Plans modal — footer link (Suite roadmap monetization phase 5). Feature
// bullets are static data-i18n markup in modals.html, same idiom as the
// Terms/Privacy modals above them; only #plansCurrentBadge and #plansCta are
// rendered here, because they depend on the caller's plan (fetched fresh from
// /api/me on every open, so a Patreon link completed in another tab shows up
// without a reload).
const PLANS_CONNECT_URL = 'https://cryptoprosuite.com/api/patreon/connect';
const PLANS_PATREON_URL = 'https://www.patreon.com/vibesoftstudio';

function openPlansModal() {
  $("plansModalBackdrop").style.display = "flex";
  renderPlansCta();
}
function closePlansModal() { $("plansModalBackdrop").style.display = "none"; }

async function renderPlansCta() {
  const badge = $("plansCurrentBadge");
  const cta = $("plansCta");
  badge.style.display = "none";
  cta.innerHTML = '';
  let user = null;
  try {
    const r = await fetch('/api/me');
    if (r.ok) ({ user } = await r.json());
  } catch { /* network hiccup — falls through to the signed-out CTA below */ }

  const isPro = !!user && user.plan === 'pro';
  if (isPro) {
    badge.textContent = window.t('modals.plans.currentPro', { defaultValue: "You're on Pro — thank you for supporting CryptoPro." });
    badge.style.display = "";
    cta.innerHTML = `<a class="btn" href="${PLANS_PATREON_URL}" target="_blank" rel="noopener">${window.t('modals.plans.manageBtn', { defaultValue: 'Manage on Patreon' })}</a>`;
    return;
  }

  cta.innerHTML = `
    <a class="btn btn-green" href="${PLANS_PATREON_URL}" target="_blank" rel="noopener">${window.t('modals.plans.upgradeBtn', { defaultValue: 'Upgrade to Pro' })}</a>
    <a class="btn" id="plansConnectBtn" href="${PLANS_CONNECT_URL}">${window.t('modals.plans.connectBtn', { defaultValue: 'Already a patron? Connect your account' })}</a>
  `;
  // Signed out, Suite's connect route just bounces back with signin_required
  // — send them to sign in here instead of a round trip that does nothing.
  if (!user) {
    $("plansConnectBtn").addEventListener('click', (e) => {
      e.preventDefault();
      closePlansModal();
      $("accountBtn")?.click();
    });
  }
}
