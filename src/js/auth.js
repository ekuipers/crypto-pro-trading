// ============================================================
// AUTH (client) — account button + sign-in modal (Suite SSO)
// ------------------------------------------------------------
// Ported from CryptoPro Charts' src/js/auth.js, adapted to this dashboard's
// own modal convention (#authModalBackdrop + .style.display, matching
// trade-modal.js) instead of Charts' generic showModal()/closeModal()
// helpers, which don't exist here. Talks to /api/me, /api/auth/*. Session
// data is scoped server-side via the cookie, so signing in/out is just a
// page reload.
// ============================================================

let _authCurrentUser = null;

// ---- Cross-project SSO handoff (Suite roadmap bug: "sign in to any app
// should sign you in everywhere") ------------------------------------------
// Suite's landing page already mints a ticket on click for its own outbound
// tiles (Suite's src/js/auth.js wireCrossProjectLinks/withSsoTicket), but
// that only covers Suite -> siblings: this dashboard (and Charts, and
// Training) had no UI surface linking to any sibling app at all, so a user
// who signs in here had nowhere to click. The account modal is the one
// thing all four apps already have, so the switcher lives there. The
// server-side ticket issue/consume routes are already symmetric across all
// four apps (src/auth.js's /api/auth/sso-ticket + the ?sso= consume
// middleware) — this is the missing client half for this app.
const SSO_APPS = [
  { url: 'https://cryptoprosuite.com/', label: 'CryptoPro Suite' },
  { url: 'https://charts.cryptoprosuite.com/', label: 'CryptoPro Charts' },
  { url: 'https://training.cryptoprosuite.com/', label: 'CryptoPro Training' },
];

// Mints a single-use ticket and appends it to `url`; on any failure (network
// hiccup, database unavailable) falls back to the plain URL so the
// destination just shows its own sign-in screen instead of the link silently
// doing nothing.
async function withSsoTicket(url) {
  try {
    const r = await fetch('/api/auth/sso-ticket', { method: 'POST' });
    if (!r.ok) return url;
    const { token } = await r.json();
    const u = new URL(url);
    u.searchParams.set('sso', token);
    return u.toString();
  } catch {
    return url;
  }
}

function authEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Renders the otpauth:// URI as a QR image via the vendored qrcode-lib.js
// (global `qrcode`, loaded earlier in scriptLoader.js's SCRIPT_ORDER). Falls
// back to the plain link if the library didn't load.
function totpQrTag(otpauthUri) {
  if (typeof window.qrcode !== 'function') return `<p class="small" style="color:var(--muted)">${authEsc(otpauthUri)}</p>`;
  const qr = window.qrcode(0, 'M');
  qr.addData(otpauthUri);
  qr.make();
  return qr.createImgTag(6, 8, '2FA setup QR code');
}

function openAuthModal() {
  $("authModalBackdrop").style.display = "flex";
}
function closeAuthModal() {
  $("authModalBackdrop").style.display = "none";
}

