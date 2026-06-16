import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';

const DatenschutzPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Rechtliches</span>
            <h1>Datenschutzerklaerung</h1>
            <p>
              Informationen zur Verarbeitung personenbezogener Daten bei Nutzung dieser Website
              und der zugehoerigen Services.
            </p>
          </div>
        </div>
      </header>

      <section className="section reveal legal-copy">
        <div className="section-header">
          <h2>Grundlagen</h2>
        </div>
        <div className="docs-card">
          <p>Verantwortlich: Ludwig Maximillian Kienle, Gaertnerweg 15, 898081 Ulm, Deutschland.</p>
          <p>Kontakt: luikienle@gmail.com, +49 152 36760377.</p>
          <p>
            Wir verarbeiten Daten nur im erforderlichen Umfang zur Bereitstellung der Website,
            zur Kommunikation und zur Vertragserfuellung.
          </p>
          <p>
            Betroffene Personen haben die gesetzlichen Rechte auf Auskunft, Berichtigung,
            Loeschung, Einschraenkung der Verarbeitung und Widerspruch.
          </p>
        </div>
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<DatenschutzPage />);
}

export default DatenschutzPage;
