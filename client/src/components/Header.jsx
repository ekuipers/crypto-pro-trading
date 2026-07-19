export default function Header() {
  return (
    <header>
      <div className="logo">
        <img
          src="/favicon.svg"
          alt="CryptoPro Trader logo"
          style={{ width: '22px', height: '22px', borderRadius: '6px', verticalAlign: '-5px' }}
        />{' '}
        CryptoPro Trader
      </div>

      <div className="header-right">
        <span
          id="modeBadge"
          className="badge paper"
          data-tip="Active trading mode — switch between paper and live. Paper is safe for testing."
        >
          <span className="dot"></span>
          <select id="setMode" onChange={() => window.onModeChange()} title="Switch active trading mode">
            <option value="paper">Paper Trading</option>
            <option value="live">Live Trading</option>
          </select>
        </span>

        <span id="lastUpdated" className="last-updated">Not loaded</span>

        <button
          className="btn"
          onClick={() => window.generateDailyJournal()}
          data-tip="Generate today's closing journal entry as a downloadable Markdown document"
        >
          📓 Daily Journal
        </button>
        <button className="btn" onClick={() => window.refreshCurrent()}>⟳ Refresh</button>
        <button
          className="btn"
          id="autoRefreshBtn"
          onClick={() => window.toggleAutoRefresh()}
          data-tip="Toggle 60-second auto-refresh. Green = ON."
          style={{ color: 'var(--muted)' }}
        >
          ⟳ Auto OFF
        </button>
        <button className="theme-btn" id="themeBtn" onClick={() => window.toggleTheme()} title="Toggle light / dark theme">🌙</button>
        <button className="btn btn-green" onClick={() => window.openSettings()}>⚙ Settings</button>
      </div>
    </header>
  );
}