function renderAuthView(title, bodyHtml, footerHtml) {
  $("authModalBody").innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${authEsc(title)}</div>
      <button class="btn" onclick="closeAuthModal()">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">${footerHtml}</div>
  `;
  openAuthModal();
}

async function fetchMe() {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return { user: null };
    return await r.json();
  } catch {
    return { user: null };
  }
}

function renderAccountButton(user) {
  const btn = $("accountBtn");
  if (!btn) return;
  if (user) {
    const name = user.displayName || user.username;
    btn.innerHTML = `<span class="acct-avatar acct-avatar-fallback">${authEsc(name.charAt(0).toUpperCase())}</span><span class="acct-name">${authEsc(name)}</span>`;
    btn.title = window.t('app:auth.signedInAs', { name });
  } else {
    btn.innerHTML = window.t('header.signIn');
    btn.title = window.t('app:auth.signInTitleAttr');
  }
  // Hide once we know the caller is Pro; default visible otherwise (signed
  // out or free) — a footer link alone wasn't visible enough (2026-08-05).
  const upgradeBtn = $("upgradeBtn");
  if (upgradeBtn) upgradeBtn.style.display = user?.plan === 'pro' ? 'none' : '';
  // Pro-tier indicator (Suite roadmap item 1, 2026-08-05): swap the header
  // logo for the gold PRO badge art once the caller's plan is known.
  const logo = $("brandLogo");
  if (logo) logo.src = user?.plan === 'pro' ? '/cryptoprosuite-tier-pro.png' : '/favicon.svg';
}

// One form, two explicit actions — "Create account" and "Sign in" both submit
// the same username/password. No mode toggle, so the visible "Create account"
// button always creates the account (rather than just re-rendering the form).
function openSignInModal() {
  renderAuthView(
    window.t('app:auth.signInTitle'),
    `
    <p class="small" style="color:var(--muted);margin-bottom:12px">${window.t('app:auth.signInIntroHtml')}</p>
    <div style="margin-bottom:10px"><label>${window.t('app:auth.usernameLabel')}</label><input id="authUser" autocomplete="username" placeholder="${authEsc(window.t('app:auth.usernamePlaceholder'))}"></div>
    <div style="margin-bottom:10px"><label>${window.t('app:auth.passwordLabel')}</label><input id="authPass" type="password" autocomplete="current-password" placeholder="${authEsc(window.t('app:auth.passwordPlaceholder'))}"></div>
    <div id="authTotpRow" style="display:none;margin-bottom:10px"><label>${window.t('app:auth.totpLabel')}</label><input id="authTotp" inputmode="numeric" autocomplete="one-time-code" placeholder="${authEsc(window.t('app:auth.totpPlaceholder'))}" maxlength="6"></div>
    <div class="small" id="authErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" id="authRegisterBtn">${window.t('app:auth.createAccountBtn')}</button>
     <button class="btn btn-green" id="authLoginBtn">${window.t('app:auth.signInBtn')}</button>`,
  );

  const userEl = $("authUser");
  const passEl = $("authPass");
  const totpRow = $("authTotpRow");
  const totpEl = $("authTotp");
  const errEl = $("authErr");
  const buttons = [$("authRegisterBtn"), $("authLoginBtn")];
  userEl.focus();

  let busy = false;
  const go = async (action) => {
    if (busy) return;
    const username = userEl.value.trim();
    const password = passEl.value;
    if (!username || !password) { errEl.textContent = window.t('app:auth.errEnterBoth'); return; }
    busy = true; buttons.forEach(b => (b.disabled = true));
    errEl.textContent = action === 'register' ? window.t('app:auth.creatingAccount') : window.t('app:auth.signingIn');
    const reset = () => { busy = false; buttons.forEach(b => (b.disabled = false)); };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const body = { username, password };
      if (action === 'login' && totpRow.style.display !== 'none') body.totpCode = totpEl.value.trim();
      const r = await fetch(`/api/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (data.requiresTotp) {
          totpRow.style.display = '';
          totpEl.focus();
          errEl.textContent = data.error || window.t('app:auth.enter2faCode');
          reset();
          return;
        }
        errEl.textContent = data.error || (action === 'register' ? window.t('app:auth.couldNotCreateAccount') : window.t('app:auth.signInFailed'));
        reset();
        return;
      }
      window.location.reload();
    } catch (e) {
      errEl.textContent = e.name === 'AbortError' ? window.t('app:auth.serverNoResponse') : window.t('app:auth.networkError');
      reset();
    } finally {
      clearTimeout(timer);
    }
  };
  $("authRegisterBtn").addEventListener('click', () => go('register'));
  $("authLoginBtn").addEventListener('click', () => go('login'));
  totpEl.addEventListener('keydown', e => { if (e.key === 'Enter') go('login'); });
  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') go('login'); });
}

