import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { PortfolioGrid, TrustStrip } from './landing/landingSections';

const services = [
  {
    title: 'Strategy and Pre-Production',
    desc: 'We define message, audience, and visual direction before production starts.',
    outcome: 'Clear creative direction from day one.',
  },
  {
    title: 'AI Production Sprints',
    desc: 'Shots, lookbooks, and variants are generated in short approval loops.',
    outcome: 'Faster delivery with consistent visual quality.',
  },
  {
    title: 'Post and Delivery',
    desc: 'Editing, sound, and format-ready exports for all channels.',
    outcome: 'Campaign-ready assets without production overhead.',
  },
];

const cases = [
  {
    title: 'Case 01: E-commerce Launch',
    challenge: 'A new collection needed video assets across paid social in less than two weeks.',
    approach: 'Fast previs, one visual system, and three iteration rounds.',
    result: '6 launch-ready assets delivered in 10 days.',
  },
  {
    title: 'Case 02: SaaS Product Film',
    challenge: 'Complex product value had to be explained in under 45 seconds.',
    approach: 'Modular scene structure with optimized cuts for ads.',
    result: '1 master film + 4 performance cut-downs.',
  },
  {
    title: 'Case 03: Brand Teaser',
    challenge: 'Brand relaunch required a distinct cinematic visual language.',
    approach: 'Moodboard system, AI casting, and final color pipeline.',
    result: 'Unified campaign visuals for web, social, and pitch decks.',
  },
];

const pricingRows = [
  { feature: 'Setup effort', trial: 'Low', byok: 'Medium', hosted: 'Very low' },
  { feature: 'Fixed cost', trial: '$0', byok: 'One-time', hosted: 'Subscription + usage' },
  { feature: 'Scalability', trial: 'Limited', byok: 'High', hosted: 'High' },
  { feature: 'Best for', trial: 'Evaluation', byok: 'Power users', hosted: 'Operating teams' },
];

const faqs = [
  {
    q: 'How fast can we start?',
    a: 'Most projects start within 24 hours after scope and goals are aligned.',
  },
  {
    q: 'How many revisions are included?',
    a: 'Standard packages include three structured iteration rounds.',
  },
  {
    q: 'Who owns usage rights?',
    a: 'Usage rights transfer as agreed once delivery is accepted and paid.',
  },
  {
    q: 'Can agencies run this white-label?',
    a: 'Yes. We support agency and partner production setups.',
  },
];

const LandingEn: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero reveal">
        <LandingNav active="home" />
        <div className="hero-copy">
          <span className="hero-chip">Cinematic AI Studio</span>
          <h1>Cinematic content for teams that need launch-ready assets fast.</h1>
          <p>
            We combine strategy, AI production, and post into one clear workflow.
            Result: consistent campaign visuals in days, not months.
          </p>
          <blockquote className="hero-quote">
            &quot;Better than any software is a clear view of the story.&quot; - Wolfgang Scheffler
          </blockquote>
          <div className="hero-actions">
            <a className="btn btn-primary" href="./contact.html">Book a free intro call</a>
            <a className="btn btn-ghost" href="#showreel">Watch showreel</a>
          </div>
          <div className="lang-links">
            <a href="./landing.html">DE</a>
            <a href="./landing-fr.html">FR</a>
          </div>
        </div>
      </header>

      <section className="section reveal trust-section">
        <div className="section-header compact">
          <h2>Trusted Production Stack</h2>
          <p>Infrastructure and tooling designed for reliable production delivery.</p>
        </div>
        <TrustStrip />
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Services</h2>
          <p>From positioning to final deliverables.</p>
        </div>
        <div className="service-grid">
          {services.map((item) => (
            <article className="service-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
              <p className="service-outcome"><strong>Outcome:</strong> {item.outcome}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Case Studies</h2>
          <p>Representative delivery patterns from commercial production work.</p>
        </div>
        <div className="case-grid">
          {cases.map((item) => (
            <article className="case-card" key={item.title}>
              <h3>{item.title}</h3>
              <p><strong>Challenge:</strong> {item.challenge}</p>
              <p><strong>Approach:</strong> {item.approach}</p>
              <p><strong>Result:</strong> {item.result}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="showreel" className="section reveal">
        <div className="section-header">
          <h2>Showreel</h2>
          <p>Selected cinematic and AI-assisted production work.</p>
        </div>
        <PortfolioGrid />
      </section>

      <section className="section pricing-section reveal">
        <div className="section-header">
          <h2>Pricing</h2>
          <p>Choose the model that fits your production setup.</p>
        </div>
        <div className="pricing-compare-head">Quick Comparison</div>
        <div className="pricing-table-wrap">
          <table className="pricing-table" aria-label="Pricing comparison">
            <thead>
              <tr>
                <th>Comparison</th>
                <th>Trial</th>
                <th>Lifetime BYOK</th>
                <th>Hosted Credits</th>
              </tr>
            </thead>
            <tbody>
              {pricingRows.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.trial}</td>
                  <td>{row.byok}</td>
                  <td>{row.hosted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section faq-section reveal">
        <div className="section-header">
          <h2>FAQ</h2>
          <p>Common buying and delivery questions.</p>
        </div>
        <div className="faq-grid">
          {faqs.map((item) => (
            <article className="faq-card" key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
      </section>

      <LandingFooter />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<LandingEn />);
}

export default LandingEn;
