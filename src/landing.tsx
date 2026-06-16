import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { useTranslation } from './i18n';
import {
  CaseStudiesGrid,
  ContactCard,
  FaqGrid,
  PortfolioGrid,
  PricingComparisonTable,
  PricingGrid,
  ProcessGrid,
  ServicesGrid,
  StatsGrid,
  TrustStrip,
} from './landing/landingSections';

const Landing: React.FC = () => {
  const { t, lang, setLang } = useTranslation();
  const heroVideoId = '-6jo636vRSw';
  const heroVideoEmbed = `https://www.youtube-nocookie.com/embed/${heroVideoId}?rel=0&modestbranding=1`;
  const githubRepoUrl = 'https://github.com/LudwigKienle/ai-video-production-editor';
  const githubReleaseUrl = `${githubRepoUrl}/releases/latest`;

  return (
    <LandingLayout>
      <header className="landing-hero reveal">
        <LandingNav active="home" studioHref={githubReleaseUrl} studioLabel={t('nav_download')} />
        <div className="hero-shell">
          <div className="hero-particles">
            <span className="hero-article" />
            <span className="hero-article" />
            <span className="hero-article" />
            <span className="hero-article" />
            <span className="hero-article" />
          </div>
          <div className="hero-split">
            <div className="hero-copy">
              <span className="hero-chip">{t('hero_chip')}</span>
              <h1>{t('hero_title')}</h1>
              <p>
                {t('hero_subtitle')}
                <br />
                {t('hero_subtitle_2')}
              </p>
              <blockquote className="hero-quote">
                {t('hero_quote')}
              </blockquote>
              <div className="hero-keywords" aria-label="Product highlights">
                <span>{t('hero_keyword_1')}</span>
                <span>{t('hero_keyword_2')}</span>
                <span>{t('hero_keyword_3')}</span>
                <span>{t('hero_keyword_4')}</span>
              </div>
              <div className="hero-actions">
                <a className="btn btn-primary" href={githubReleaseUrl}>{t('hero_cta_primary')}</a>
                <a className="btn btn-secondary" href={githubRepoUrl}>{t('hero_cta_secondary')}</a>
              </div>
              <div className="lang-links">
                <button
                  className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
                  onClick={() => setLang('en')}
                  aria-label="Switch to English"
                >EN</button>
                <button
                  className={`lang-btn ${lang === 'de' ? 'active' : ''}`}
                  onClick={() => setLang('de')}
                  aria-label="Switch to German"
                >DE</button>
                <button
                  className={`lang-btn ${lang === 'fr' ? 'active' : ''}`}
                  onClick={() => setLang('fr')}
                  aria-label="Switch to French"
                >FR</button>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-visual-frame">
                <iframe
                  src={heroVideoEmbed}
                  title="AI Video Production Editor desktop workflow preview"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <div className="hero-visual-meta">
                <span>{t('hero_visual_label')}</span>
                <a href={`https://youtu.be/${heroVideoId}`} target="_blank" rel="noreferrer">{t('hero_visual_link')}</a>
              </div>
            </div>
          </div>
          <div className="hero-stats">
            <StatsGrid />
            <p className="hero-proof-note">{t('hero_proof_note')}</p>
          </div>
        </div>
      </header>

      <section className="section reveal trust-section">
        <div className="section-header compact">
          <span className="section-num">01</span>
          <h2>{t('trust_title')}</h2>
          <p>{t('trust_desc')}</p>
        </div>
        <TrustStrip />
      </section>

      <section id="services" className="section reveal">
        <div className="section-header">
          <span className="section-num">02</span>
          <h2>{t('services_title')}</h2>
          <p>{t('services_desc')}</p>
        </div>
        <ServicesGrid />
      </section>

      <section id="cases" className="section reveal">
        <div className="section-header">
          <span className="section-num">03</span>
          <h2>{t('cases_title')}</h2>
          <p>{t('cases_desc')}</p>
        </div>
        <CaseStudiesGrid />
      </section>

      <section id="showreel" className="section reveal">
        <div className="section-header">
          <span className="section-num">04</span>
          <h2>{t('showreel_title')}</h2>
          <p>{t('showreel_desc')}</p>
        </div>
        <PortfolioGrid />
      </section>

      <section className="section reveal">
        <div className="section-header">
          <span className="section-num">05</span>
          <h2>{t('process_title')}</h2>
          <p>{t('process_desc')}</p>
        </div>
        <ProcessGrid />
      </section>

      <section id="studio" className="section studio-section reveal">
        <div className="section-header">
          <span className="section-num">06</span>
          <h2>{t('studio_title')}</h2>
          <p>{t('studio_desc')}</p>
        </div>
        <div className="pricing-cta">
          <a className="btn btn-secondary" href={githubReleaseUrl}>{t('studio_cta')}</a>
        </div>
      </section>

      <section id="pricing" className="section pricing-section reveal">
        <div className="section-header">
          <span className="section-num">07</span>
          <h2>{t('pricing_title')}</h2>
          <p>{t('pricing_desc')}</p>
        </div>
        <PricingGrid />
        <div className="pricing-compare-head">{t('pricing_compare_head')}</div>
        <PricingComparisonTable />
        <div className="pricing-cta">
          <a className="btn btn-primary" href={githubReleaseUrl}>{t('pricing_cta')}</a>
        </div>
      </section>

      <section id="faq" className="section faq-section reveal">
        <div className="section-header">
          <span className="section-num">08</span>
          <h2>{t('faq_title')}</h2>
          <p>{t('faq_desc')}</p>
        </div>
        <FaqGrid />
      </section>

      <section id="docs" className="section docs-section reveal">
        <div className="section-header">
          <h2>{t('docs_title')}</h2>
          <p>{t('docs_desc')}</p>
        </div>
        <div className="docs-grid">
          <div className="docs-card">
            <h3>{t('docs_card_quick_title')}</h3>
            <ol>
              <li>{t('docs_card_quick_1')}</li>
              <li>{t('docs_card_quick_2')}</li>
              <li>{t('docs_card_quick_3')}</li>
            </ol>
          </div>
          <div className="docs-card">
            <h3>{t('docs_card_prod_title')}</h3>
            <p>{t('docs_card_prod_desc')}</p>
            <a className="btn btn-secondary" href="./docs.html">{t('docs_card_prod_cta')}</a>
          </div>
          <div className="docs-card">
            <h3>{t('docs_card_app_title')}</h3>
            <p>{t('docs_card_app_desc')}</p>
            <a className="btn btn-primary" href={githubReleaseUrl}>{t('docs_card_app_cta')}</a>
          </div>
        </div>
      </section>

      <section id="contact" className="section contact-section reveal">
        <div className="section-header">
          <h2>{t('contact_title')}</h2>
          <p>{t('contact_desc')}</p>
        </div>
        <ContactCard />
        <div className="final-cta-wrap">
          <a className="btn btn-primary final-cta" href={githubRepoUrl}>{t('contact_cta')}</a>
        </div>
      </section>

      <LandingFooter platformHref={githubReleaseUrl} platformLabel={t('nav_download')} />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<Landing />);
}

export default Landing;
