import { useTranslation } from 'react-i18next';

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer>
      <span className="footer-name">
        <img src="/favicon.svg" alt="" className="footer-logo-icon" />
        <span className="logo-brand">CryptoPro</span> Trader
      </span>
      <span className="footer-sep">·</span>
      <span>{t('footer.tagline')}</span>
      <span className="footer-sep">·</span>
      {/* Personal-name credit removed 2026-07-30 (workflow rule 33 — no person
          names on web pages). Rule 3's "developer studio as creator name" is
          satisfied by the studio span below, which was always alongside it. */}
      <span className="footer-studio">
        <img src="/studio-logo.png" alt="" className="footer-logo-icon" />
        {t('footer.studio')} <strong>VibeSoft Studio</strong>
      </span>
      <span className="footer-sep">·</span>
      {/* Both stamped at build time by vite.config.js — the date from the build,
          the version from memory.md's newest heading. They were literals here
          and each went stale within a day of being typed. */}
      <span>{t('footer.lastModified')} <strong>{__BUILD_DATE__}</strong></span>
      <span className="footer-sep">·</span>
      <span>{t('footer.version')} <strong>{__APP_VERSION__}</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-disclaimer">{t('footer.disclaimer')}</span>
      <button type="button" className="footer-terms-link" onClick={() => window.openTermsModal()}>{t('footer.terms')}</button>
      <button type="button" className="footer-terms-link" onClick={() => window.openPrivacyModal()}>{t('footer.privacy')}</button>
      <a className="footer-donate" href="https://patreon.com/vibesoftstudio" target="_blank" rel="noopener">{t('footer.donate')}</a>
    </footer>
  );
}
