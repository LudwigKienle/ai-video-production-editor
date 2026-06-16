import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { FaqGrid } from './landing/landingSections';

const FaqPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="faq" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">FAQ</span>
            <h1>Answers to the most common questions.</h1>
            <p>
              Need clarity on keys, models, or storage? Here are the fast answers
              so you can keep creating.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="./contact.html">Reach support</a>
              <a className="btn btn-secondary" href="./docs.html">Read Docs</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Support Channels</div>
              <ul className="feature-list">
                <li>Email support within 24h</li>
                <li>Workflow guides & docs</li>
                <li>Direct studio onboarding</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section faq-section reveal">
        <div className="section-header">
          <h2>Top Questions</h2>
          <p>Clear answers for a smooth production flow.</p>
        </div>
        <FaqGrid />
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<FaqPage />);
}

export default FaqPage;
