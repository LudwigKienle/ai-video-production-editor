import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { ServicesGrid } from './landing/landingSections';

const ServicesPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="services" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Services</span>
            <h1>From concept to final delivery, without friction.</h1>
            <p>
              We combine human creative direction with AI acceleration to ship cinematic
              assets fast. Plug into our studio pipeline or co-create with your team.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="./contact.html">Book a call</a>
              <a className="btn btn-secondary" href="./portfolio.html">View Portfolio</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Delivery Stack</div>
              <ul className="feature-list">
                <li>Strategy & creative direction</li>
                <li>Previs, casting, and shot design</li>
                <li>Editing, grading, and sound</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section reveal">
        <div className="section-header">
          <h2>Service Pillars</h2>
          <p>Everything you need to deliver premium AI video content.</p>
        </div>
        <ServicesGrid />
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<ServicesPage />);
}

export default ServicesPage;