function openChangePasswordModal() {
  renderAuthView(
    window.t('app:auth.changePasswordTitle'),
    `
    <div style="margin-bottom:10px"><label>${window.t('app:auth.currentPasswordLabel')}</label><input id="authCpCur" type="password" autocomplete="current-password"></div>
    <div style="margin-bottom:10px"><label>${window.t('app:auth.newPasswordLabel')}</label><input id="authCpNew" type="password" autocomplete="new-password" placeholder="${authEsc(window.t('app:auth.newPasswordPlaceholder'))}"></div>
    <div class="small" id="authCpErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" onclick="closeAuthModal()">${window.t('app:auth.cancelBtn')}</button>
     <button class="btn btn-green" id="authCpSaveBtn">${window.t('app:auth.saveBtn')}</button>`,
  );
  $("authCpSaveBtn").addEventListener('click', async () => {
    const errEl = $("authCpErr");
    const currentPassword = $("authCpCur").value;
    const newPassword = $("authCpNew").value;
    if (!currentPassword || newPassword.length < 6) { errEl.textContent = window.t('app:auth.errCurrentAndNew'); return; }
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { errEl.textContent = data.error || window.t('app:auth.couldNotChangePassword'); return; }
      closeAuthModal();
    } catch { errEl.textContent = window.t('app:auth.networkError'); }
  });
}

function openSetupTotpModal() {
  renderAuthView(window.t('app:auth.enable2faTitle'), `<p class="small" style="color:var(--muted)">${window.t('app:auth.loadingText')}</p>`, '');
  (async () => {
    let setup;
    try {
      const r = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      setup = await r.json();
      if (!r.ok) throw new Error(setup.error || window.t('app:auth.setupFailed'));
    } catch (e) {
      renderAuthView(window.t('app:auth.enable2faTitle'), `<p class="small" style="color:var(--red)">${authEsc(e.message)}</p>`, `<button class="btn" onclick="closeAuthModal()">${window.t('app:auth.closeBtn')}</button>`);
      return;
    }
    renderAuthView(
      window.t('app:auth.enable2faTitle'),
      `
      <p class="small" style="color:var(--muted)">${window.t('app:auth.enable2faDescHtml')}</p>
      <div style="display:flex;justify-content:center;background:#fff;border-radius:8px;padding:12px;margin:10px 0">${totpQrTag(setup.otpauthUri)}</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;letter-spacing:.08em;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px;text-align:center;margin:10px 0;word-break:break-all">${authEsc(setup.secret)}</div>
      <div style="margin-bottom:10px"><label>${window.t('app:auth.confirmCodeLabel')}</label><input id="authTfCode" inputmode="numeric" maxlength="6" placeholder="${authEsc(window.t('app:auth.confirmCodePlaceholder'))}"></div>
      <div class="small" id="authTfErr" style="color:var(--red);min-height:14px"></div>
      `,
      `<button class="btn" onclick="closeAuthModal()">${window.t('app:auth.cancelBtn')}</button>
       <button class="btn btn-green" id="authTfConfirmBtn">${window.t('app:auth.enableBtn')}</button>`,
    );
    $("authTfCode").focus();
    $("authTfConfirmBtn").addEventListener('click', async () => {
      const errEl = $("authTfErr");
      try {
        const r = await fetch('/api/auth/2fa/enable', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: $("authTfCode").value.trim() }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { errEl.textContent = data.error || window.t('app:auth.invalidCode'); return; }
        window.location.reload();
      } catch { errEl.textContent = window.t('app:auth.networkError'); }
    });
  })();
}

