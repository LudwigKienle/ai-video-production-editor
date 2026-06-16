import React from 'react';
import { useTranslation } from '../i18n';

interface LandingFooterProps {
  brandLabel?: string;
  platformHref?: string;
  platformLabel?: string;
  portalHref?: string | null;
}

const LandingFooter: React.FC<LandingFooterProps> = ({
  brandLabel = 'AI Video Production Editor',
  platformHref = './studio.html',
  platformLabel,
  portalHref = null,
}) => {
  const { t } = useTranslation();

  return (
    <footer className="footer-section section">
      <div className="footer-gradient-divider" />
      <div className="footer-grid">
        <div className="footer-brand">
          <h4>{brandLabel}</h4>
          <p style={{ fontSize: '13px', maxWidth: '300px' }}>
            {t('footer_studio')}
          </p>
          <div className="footer-badges">
            <span>{t('contact_response_time')}: 24h</span>
            <span>Remote-first Delivery</span>
          </div>
          <div className="footer-social-links">
            <a className="footer-social-badge" href="https://twitter.com/lukienle" target="_blank" rel="noopener noreferrer">
              𝕏 Twitter
            </a>
            <a className="footer-social-badge" href="https://linkedin.com/in/lukienle" target="_blank" rel="noopener noreferrer">
              in LinkedIn
            </a>
            <a className="footer-social-badge" href="https://github.com/LudwigKienle" target="_blank" rel="noopener noreferrer">
              ⌥ GitHub
            </a>
          </div>
        </div>

        <div className="footer-col">
          <h5>Platform</h5>
          <div className="footer-links">
            <a href={platformHref}>{platformLabel || t('hero_cta_primary')}</a>
            {portalHref && <a href={portalHref}>Client Portal</a>}
            <a href="./docs.html">{t('docs_title')}</a>
          </div>
        </div>

        <div className="footer-col">
          <h5>{t('contact_company')}</h5>
          <div className="footer-links">
            <a href="./contact.html">{t('contact_inquiry')}</a>
            <a href="#impressum">{t('footer_legal_imprint')}</a>
            <a href="./faq.html">{t('faq_title')}</a>
          </div>
        </div>

        <div className="footer-col">
          <h5>{t('footer_legal_title')}</h5>
          <div className="footer-links">
            <a href="./datenschutz.html">{t('footer_legal_privacy')}</a>
            <a href="./agb.html">{t('footer_legal_terms')}</a>
            <a href="./widerruf.html">Widerruf</a>
          </div>
        </div>
      </div>

      <div id="impressum" className="impressum-card">
        <div className="impressum-line">Ludwig Maximillian Kienle</div>
        <div className="impressum-line">Einzelunternehmer (Kleinunternehmer)</div>
        <div className="impressum-line">Gärtnerweg 15</div>
        <div className="impressum-line">898081 Ulm · Deutschland</div>
        <div className="impressum-line">{t('contact_email')}: luikienle@gmail.com</div>
        <div className="impressum-line">{t('contact_phone')}: +49 152 36760377</div>
        <div className="impressum-line">{t('footer_copyright')}</div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <a className="back-to-top" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          ↑
        </a>
      </div>
    </footer>
  );
};

export default LandingFooter;
