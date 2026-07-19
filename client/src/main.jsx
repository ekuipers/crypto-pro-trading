import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// No <React.StrictMode> here: this app bridges a large amount of legacy
// imperative code (setInterval polling, direct DOM mutation, a
// localStorage-backed Autopilot loop) that was never written to tolerate
// StrictMode's intentional double-invoke-then-cleanup of effects in dev.
createRoot(document.getElementById('root')).render(<App />);