function openDisableTotpModal() {
  renderAuthView(
    window.t('app:auth.disable2faTitle'),
    `
    <div style="margin-bottom:10px"><label>${window.t('app:auth.confirmPasswordLabel')}</label><input id="authDtPass" type="password" autocomplete="current-password"></div>
    <div class="small" id="authDtErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" onclick="closeAuthModal()">${window.t('app:auth.cancelBtn')}</button>
     <button class="btn btn-red" id="authDtConfirmBtn">${window.t('app:auth.disableBtn')}</button>`,
  );
  $("authDtConfirmBtn").addEventListener('click', async () => {
    const errEl = $("authDtErr");
    try {
      const r = await fetch('/api/auth/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $("authDtPass").value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { errEl.textContent = data.error || window.t('app:auth.couldNotDisable2fa'); return; }
      window.location.reload();
    } catch { errEl.textContent = window.t('app:auth.networkError'); }
  });
}

function openAccountModal(user) {
  const name = user.displayName || user.username;
  renderAuthView(
    window.t('app:auth.accountTitle'),
    `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span class="acct-avatar-fallback" style="width:48px;height:48px;border-radius:50%;font-size:20px">${authEsc(name.charAt(0).toUpperCase())}</span>
      <div>
        <div style="font-weight:900;font-size:15px">${authEsc(name)}</div>
        <div class="small" style="color:var(--muted)">@${authEsc(user.username)}</div>
      </div>
    </div>
    <p class="small" style="color:var(--muted)">${window.t('app:auth.sharedAcrossSuite')}</p>
    <div style="margin-bottom:12px">
      <label>${window.t('app:auth.notificationEmailLabel')}</label>
      <div style="display:flex;gap:8px">
        <input id="authNotifyEmail" type="email" style="flex:1" placeholder="${authEsc(window.t('app:auth.notificationEmailPlaceholder'))}" value="${authEsc(user.notificationEmail || '')}">
        <button class="btn" id="authNotifyEmailSaveBtn">${window.t('app:auth.saveBtn')}</button>
      </div>
      <div class="small" id="authNotifyEmailMsg" style="color:var(--muted);min-height:14px"></div>
    </div>
    <div style="margin-bottom:12px">
      <label>${window.t('app:auth.switchApp')}</label>
      <p class="small" style="color:var(--muted);margin:2px 0 6px">${window.t('app:auth.switchAppNote')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${SSO_APPS.map((a, i) => `<button class="btn" data-sso-idx="${i}">${authEsc(a.label)}</button>`).join('')}
      </div>
    </div>
    <div class="danger-zone">
      <div class="danger-zone-title">${window.t('app:auth.dangerZone')}</div>
      <p class="small" style="color:var(--muted)">${window.t('app:auth.deleteAccountBlurb')}</p>
      <button class="btn btn-red" id="authDeleteBtn">${window.t('app:auth.deleteAccountBtn')}</button>
    </div>
    `,
    `<button class="btn" id="authChangePwBtn">${window.t('app:auth.changePasswordBtn')}</button>
     <button class="btn" id="authTotpBtn">${user.totpEnabled ? window.t('app:auth.disable2faBtn') : window.t('app:auth.enable2faBtn')}</button>
     <button class="btn" onclick="closeAuthModal()">${window.t('app:auth.closeBtn')}</button>
     <button class="btn btn-red" id="authLogoutBtn">${window.t('app:auth.signOutBtn')}</button>`,
  );
  $("authDeleteBtn").addEventListener('click', () => openDeleteAccountModal(user));
  $("authChangePwBtn").addEventListener('click', openChangePasswordModal);
  $("authTotpBtn").addEventListener('click', () => (user.totpEnabled ? openDisableTotpModal() : openSetupTotpModal()));
  $("authNotifyEmailSaveBtn").addEventListener('click', async () => {
    const msgEl = $("authNotifyEmailMsg");
    const email = $("authNotifyEmail").value.trim();
    msgEl.style.color = 'var(--muted)';
    msgEl.textContent = window.t('app:auth.savingText');
    try {
      const r = await fetch('/api/auth/notification-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { msgEl.style.color = 'var(--red)'; msgEl.textContent = data.error || window.t('app:auth.couldNotSaveEmail'); return; }
      user.notificationEmail = data.notificationEmail;
      if (_authCurrentUser) _authCurrentUser.notificationEmail = data.notificationEmail;
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = window.t('app:auth.savedText');
    } catch { msgEl.style.color = 'var(--red)'; msgEl.textContent = window.t('app:auth.networkError'); }
  });
  $("authLogoutBtn").addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.reload();
  });
  $("authModalBody").querySelectorAll('[data-sso-idx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      window.location.href = await withSsoTicket(SSO_APPS[Number(btn.dataset.ssoIdx)].url);
    });
  });
}

