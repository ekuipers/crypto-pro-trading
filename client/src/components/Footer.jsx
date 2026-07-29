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
      <span>{t('footer.creator')} <strong>Erik Kuipers</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-studio">
        <img src="/studio-logo.png" alt="" className="footer-logo-icon" />
        {t('footer.studio')} <strong>VibeSoft Studio</strong>
      </span>
      <span className="footer-sep">·</span>
      <span>{t('footer.lastModified')} <strong>2026-07-29</strong></span>
      <span className="footer-sep">·</span>
      <span>{t('footer.version')} <strong>v2026-07-29.3</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-disclaimer">{t('footer.disclaimer')}</span>
      <button type="button" className="footer-terms-link" onClick={() => window.openTermsModal()}>{t('footer.terms')}</button>
      <a className="footer-donate" href="https://patreon.com/vibesoftstudio" target="_blank" rel="noopener">{t('footer.donate')}</a>
    </footer>
  );
}
