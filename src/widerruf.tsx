import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';

const WiderrufPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Rechtliches</span>
            <h1>Widerrufsbelehrung</h1>
            <p>
              Hinweise zum Widerrufsrecht fuer Verbraucher gemaess den geltenden gesetzlichen Vorgaben.
            </p>
          </div>
        </div>
      </header>

      <section className="section reveal legal-copy">
        <div className="section-header">
          <h2>Widerrufsrecht</h2>
        </div>
        <div className="docs-card">
          <p>
            Verbraucher haben grundsaetzlich ein 14-taegiges Widerrufsrecht. Bei digitalen Leistungen,
            die auf ausdruecklichen Wunsch vor Ablauf der Frist erbracht wurden, kann das Widerrufsrecht
            gemaess gesetzlicher Regelung vorzeitig erloeschen.
          </p>
          <p>
            Fuer die Ausuebung des Widerrufsrechts reicht eine eindeutige Erklaerung per E-Mail an
            luikienle@gmail.com.
          </p>
        </div>
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<WiderrufPage />);
}

export default WiderrufPage;
