function tab(id, label, extraStyle) {
  return (
    <button
      className={id === 'command' ? 'tab-btn active' : 'tab-btn'}
      style={extraStyle}
      onClick={(e) => window.switchTab(id, e.currentTarget)}
    >
      {label}
    </button>
  );
}

export default function Nav() {
  return (
    <nav>
      {tab('command', '🧭 Command')}

      <div className="nav-section-label">⚡ Trade</div>
      {tab('signals', '📡 Signals')}
      {tab('scalp', '⚡ Scalping')}
      {tab('market', '🌐 Market')}
      {tab('execution', '🎯 Execution')}

      <div className="nav-section-label">💼 Portfolio</div>
      {tab('port-overview', '📊 Overview')}
      {tab('port-dist', '🥧 Allocation')}
      {tab('risk', '⚠️ Risk')}

      <div className="nav-section-label">📊 Analysis</div>
      {tab('analytics', '🔬 Analytics')}
      {tab('insights', '🧠 Insights')}
      {tab('backtest', '🧪 Backtest vs Live')}
      {tab('markov', '🔗 Markov')}

      {tab('settings', '⚙ Settings', { marginTop: '14px' })}
    </nav>
  );
}
