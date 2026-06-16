import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { StudioShowcase } from './landing/landingSections';

const SoftwarePage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="software" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Studio Software</span>
            <h1>The full AI production pipeline in one workspace.</h1>
            <p>
              Plan, generate, and refine cinematic content with a toolchain built
              for speed, consistency, and creative control.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="./studio.html">Launch Studio</a>
              <a className="btn btn-secondary" href="./docs.html">Read Docs</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Core Modules</div>
              <ul className="feature-list">
                <li>Scene map & story graph</li>
                <li>AI casting and lookbooks</li>
                <li>Timeline editing suite</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section reveal">
        <div className="section-header">
          <h2>Inside the Studio</h2>
          <p>A suite of tools designed for cinematic iteration.</p>
        </div>
        <StudioShowcase />
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<SoftwarePage />);
}

export default SoftwarePage;
