import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';

const AgbPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Rechtliches</span>
            <h1>Allgemeine Geschaeftsbedingungen (AGB)</h1>
            <p>
              Die folgenden Bedingungen regeln Leistungen, Lieferung und Abrechnung fuer
              Zusammenarbeit mit AI Video Production Editor.
            </p>
          </div>
        </div>
      </header>

      <section className="section reveal legal-copy">
        <div className="section-header">
          <h2>Kurzfassung</h2>
        </div>
        <div className="docs-card">
          <p>Leistungsumfang und Liefertermine werden projektbezogen schriftlich vereinbart.</p>
          <p>Abrechnung erfolgt gemaess Angebot, gebuchtem Paket oder vereinbartem Nutzungsmodell.</p>
          <p>Nutzungsrechte gehen nach vollstaendiger Zahlung in vereinbartem Umfang ueber.</p>
          <p>Details zu Haftung, Gewaehrleistung und Laufzeiten werden im jeweiligen Vertrag festgehalten.</p>
        </div>
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<AgbPage />);
}

export default AgbPage;
