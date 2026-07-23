export default function Footer() {
  return (
    <footer>
      <span className="footer-name">
        <img src="/favicon.svg" alt="" className="footer-logo-icon" />
        <span className="logo-brand">CryptoPro</span> Trader
      </span>
      <span className="footer-sep">·</span>
      <span>Autonomous crypto paper-spot-trading cockpit — signal confluence, ATR sizing, limit orders only, Alpaca API</span>
      <span className="footer-sep">·</span>
      <span>Creator: <strong>Erik Kuipers</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-studio">
        <img src="/studio-logo.png" alt="" className="footer-logo-icon" />
        Developer Studio: <strong>VibeSoft Studio</strong>
      </span>
      <span className="footer-sep">·</span>
      <span>Last modified: <strong>2026-07-23</strong></span>
      <span className="footer-sep">·</span>
      <span>Version: <strong>v2026-07-23.3</strong></span>
      <span className="footer-sep">·</span>
      <span className="footer-disclaimer">⚠ Paper spot trading by default. Live trading can incur real losses — you are solely responsible for that risk.</span>
      <button type="button" className="footer-terms-link" onClick={() => window.openTermsModal()}>Terms of Service</button>
      <a className="footer-donate" href="https://patreon.com/vibesoftstudio" target="_blank" rel="noopener">♥ Support</a>
    </footer>
  );
}
