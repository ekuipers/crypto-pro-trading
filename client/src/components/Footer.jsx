export default function Footer() {
  return (
    <footer>
      <span className="footer-name">
        <img src="/favicon.svg" alt="" className="footer-logo-icon" />
        <span className="logo-brand">CryptoPro</span> Trader
      </span>
      <span className="footer-sep">·</span>
      <span>Autonomous crypto paper-trading cockpit — signal confluence, ATR sizing, limit orders only, Alpaca API</span>
      <span className="footer-sep">·</span>
      <span>Creator: <strong>Erik Kuipers</strong></span>
      <span className="footer-sep">·</span>
      <span>Last modified: <strong>2026-07-22</strong></span>
      <span className="footer-sep">·</span>
      <span>Version: <strong>v2026-07-22.2</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-disclaimer">⚠ Paper trading by default. Live trading can incur real losses — you are solely responsible for that risk.</span>
      <button type="button" className="footer-terms-link" onClick={() => window.openTermsModal()}>Terms of Service</button>
      <a className="footer-donate" href="https://buymeacoffee.com/erikkuipers" target="_blank" rel="noopener">☕ Donate</a>
    </footer>
  );
}
