import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { PortfolioGrid, StatsGrid } from './landing/landingSections';
import { ADOBE_PORTFOLIO_URL, HAS_CUSTOM_ADOBE_PORTFOLIO_URL } from './config/siteLinks';

const PortfolioPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav active="portfolio" />
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Portfolio</span>
            <h1>Selected cinematic work and brand campaigns.</h1>
            <p>
              A snapshot of trailers, cinematic portraits, and concept-driven visuals.
              Every frame is crafted with studio-grade direction and AI precision.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="./contact.html">Start a project</a>
              <a className="btn btn-ghost" href={ADOBE_PORTFOLIO_URL} target="_blank" rel="noreferrer">Open Adobe Portfolio</a>
              <a className="btn btn-secondary" href="./studio.html">Launch Studio</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Focus Areas</div>
              <ul className="feature-list">
                <li>Trailers & launch films</li>
                <li>Brand storytelling</li>
                <li>AI concept & mood reels</li>
                <li>Adobe Portfolio deep links</li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      <section className="section reveal">
        <div className="section-header">
          <h2>Showreel</h2>
          <p>Watch the most recent AI Video Production Editor demos.</p>
        </div>
        <PortfolioGrid />
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Adobe Portfolio Sync</h2>
          <p>
            Dein Adobe Portfolio wird direkt auf dieser Portfolio-Domain angezeigt und bleibt zusaetzlich als externer Link erreichbar.
          </p>
        </div>
        {HAS_CUSTOM_ADOBE_PORTFOLIO_URL ? (
          <div className="adobe-portfolio-embed-wrap">
            <iframe
              src={ADOBE_PORTFOLIO_URL}
              title="Adobe Portfolio Embed"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <div className="adobe-portfolio-placeholder">
            Setze <code>VITE_ADOBE_PORTFOLIO_URL</code>, damit dein echtes Adobe Portfolio hier eingebettet wird.
          </div>
        )}
        <p className="adobe-portfolio-hint">
          Wenn ein Browser die Einbettung blockiert, kannst du es weiterhin direkt oeffnen:
        </p>
        <div className="adobe-portfolio-card">
          <div>
            <h3>External Portfolio Archive</h3>
            <p>
              {HAS_CUSTOM_ADOBE_PORTFOLIO_URL
                ? 'Connected to your custom Adobe Portfolio URL.'
                : 'Set VITE_ADOBE_PORTFOLIO_URL to your Adobe Portfolio domain for direct case syncing.'}
            </p>
          </div>
          <a className="btn btn-primary" href={ADOBE_PORTFOLIO_URL} target="_blank" rel="noreferrer">
            Open Adobe Portfolio
          </a>
        </div>
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Studio Impact</h2>
          <p>High-velocity delivery backed by a repeatable production pipeline.</p>
        </div>
        <StatsGrid />
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<PortfolioPage />);
}

export default PortfolioPage;