// ---- Self-service account deletion (Suite roadmap 2026-07-29) -------------
// Three separate confirmations on purpose — password, exact username, and the
// 2FA code when enabled — because this is the one irreversible action in the
// suite and it takes data out of three other apps the user isn't looking at.
// Trader has the most to lose here: a connected Alpaca credential and the
// server-side engine's state go with the account, which the copy says plainly.
function openDeleteAccountModal(user) {
  renderAuthView(
    window.t('app:auth.deleteAccountTitle'),
    `
    <p class="small" style="color:var(--muted)">${window.t('app:auth.deleteAccountWarn')}</p>
    <div style="margin-bottom:10px">
      <label>${window.t('app:auth.passwordLabel')}</label>
      <input id="authDelPw" type="password" autocomplete="current-password" style="width:100%">
    </div>
    <div style="margin-bottom:10px">
      <label>${window.t('app:auth.confirmUsernameLabel')}</label>
      <input id="authDelUser" type="text" autocomplete="off" style="width:100%" placeholder="${authEsc(user.username)}">
    </div>
    ${user.totpEnabled ? `<div style="margin-bottom:10px">
      <label>${window.t('app:auth.totpLabel')}</label>
      <input id="authDelTotp" type="text" inputmode="numeric" autocomplete="one-time-code" style="width:100%">
    </div>` : ''}
    <div class="small" id="authDelMsg" style="color:var(--muted);min-height:14px"></div>
    `,
    `<button class="btn" id="authDelCancelBtn">${window.t('app:auth.cancelBtn')}</button>
     <button class="btn btn-red" id="authDelConfirmBtn">${window.t('app:auth.deleteAccountBtn')}</button>`,
  );
  $("authDelCancelBtn").addEventListener('click', () => openAccountModal(user));
  $("authDelConfirmBtn").addEventListener('click', async () => {
    const msgEl = $("authDelMsg");
    const btn = $("authDelConfirmBtn");
    msgEl.style.color = 'var(--muted)';
    msgEl.textContent = window.t('app:auth.deletingText');
    btn.disabled = true;
    try {
      const body = {
        password: $("authDelPw").value,
        confirmUsername: $("authDelUser").value,
      };
      const totpEl = $("authDelTotp");
      if (totpEl) body.totpCode = totpEl.value.trim();
      const r = await fetch('/api/auth/delete-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        msgEl.style.color = 'var(--red)';
        msgEl.textContent = data.error || window.t('app:auth.couldNotDeleteAccount');
        btn.disabled = false;
        return;
      }
      // The server cleared the session cookie; a full reload is the simplest
      // way to drop every piece of in-memory signed-in state the dashboard
      // holds (Autopilot state, cached tabs, settings sync).
      alert(window.t('app:auth.deleteScheduledBody'));
      window.location.reload();
    } catch {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = window.t('app:auth.networkError');
      btn.disabled = false;
    }
  });
}

async function initAuth() {
  const me = await fetchMe();
  _authCurrentUser = me.user;
  renderAccountButton(me.user);
  const btn = $("accountBtn");
  if (btn) btn.addEventListener('click', () => (_authCurrentUser ? openAccountModal(_authCurrentUser) : openSignInModal()));

  // #accountBtn is owned by React (Header.jsx renders it with useTranslation),
  // but renderAccountButton() overwrites its innerHTML with the signed-in
  // avatar + username. A language switch makes React re-render the button from
  // its own vdom, which wipes that back to the "Sign in" label. Re-apply ours
  // afterwards — deferred a tick so it lands after React's re-render, not
  // before it. Signed out this is a no-op; signed in it keeps the name.
  document.addEventListener('lang-changed', () => {
    setTimeout(() => renderAccountButton(_authCurrentUser), 0);
  });
}

initAuth();
