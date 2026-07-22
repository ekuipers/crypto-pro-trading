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
    btn.title = `Signed in as ${name}`;
  } else {
    btn.innerHTML = '👤 Sign in';
    btn.title = 'Sign in to your CryptoPro Suite account';
  }
}

// One form, two explicit actions — "Create account" and "Sign in" both submit
// the same username/password. No mode toggle, so the visible "Create account"
// button always creates the account (rather than just re-rendering the form).
function openSignInModal() {
  renderAuthView(
    'Sign in to CryptoPro Trader',
    `
    <p class="small" style="color:var(--muted);margin-bottom:12px">New here? Pick a username and password and choose <b>Create account</b>. The same account signs you into every CryptoPro Suite app.</p>
    <div style="margin-bottom:10px"><label>Username</label><input id="authUser" autocomplete="username" placeholder="3-32 letters, digits, . _ -"></div>
    <div style="margin-bottom:10px"><label>Password</label><input id="authPass" type="password" autocomplete="current-password" placeholder="at least 6 characters"></div>
    <div id="authTotpRow" style="display:none;margin-bottom:10px"><label>2FA code</label><input id="authTotp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" maxlength="6"></div>
    <div class="small" id="authErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" id="authRegisterBtn">Create account</button>
     <button class="btn btn-green" id="authLoginBtn">Sign in</button>`,
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
    if (!username || !password) { errEl.textContent = 'Enter a username and password.'; return; }
    busy = true; buttons.forEach(b => (b.disabled = true));
    errEl.textContent = action === 'register' ? 'Creating account…' : 'Signing in…';
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
          errEl.textContent = data.error || 'Enter your 2FA code.';
          reset();
          return;
        }
        errEl.textContent = data.error || (action === 'register' ? 'Could not create account.' : 'Sign-in failed.');
        reset();
        return;
      }
      window.location.reload();
    } catch (e) {
      errEl.textContent = e.name === 'AbortError' ? 'Server did not respond — please try again.' : 'Network error — try again.';
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
    'Change password',
    `
    <div style="margin-bottom:10px"><label>Current password</label><input id="authCpCur" type="password" autocomplete="current-password"></div>
    <div style="margin-bottom:10px"><label>New password</label><input id="authCpNew" type="password" autocomplete="new-password" placeholder="at least 6 characters"></div>
    <div class="small" id="authCpErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" onclick="closeAuthModal()">Cancel</button>
     <button class="btn btn-green" id="authCpSaveBtn">Save</button>`,
  );
  $("authCpSaveBtn").addEventListener('click', async () => {
    const errEl = $("authCpErr");
    const currentPassword = $("authCpCur").value;
    const newPassword = $("authCpNew").value;
    if (!currentPassword || newPassword.length < 6) { errEl.textContent = 'Enter your current password and a new one (6+ chars).'; return; }
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { errEl.textContent = data.error || 'Could not change password.'; return; }
      closeAuthModal();
    } catch { errEl.textContent = 'Network error — try again.'; }
  });
}

function openSetupTotpModal() {
  renderAuthView('Enable 2FA', '<p class="small" style="color:var(--muted)">Loading…</p>', '');
  (async () => {
    let setup;
    try {
      const r = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      setup = await r.json();
      if (!r.ok) throw new Error(setup.error || 'Setup failed');
    } catch (e) {
      renderAuthView('Enable 2FA', `<p class="small" style="color:var(--red)">${authEsc(e.message)}</p>`, '<button class="btn" onclick="closeAuthModal()">Close</button>');
      return;
    }
    renderAuthView(
      'Enable 2FA',
      `
      <p class="small" style="color:var(--muted)">Scan this into any TOTP authenticator app (Google Authenticator, Authy, 1Password…), or enter the secret manually.</p>
      <div style="display:flex;justify-content:center;background:#fff;border-radius:8px;padding:12px;margin:10px 0">${totpQrTag(setup.otpauthUri)}</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;letter-spacing:.08em;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px;text-align:center;margin:10px 0;word-break:break-all">${authEsc(setup.secret)}</div>
      <div style="margin-bottom:10px"><label>Enter the 6-digit code from your app to confirm</label><input id="authTfCode" inputmode="numeric" maxlength="6" placeholder="000000"></div>
      <div class="small" id="authTfErr" style="color:var(--red);min-height:14px"></div>
      `,
      `<button class="btn" onclick="closeAuthModal()">Cancel</button>
       <button class="btn btn-green" id="authTfConfirmBtn">Enable</button>`,
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
        if (!r.ok) { errEl.textContent = data.error || 'Invalid code.'; return; }
        window.location.reload();
      } catch { errEl.textContent = 'Network error — try again.'; }
    });
  })();
}

