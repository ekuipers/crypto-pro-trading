import { useEffect } from 'react';
import Header from './components/Header.jsx';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import Modals from './components/Modals.jsx';
import { TABS } from './tabIndex.js';
import { loadDashboardScripts } from './scriptLoader.js';

export default function App() {
  // Runs once, after React's first commit — guaranteeing every .page div
  // below is already in the DOM before src/js/main.js's bootstrapDashboard()
  // (the last script loaded) starts querying for them. See scriptLoader.js.
  useEffect(() => {
    loadDashboardScripts();
  }, []);

  return (
    <>
      <Header />
      <div className="layout">
        <Nav />
        <main>
          <div id="globalError" className="error"></div>
          {TABS.map((html, i) => (
            // eslint-disable-next-line react/no-danger
            <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </main>
      </div>
      <Modals />
      <Footer />
    </>
  );
}
