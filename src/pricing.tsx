import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { PricingGrid } from './landing/landingSections';

const PricingPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="pricing" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Pricing</span>
            <h1>Flexible access for every production stage.</h1>
            <p>
              Start with a trial, go lifetime with BYOK, or scale with hosted credits.
              Pick the setup that fits your workflow.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="./studio.html">Open Billing</a>
              <a className="btn btn-secondary" href="./contact.html">Talk to us</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Included</div>
              <ul className="feature-list">
                <li>Full studio workspace access</li>
                <li>Project templates & presets</li>
                <li>Client delivery toolkit</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section pricing-section reveal">
        <div className="section-header">
          <h2>Plans</h2>
          <p>Transparent pricing, no surprises.</p>
        </div>
        <PricingGrid />
        <div className="pricing-cta">
          <a className="btn btn-primary" href="./studio.html">Open Billing</a>
        </div>
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<PricingPage />);
}

export default PricingPage;
