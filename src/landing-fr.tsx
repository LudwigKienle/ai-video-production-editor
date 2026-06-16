import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import { PortfolioGrid, TrustStrip } from './landing/landingSections';

const services = [
  {
    title: 'Strategie et pre-production',
    desc: 'Nous definissons le message, la cible et la direction visuelle avant la production.',
    outcome: 'Une direction claire des le premier jour.',
  },
  {
    title: 'Sprints de production AI',
    desc: 'Plans, lookbooks et variantes sont produits en cycles de validation courts.',
    outcome: 'Livraison plus rapide avec une qualite visuelle coherente.',
  },
  {
    title: 'Post-production et livraison',
    desc: 'Montage, son et exports prets pour tous les canaux.',
    outcome: 'Assets de campagne exploitables sans surcharge operationnelle.',
  },
];

const cases = [
  {
    title: 'Cas 01 : Lancement e-commerce',
    challenge: 'Une nouvelle collection devait etre lancee en moins de deux semaines.',
    approach: 'Previs rapide, systeme visuel unique, trois cycles d iteration.',
    result: '6 assets livres en 10 jours.',
  },
  {
    title: 'Cas 02 : Film produit SaaS',
    challenge: 'Expliquer une proposition de valeur complexe en 45 secondes.',
    approach: 'Structure modulaire des scenes et declinaisons pour paid media.',
    result: '1 film principal + 4 versions courtes.',
  },
  {
    title: 'Cas 03 : Teaser de marque',
    challenge: 'Le rebranding demandait une nouvelle signature visuelle forte.',
    approach: 'Systeme de moodboard, casting AI et pipeline colorimetrique final.',
    result: 'Univers coherent pour web, social et presentations.',
  },
];

const pricingRows = [
  { feature: 'Effort de setup', trial: 'Faible', byok: 'Moyen', hosted: 'Tres faible' },
  { feature: 'Cout fixe', trial: '0 EUR', byok: 'Unique', hosted: 'Abonnement + usage' },
  { feature: 'Scalabilite', trial: 'Limitee', byok: 'Elevee', hosted: 'Elevee' },
  { feature: 'Ideal pour', trial: 'Evaluation', byok: 'Power users', hosted: 'Equipes en production' },
];

const faqs = [
  {
    q: 'Quel est le delai de demarrage ?',
    a: 'La plupart des projets demarrent sous 24h apres cadrage.',
  },
  {
    q: 'Combien d iterations sont incluses ?',
    a: 'Trois cycles d iteration structures sont inclus par defaut.',
  },
  {
    q: 'Qui detient les droits d usage ?',
    a: 'Les droits sont transferes selon le cadre convenu apres validation et paiement.',
  },
  {
    q: 'Modele agence / white-label possible ?',
    a: 'Oui, nous supportons les setups partenaires et agences.',
  },
];

const LandingFr: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero reveal">
        <LandingNav active="home" />
        <div className="hero-copy">
          <span className="hero-chip">Studio Cinematic AI</span>
          <h1>Des contenus cinematographiques pour livrer vite, sans sacrifier la qualite.</h1>
          <p>
            Nous unissons strategie, production AI et post-production dans un workflow clair.
            Resultat: des assets de campagne coherents en quelques jours.
          </p>
          <blockquote className="hero-quote">
            &quot;Mieux que n importe quel logiciel, il y a une vision claire de l histoire.&quot; - Wolfgang Scheffler
          </blockquote>
          <div className="hero-actions">
            <a className="btn btn-primary" href="./contact.html">Reserver un appel</a>
            <a className="btn btn-ghost" href="#showreel">Voir le showreel</a>
          </div>
          <div className="lang-links">
            <a href="./landing.html">DE</a>
            <a href="./landing-en.html">EN</a>
          </div>
        </div>
      </header>

      <section className="section reveal trust-section">
        <div className="section-header compact">
          <h2>Stack de production fiable</h2>
          <p>Infrastructure et outillage concus pour une livraison stable.</p>
        </div>
        <TrustStrip />
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Services</h2>
          <p>Du cadrage a la livraison finale.</p>
        </div>
        <div className="service-grid">
          {services.map((item) => (
            <article className="service-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
              <p className="service-outcome"><strong>Impact:</strong> {item.outcome}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Cas clients</h2>
          <p>Exemples representatifs de productions commerciales.</p>
        </div>
        <div className="case-grid">
          {cases.map((item) => (
            <article className="case-card" key={item.title}>
              <h3>{item.title}</h3>
              <p><strong>Contexte:</strong> {item.challenge}</p>
              <p><strong>Approche:</strong> {item.approach}</p>
              <p><strong>Resultat:</strong> {item.result}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="showreel" className="section reveal">
        <div className="section-header">
          <h2>Showreel</h2>
          <p>Selection de productions cinematographiques et AI-assistees.</p>
        </div>
        <PortfolioGrid />
      </section>

      <section className="section pricing-section reveal">
        <div className="section-header">
          <h2>Tarifs</h2>
          <p>Choisissez le modele adapte a votre configuration de production.</p>
        </div>
        <div className="pricing-compare-head">Comparatif rapide</div>
        <div className="pricing-table-wrap">
          <table className="pricing-table" aria-label="Comparatif des offres">
            <thead>
              <tr>
                <th>Comparatif</th>
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
          <p>Questions frequentes avant lancement.</p>
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
  createRoot(rootEl).render(<LandingFr />);
}

export default LandingFr;
