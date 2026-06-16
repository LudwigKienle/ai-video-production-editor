import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { ContactCard } from './landing/landingSections';

const ContactPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="contact" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Contact</span>
            <h1>Let’s build your next cinematic release.</h1>
            <p>
              Tell us about your campaign, timeline, and creative direction.
              We’ll come back with a tailored production plan.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="mailto:luikienle@gmail.com">Email us</a>
              <a className="btn btn-secondary" href="./portfolio.html">View Portfolio</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Availability</div>
              <ul className="feature-list">
                <li>Berlin · Remote worldwide</li>
                <li>48h response time</li>
                <li>Commercial · Film · AI Production</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section contact-section reveal">
        <div className="section-header">
          <h2>Reach the Studio</h2>
          <p>We collaborate with brands, agencies, and creators worldwide.</p>
        </div>
        <ContactCard />
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<ContactPage />);
}

export default ContactPage;
