import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, setDashLang } from '../i18n/index.js';

const LANGUAGE_LABELS = { en: 'EN', nl: 'NL', fr: 'FR', es: 'ES' };

export default function Header() {
  const { t, i18n } = useTranslation();

  return (
    <header>
      <div className="logo">
        <img src="/favicon.svg" alt="CryptoPro Trader logo" className="logo-icon" />
        <span className="logo-brand">CryptoPro</span> Trader
      </div>

      <div className="header-right">
        <span
          id="modeBadge"
          className="badge paper"
          data-tip={t('header.modeBadgeTip')}
        >
          <span className="dot"></span>
          <select id="setMode" onChange={() => window.onModeChange()} title={t('header.modeSwitchTitle')}>
            <option value="paper">{t('header.modePaper')}</option>
            <option value="live">{t('header.modeLive')}</option>
          </select>
        </span>

        {/* Shown by renderMode() only while Live is selected — live Alpaca
            access is insight-only, no orders and no portfolio management. */}
        <span id="modeReadOnly" className="read-only-badge" style={{ display: 'none' }}>
          {t('header.readOnly')}
        </span>

        <span id="lastUpdated" className="last-updated">{t('header.notLoaded')}</span>

        <button
          className="btn"
          onClick={() => window.generateDailyJournal()}
          data-tip={t('header.dailyJournalTip')}
        >
          {t('header.dailyJournal')}
        </button>
        <button className="btn" onClick={() => window.refreshCurrent()}>{t('header.refresh')}</button>
        <button
          className="btn"
          id="autoRefreshBtn"
          onClick={() => window.toggleAutoRefresh()}
          data-tip={t('header.autoRefreshTip')}
          style={{ color: 'var(--muted)' }}
        >
          {t('header.autoOff')}
        </button>
        <select
          className="theme-btn lang-switcher"
          value={i18n.language}
          onChange={(e) => setDashLang(e.target.value)}
          title={t('header.languageTitle')}
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>{LANGUAGE_LABELS[lng]}</option>
          ))}
        </select>
        <button className="theme-btn" id="helpBtn" title={t('header.helpTitle')}>❓</button>
        <button className="theme-btn" id="themeBtn" onClick={() => window.toggleTheme()} title={t('header.themeTitle')}>🌙</button>
        {/* Hidden until src/js/auth.js's initAuth() knows the caller's plan
            (hidden for Pro, shown otherwise) — a footer link alone wasn't
            visible enough to attract an upgrade (2026-08-05). */}
        <button id="upgradeBtn" className="btn btn-green" onClick={() => window.openPlansModal()} style={{ display: 'none' }}>
          ⭐ {t('header.upgradeBtn')}
        </button>
        <button id="accountBtn" className="btn acct-btn" title={t('header.signIn')}>{t('header.signIn')}</button>
        <button className="btn btn-green" onClick={() => window.openSettings()}>{t('header.settings')}</button>
      </div>
    </header>
  );
}
