import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import i18n from './i18n/index.js';

// No <React.StrictMode> here: this app bridges a large amount of legacy
// imperative code (setInterval polling, direct DOM mutation, a
// localStorage-backed Autopilot loop) that was never written to tolerate
// StrictMode's intentional double-invoke-then-cleanup of effects in dev.
createRoot(document.getElementById('root')).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>
);