function openDisableTotpModal() {
  renderAuthView(
    'Disable 2FA',
    `
    <div style="margin-bottom:10px"><label>Confirm your password</label><input id="authDtPass" type="password" autocomplete="current-password"></div>
    <div class="small" id="authDtErr" style="color:var(--red);min-height:14px"></div>
    `,
    `<button class="btn" onclick="closeAuthModal()">Cancel</button>
     <button class="btn btn-red" id="authDtConfirmBtn">Disable</button>`,
  );
  $("authDtConfirmBtn").addEventListener('click', async () => {
    const errEl = $("authDtErr");
    try {
      const r = await fetch('/api/auth/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $("authDtPass").value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { errEl.textContent = data.error || 'Could not disable 2FA.'; return; }
      window.location.reload();
    } catch { errEl.textContent = 'Network error — try again.'; }
  });
}

function openAccountModal(user) {
  const name = user.displayName || user.username;
  renderAuthView(
    'Account',
    `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span class="acct-avatar-fallback" style="width:48px;height:48px;border-radius:50%;font-size:20px">${authEsc(name.charAt(0).toUpperCase())}</span>
      <div>
        <div style="font-weight:900;font-size:15px">${authEsc(name)}</div>
        <div class="small" style="color:var(--muted)">@${authEsc(user.username)}</div>
      </div>
    </div>
    <p class="small" style="color:var(--muted)">This account is shared across every CryptoPro Suite app.</p>
    <div style="margin-bottom:12px">
      <label>Notification email</label>
      <div style="display:flex;gap:8px">
        <input id="authNotifyEmail" type="email" style="flex:1" placeholder="you@example.com" value="${authEsc(user.notificationEmail || '')}">
        <button class="btn" id="authNotifyEmailSaveBtn">Save</button>
      </div>
      <div class="small" id="authNotifyEmailMsg" style="color:var(--muted);min-height:14px"></div>
    </div>
    `,
    `<button class="btn" id="authChangePwBtn">Change password</button>
     <button class="btn" id="authTotpBtn">${user.totpEnabled ? 'Disable 2FA' : 'Enable 2FA'}</button>
     <button class="btn" onclick="closeAuthModal()">Close</button>
     <button class="btn btn-red" id="authLogoutBtn">Sign out</button>`,
  );
  $("authChangePwBtn").addEventListener('click', openChangePasswordModal);
  $("authTotpBtn").addEventListener('click', () => (user.totpEnabled ? openDisableTotpModal() : openSetupTotpModal()));
  $("authNotifyEmailSaveBtn").addEventListener('click', async () => {
    const msgEl = $("authNotifyEmailMsg");
    const email = $("authNotifyEmail").value.trim();
    msgEl.style.color = 'var(--muted)';
    msgEl.textContent = 'Saving…';
    try {
      const r = await fetch('/api/auth/notification-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { msgEl.style.color = 'var(--red)'; msgEl.textContent = data.error || 'Could not save email.'; return; }
      user.notificationEmail = data.notificationEmail;
      if (_authCurrentUser) _authCurrentUser.notificationEmail = data.notificationEmail;
      msgEl.style.color = 'var(--green)';
      msgEl.textContent = 'Saved.';
    } catch { msgEl.style.color = 'var(--red)'; msgEl.textContent = 'Network error — try again.'; }
  });
  $("authLogoutBtn").addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.reload();
  });
}

async function initAuth() {
  const me = await fetchMe();
  _authCurrentUser = me.user;
  renderAccountButton(me.user);
  const btn = $("accountBtn");
  if (btn) btn.addEventListener('click', () => (_authCurrentUser ? openAccountModal(_authCurrentUser) : openSignInModal()));
}

initAuth();
