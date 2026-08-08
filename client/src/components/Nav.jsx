import { useTranslation } from 'react-i18next';

function tab(id, label, extraStyle) {
  return (
    <button
      id={`nav-${id}`}
      className={id === 'command' ? 'tab-btn active' : 'tab-btn'}
      style={extraStyle}
      onClick={(e) => window.switchTab(id, e.currentTarget)}
    >
      {label}
    </button>
  );
}

export default function Nav() {
  const { t } = useTranslation();

  return (
    <nav>
      {tab('command', t('nav.command'))}

      <div className="nav-section-label">{t('nav.tradeSection')}</div>
      {tab('signals', t('nav.signals'))}
      {tab('scalp', t('nav.scalping'))}
      {tab('market', t('nav.market'))}
      {tab('execution', t('nav.execution'))}

      <div className="nav-section-label">{t('nav.portfolioSection')}</div>
      {tab('port-overview', t('nav.overview'))}
      {tab('port-dist', t('nav.allocation'))}
      {tab('risk', t('nav.risk'))}

      <div className="nav-section-label">{t('nav.analysisSection')}</div>
      {tab('analytics', t('nav.analytics'))}
      {tab('insights', t('nav.insights'))}
      {tab('backtest', t('nav.backtest'))}
      {tab('markov', t('nav.markov'))}

      {tab('settings', t('nav.settings'), { marginTop: '14px' })}
    </nav>
  );
}
