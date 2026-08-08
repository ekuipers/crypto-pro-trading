// ============================================================
// SETTINGS — SERVER-SIDE TRADING ENGINE (multi-tenant Phase 6)
// ------------------------------------------------------------
// Drives the "☁ Server-Side Trading Engine" panel in the Settings tab:
// per-account Alpaca credentials (encrypted server-side, used by the scheduled
// cron engine). The strategy-override JSON editor that used to live in this
// panel was removed (Suite roadmap: too confusing for beginner traders) —
// `PUT/GET/DELETE /api/strategy-config` (src/strategyConfigRoutes.js) stays
// live server-side, it just has no UI surface here anymore.
//
// Classic global script — no modules, no bundler. Registered in
// client/src/scriptLoader.js's SCRIPT_ORDER. Same conventions as the other
// src/js/*.js dashboard scripts.
//
// Read before editing:
//   * NOTHING here ever holds a stored secret. The API is write-only: it
//     returns metadata (mode, active, last-4 preview) and never a key, secret
//     or ciphertext. The input fields are cleared on success and are never
//     repopulated from a response.
//   * Credentials here are NOT the browser-only Alpaca keys in the panel
//     above. Those live in localStorage and never leave the browser. These go
//     to the server and trade unattended. The panel is styled differently
//     (.engine-panel) precisely so the two are not mistaken for each other.
//   * Every value that reaches innerHTML goes through escapeHtml() — a key
//     preview, an error string and an audit detail are all server-supplied
//     text, and the panel renders them next to a password field.
// ============================================================
(function () {
  "use strict";

  var CRED_URL = "/api/alpaca-credentials";

  // Cached from the last GET so the credential list can be re-rendered (e.g.
  // after a step-up cancel) without another round trip.
  var lastCredentials = [];
  // The action awaiting a password, if any: { run: function(password) }.
  var pendingStepUp = null;

  var $ = function (id) { return document.getElementById(id); };

  // Deliberately NOT utils.js's escapeHtml(): that one escapes & < > only, and
  // this file interpolates into attribute values (placeholder="…") as well as
  // text. An unescaped quote there breaks out of the attribute. Nothing
  // attacker-controlled reaches those positions today, but this panel renders
  // server-supplied strings next to a password field, so the escaper it uses
  // should be safe in every position it is actually used in.
  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  };
  var tr = function (key, fallback) {
    return typeof window.t === "function" ? window.t(key, { defaultValue: fallback }) : fallback;
  };

  // ---- HTTP ---------------------------------------------------------------

  /**
   * Fetch + JSON with the error shape these routes share. Never throws on an
   * HTTP error status — returns {ok:false, status, data} so callers can react
   * to 401/{stepUp:true} without a try/catch around every call.
   */
  function api(url, options) {
    return fetch(url, options || {})
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          return { ok: r.ok, status: r.status, data: data || {} };
        });
      })
      .catch(function (e) {
        return { ok: false, status: 0, data: { error: "Network error: " + (e && e.message ? e.message : e) } };
      });
  }

  var jsonPost = function (url, body, method) {
    return api(url, {
      method: method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  };

  // ---- Banners ------------------------------------------------------------

  function banner(el, kind, text) {
    if (!el) return;
    if (!text) { el.innerHTML = ""; return; }
    el.innerHTML = '<div class="warn-banner' + (kind ? " " + kind : "") +
      '" style="margin-bottom:10px">' + esc(text) + "</div>";
  }

  // ---- Step-up password prompt -------------------------------------------
  // Shown only when the server answers 401 {stepUp:true}. The password is
  // typed into a masked field, sent once with the retried request, and never
  // stored — not in a variable that outlives the call, not in localStorage.

  function askStepUp(message, run) {
    pendingStepUp = { run: run };
    var el = $("engineStepUpEl");
    if (!el) return;
    el.innerHTML =
      '<div class="warn-banner" style="margin-bottom:10px">' +
        "<div>" + esc(message) + "</div>" +
        '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">' +
          '<input id="engineStepUpPw" type="password" autocomplete="current-password" ' +
            'placeholder="' + esc(tr("app:settings.enginePasswordPlaceholder", "Account password")) + '" ' +
            'style="flex:1;min-width:180px;max-width:260px">' +
          '<button class="btn btn-green" id="engineStepUpOk">' +
            esc(tr("app:settings.engineConfirmBtn", "Confirm")) + "</button>" +
          '<button class="btn" id="engineStepUpCancel">' +
            esc(tr("app:settings.engineCancelBtn", "Cancel")) + "</button>" +
        "</div>" +
      "</div>";
    var pw = $("engineStepUpPw");
    $("engineStepUpOk").onclick = submitStepUp;
    $("engineStepUpCancel").onclick = clearStepUp;
    pw.onkeydown = function (e) { if (e.key === "Enter") submitStepUp(); };
    pw.focus();
  }

  function submitStepUp() {
    var pw = $("engineStepUpPw");
    var action = pendingStepUp;
    if (!action || !pw) return;
    var value = pw.value;
    // Clear the field and the pending action before running, so a failed
    // attempt can't be resubmitted by a second click on a stale handler.
    pw.value = "";
    clearStepUp();
    action.run(value);
  }

  function clearStepUp() {
    pendingStepUp = null;
    var el = $("engineStepUpEl");
    if (el) el.innerHTML = "";
  }

  /**
   * Runs `attempt(password)` and, if the server demands step-up, re-prompts
   * and runs it again with the password. `attempt` must return the api()
   * result promise.
   */
  function withStepUp(message, attempt) {
    // Re-prompts on a wrong password. Deliberately does NOT restart the whole
    // flow: a retry must go straight back to the password field, because a
    // fresh password-less attempt would spend a second rate-limit token per
    // try, and the write budget (20/hour/uid) is what bounds password
    // guessing on these routes.
    function prompt(text) {
      askStepUp(text, function (password) {
        attempt(password).then(function (retry) {
          if (retry.status === 401 && retry.data && retry.data.stepUp) {
            prompt(retry.data.error || message);
            return;
          }
          afterCredentialChange(retry);
        });
      });
    }

    return attempt(null).then(function (res) {
      if (res.status === 401 && res.data && res.data.stepUp) {
        prompt(res.data.error || message);
        return null;
      }
      afterCredentialChange(res);
      return res;
    });
  }

  function afterCredentialChange(res) {
    if (!res) return;
    var status = $("engineStatusEl");
    if (!res.ok) {
      banner(status, "err", (res.data && res.data.error) || "Request failed");
      return;
    }
    banner(status, "ok", tr("app:settings.engineSaved", "Saved."));
    engineRefresh();
  }

  // ---- Credential rendering ----------------------------------------------

  function credentialRow(c) {
    var badgeClass = c.active ? "active" : "inactive";
    var badgeText = c.active
      ? tr("app:settings.engineBadgeActive", "In use")
      : tr("app:settings.engineBadgeStored", "Stored");
    // readableHere false => the row was encrypted under a different
    // TRADER_CREDENTIALS_ENC_KEY (another environment). The engine skips that
    // tenant, so saying "connected" alone would be actively misleading.
    if (c.readableHere === false) {
      badgeClass = "broken";
      badgeText = tr("app:settings.engineBadgeUnreadable", "Unreadable here");
    }
    var modeLabel = c.mode === "paper"
      ? tr("app:settings.engineModePaperShort", "Paper")
      : tr("app:settings.engineModeLiveShort", "Live (read-only)");

    // data-* + delegation rather than an inline onclick built by string
    // concatenation: an interpolated onclick is HTML-decoded before it is
    // parsed as JS, so escaping alone does not make that pattern safe.
    var actions = "";
    if (!c.active && c.readableHere !== false) {
      actions += '<button class="btn" data-engine-action="activate" data-mode="' + esc(c.mode) + '">' +
        esc(tr("app:settings.engineUseBtn", "Use this")) + "</button>";
    }
    actions += '<button class="btn btn-red" data-engine-action="disconnect" data-mode="' + esc(c.mode) + '">' +
      esc(tr("app:settings.engineDisconnectBtn", "Disconnect")) + "</button>";

    return '<div class="cred-row">' +
      '<span class="cred-badge ' + badgeClass + '">' + esc(badgeText) + "</span>" +
      '<span class="cred-preview"><b>' + esc(modeLabel) + "</b> · ····" + esc(c.keyPreview || "????") + "</span>" +
      '<span style="flex:1"></span>' +
      '<span style="display:flex;gap:8px">' + actions + "</span>" +
      "</div>";
  }

  /**
   * Wires the per-row buttons after a re-render. The mode is re-checked
   * against the two literals the API accepts, so nothing the DOM happens to
   * hold can widen the set of paths these calls can reach.
   */
  function bindCredentialActions(root) {
    var buttons = root.querySelectorAll("[data-engine-action]");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.onclick = function () {
        var mode = btn.getAttribute("data-mode");
        if (mode !== "paper" && mode !== "live") return;
        if (btn.getAttribute("data-engine-action") === "activate") window.engineActivate(mode);
        else window.engineDisconnect(mode);
      };
    });
  }

  function renderCredentials(data) {
    var listEl = $("engineCredListEl");
    var statusEl = $("engineStatusEl");
    if (!listEl) return;

    lastCredentials = (data && data.credentials) || [];

    if (data && data.configured === false) {
      banner(statusEl, "err", tr(
        "app:settings.engineNotConfigured",
        "Server-side credential storage is not configured on this deployment, so credentials cannot be saved."
      ));
    }

    if (!lastCredentials.length) {
      listEl.innerHTML = '<div class="small" style="color:var(--muted)">' +
        esc(tr("app:settings.engineNoneConnected",
          "No credentials connected. Your scheduled jobs will not run until one is.")) + "</div>";
    } else {
      listEl.innerHTML = lastCredentials.map(credentialRow).join("");
      bindCredentialActions(listEl);
    }

    renderAudit((data && data.audit) || []);
  }

  function renderAudit(rows) {
    var el = $("engineAuditEl");
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="small" style="color:var(--muted)">' +
        esc(tr("app:settings.engineNoAudit", "No changes recorded yet.")) + "</div>";
      return;
    }
    el.innerHTML = rows.map(function (r) {
      var when = r.at ? new Date(r.at).toLocaleString() : "";
      return "<div><time>" + esc(when) + "</time> — " + esc(r.action) +
        (r.mode ? " (" + esc(r.mode) + ")" : "") +
        (r.detail ? " · " + esc(r.detail) : "") + "</div>";
    }).join("");
  }

  // ---- Public actions (called from settings.html) --------------------------

  window.engineRefresh = function () {
    var statusEl = $("engineStatusEl");
    var listEl = $("engineCredListEl");
    if (listEl) listEl.textContent = tr("app:settings.engineLoading", "Loading…");

    api(CRED_URL).then(function (cred) {
      if (cred.status === 401) {
        // Guests see the panel (it is part of the static tab markup) but have
        // nothing to manage — say so plainly instead of showing an error.
        banner(statusEl, "", tr("app:settings.engineSignIn",
          "Sign in to connect credentials for the server-side trading engine."));
        if (listEl) listEl.innerHTML = "";
        var auditEl = $("engineAuditEl");
        if (auditEl) auditEl.innerHTML = "";
        return;
      }
      if (!cred.ok) {
        banner(statusEl, "err", (cred.data && cred.data.error) || "Could not load credentials");
        if (listEl) listEl.innerHTML = "";
        return;
      }
      if (!$("engineStepUpEl") || !pendingStepUp) banner(statusEl, "", "");
      renderCredentials(cred.data);
    });
  };

  window.engineSaveCredential = function () {
    var statusEl = $("engineStatusEl");
    var mode = ($("engineMode") || {}).value || "paper";
    var keyId = (($("engineKeyId") || {}).value || "").trim();
    var secret = (($("engineSecret") || {}).value || "").trim();
    var activate = !!(($("engineActivate") || {}).checked);

    if (!keyId || !secret) {
      banner(statusEl, "err", tr("app:settings.engineNeedBoth", "Enter both the API key id and the secret."));
      return;
    }

    withStepUp(
      tr("app:settings.engineConfirmReplace",
        "You are replacing the credential your scheduled jobs are using. Enter your account password to confirm."),
      function (password) {
        var body = { keyId: keyId, secret: secret, activate: activate };
        if (password) body.password = password;
        return jsonPost(CRED_URL + "/" + encodeURIComponent(mode), body);
      }
    ).then(function (res) {
      // Clear the fields as soon as the value has left the page — on success
      // it is stored, and on failure the user retypes rather than leaving a
      // secret sitting in the DOM.
      if (res && res.ok) {
        if ($("engineKeyId")) $("engineKeyId").value = "";
        if ($("engineSecret")) $("engineSecret").value = "";
      }
    });
  };

  window.engineActivate = function (mode) {
    jsonPost(CRED_URL + "/" + encodeURIComponent(mode) + "/activate", {}).then(afterCredentialChange);
  };

  window.engineDisconnect = function (mode) {
    var msg = tr("app:settings.engineConfirmDisconnect",
      "Disconnecting stops this account's scheduled jobs, including the stop-loss watchdog. Enter your account password to confirm.");
    withStepUp(msg, function (password) {
      return jsonPost(CRED_URL + "/" + encodeURIComponent(mode), password ? { password: password } : {}, "DELETE");
    });
  };

  // Loaded by nav.js's switchTab("settings") hook alongside loadSettingsForm().
  window.loadEngineSettings = window.engineRefresh;
})();
