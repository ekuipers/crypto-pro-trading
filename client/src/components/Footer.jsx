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
      <span>Last modified: <strong>2026-07-21</strong></span>
      <span className="footer-sep">·</span>
      <span>Version: <strong>v2026-07-21.1</strong></span>
      <a className="footer-donate" href="https://buymeacoffee.com/erikkuipers" target="_blank" rel="noopener">☕ Donate</a>
    </footer>
  );
}
