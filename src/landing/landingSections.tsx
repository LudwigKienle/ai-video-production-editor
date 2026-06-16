import React, { useState, useEffect, useRef } from 'react';
import { buildAdobePortfolioCaseUrl } from '../config/siteLinks';
import { useTranslation } from '../i18n';

/* --- Helper Components & Hooks --- */

const useAnimatedCounter = (target: string, isVisible: boolean) => {
  const [display, setDisplay] = useState('0');
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isVisible || hasAnimated.current) return;
    hasAnimated.current = true;

    const numericMatch = target.match(/([\d]+)/);
    if (!numericMatch) {
      setDisplay(target);
      return;
    }

    const numTarget = parseInt(numericMatch[1], 10);
    const prefix = target.slice(0, target.indexOf(numericMatch[1]));
    const suffix = target.slice(target.indexOf(numericMatch[1]) + numericMatch[1].length);
    const duration = 1200;
    const steps = 40;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const progress = 1 - Math.pow(1 - step / steps, 3);
      const current = Math.round(numTarget * progress);
      setDisplay(`${prefix}${current}${suffix}`);
      if (step >= steps) {
        clearInterval(timer);
        setDisplay(target);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [isVisible, target]);

  return display;
};

const AnimatedStatCard: React.FC<{ item: { label: string; value: string }; isVisible: boolean }> = ({ item, isVisible }) => {
  const display = useAnimatedCounter(item.value, isVisible);
  return (
    <div className="stats-card">
      <div className={`stats-value ${isVisible ? 'is-animated' : ''}`}>{display}</div>
      <div className="stats-label">{item.label}</div>
    </div>
  );
};

/* --- Data & Types --- */

type TrustItem = {
  name: string;
  logo: string;
  href: string;
  invertOnDark?: boolean;
};

const trustItems: TrustItem[] = [
  { name: 'OpenAI', logo: '/assets/logos/openai.svg', href: 'https://openai.com', invertOnDark: true },
  { name: 'Google Gemini', logo: '/assets/logos/google-gemini.svg', href: 'https://ai.google.dev' },
  { name: 'Replicate', logo: '/assets/logos/replicate.svg', href: 'https://replicate.com', invertOnDark: true },
  { name: 'xAI', logo: '/assets/logos/xai.svg', href: 'https://x.ai', invertOnDark: true },
  { name: 'Supabase', logo: '/assets/logos/supabase.svg', href: 'https://supabase.com' },
  { name: 'Stripe', logo: '/assets/logos/stripe.svg', href: 'https://stripe.com' },
];

type PortfolioItem = {
  id: string;
  title: string;
  role: string;
  youtube?: string;
  video?: string;
  image?: string;
  description?: string;
  adobePath?: string;
};

const portfolioItems: PortfolioItem[] = [
  {
    id: 'local-electron-studio',
    title: 'Local Electron Studio',
    role: 'Open Core Preview',
    youtube: 'https://youtu.be/Q7DLEjZdPXc',
    description: 'Desktop-first workflow overview for local projects, BYOK providers, editing, review, and export.',
  },
];

/* --- Component Exports --- */

const TrustLogoItem: React.FC<{ item: TrustItem }> = ({ item }) => {
  const [hasError, setHasError] = useState(false);

  return (
    <a
      className="trust-item"
      href={item.href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${item.name} website`}
    >
      <span className="trust-tooltip">{item.name}</span>
      {!hasError ? (
        <img
          className={`trust-logo ${item.invertOnDark ? 'trust-logo--invert' : ''}`}
          src={item.logo}
          alt={`${item.name} logo`}
          loading="lazy"
          onError={() => setHasError(true)}
        />
      ) : (
        <span className="trust-fallback">{item.name}</span>
      )}
    </a>
  );
};

export const TrustStrip: React.FC = () => (
  <div className="trust-strip" aria-label="Technologien im Einsatz">
    {trustItems.map((item) => (
      <TrustLogoItem key={item.name} item={item} />
    ))}
  </div>
);

export const ServicesGrid: React.FC = () => {
  const { t } = useTranslation();

  const services = [
    { title: t('service_1_title'), desc: t('service_1_desc'), outcome: t('service_1_outcome'), icon: '🎯' },
    { title: t('service_2_title'), desc: t('service_2_desc'), outcome: t('service_2_outcome'), icon: '⚡' },
    { title: t('service_3_title'), desc: t('service_3_desc'), outcome: t('service_3_outcome'), icon: '🚀' },
  ];

  return (
    <div className="service-grid">
      {services.map((service, idx) => (
        <article className={`service-card stagger-${idx + 1}`} key={idx}>
          <div className="service-icon">{service.icon}</div>
          <h3>{service.title}</h3>
          <p>{service.desc}</p>
          <p className="service-outcome"><strong>Outcome:</strong> {service.outcome}</p>
        </article>
      ))}
    </div>
  );
};

export const ProcessGrid: React.FC = () => {
  const { t } = useTranslation();

  const processSteps = [
    { title: t('process_1_title'), desc: t('process_1_desc') },
    { title: t('process_2_title'), desc: t('process_2_desc') },
    { title: t('process_3_title'), desc: t('process_3_desc') },
  ];

  return (
    <div className="process-grid">
      {processSteps.map((step, idx) => (
        <React.Fragment key={idx}>
          <article className={`process-card stagger-${idx + 1}`}>
            <div className="process-step-num">{'0' + (idx + 1)}</div>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </article>
          {idx < processSteps.length - 1 && (
            <div className="process-connector" aria-hidden>→</div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export const CaseStudiesGrid: React.FC = () => {
  const { t } = useTranslation();

  const caseStudies = [
    { title: t('case_1_title'), project: t('case_1_project'), date: '2026-01-15', summary: t('case_1_summary'), result: t('case_1_result'), thumb: '/assets/features/case_fashion.png' },
    { title: t('case_2_title'), project: t('case_2_project'), date: '2025-11-06', summary: t('case_2_summary'), result: t('case_2_result'), thumb: '/assets/features/case_saas.png' },
    { title: t('case_3_title'), project: t('case_3_project'), date: '2025-09-28', summary: t('case_3_summary'), result: t('case_3_result'), thumb: '/assets/features/set_design_v2.png' },
  ];

  return (
    <div className="case-grid">
      {caseStudies.map((item, idx) => (
        <article className="case-card" key={idx}>
          <div className="case-head">
            <h3>{item.title}</h3>
            <span className="case-date">{item.date}</span>
          </div>
          <div className="case-meta">
            <div><span className="case-label">Project</span><span className="case-value">{item.project}</span></div>
            <div><span className="case-label">Result</span><span className="case-value">{item.result}</span></div>
          </div>
          <p className="case-summary">{item.summary}</p>
          <div className="case-thumb">
            <img src={item.thumb} alt={`${item.title} preview`} loading="lazy" />
            <span className="case-play" aria-hidden>▶</span>
          </div>
        </article>
      ))}
    </div>
  );
};

export const StatsGrid: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const stats = [
    { label: t('stats_label_1'), value: '120+' },
    { label: t('stats_label_2'), value: '48h' },
    { label: t('stats_label_3'), value: '92%' },
  ];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="stats-grid" ref={ref}>
      {stats.map((item, idx) => (
        <AnimatedStatCard key={idx} item={item} isVisible={isVisible} />
      ))}
    </div>
  );
};

export const PortfolioGrid: React.FC = () => {
  const [activeVideo, setActiveVideo] = useState<string | null>(null);

  const getYouTubeId = (url?: string) => {
    if (!url) return '';
    const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
    if (shortMatch?.[1]) return shortMatch[1];
    const longMatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    return longMatch?.[1] ?? '';
  };

  const getPosterUrl = (item: PortfolioItem) => {
    if (item.image && !item.video) return item.image;
    if (item.video) {
        return item.image || '';
    }
    if (item.youtube) {
        const id = getYouTubeId(item.youtube);
        return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    }
    return '';
  };

  return (
    <div className="portfolio-grid">
      {portfolioItems.map((item) => {
        const embedUrl = item.video
            ? item.video
            : (item.youtube ? `https://www.youtube.com/embed/${getYouTubeId(item.youtube)}?rel=0&modestbranding=1` : undefined);
        const posterUrl = getPosterUrl(item);
        const isActive = activeVideo === (item.video || item.youtube);
        const isLocalVideo = !!item.video;

        return (
          <div className="portfolio-card" key={item.id}>
            <div className="portfolio-media">
              {isActive && embedUrl ? (
                isLocalVideo ? (
                    <video
                        className="portfolio-video-player"
                        src={embedUrl}
                        controls
                        autoPlay
                        playsInline
                    />
                ) : (
                    <iframe
                    className="portfolio-video-player"
                    src={`${embedUrl}&autoplay=1`}
                    title={item.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                    />
                )
              ) : (
                <button
                  className="portfolio-thumb"
                  style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : { backgroundColor: '#1a1a1a' }}
                  onClick={() => {
                    if (item.video || item.youtube) {
                      setActiveVideo(item.video || item.youtube || '');
                    }
                  }}
                  aria-label={`Play ${item.title}`}
                >
                  {(item.video || item.youtube) && (
                    <span className="play-icon" />
                  )}
                </button>
              )}
            </div>
            <div className="portfolio-info">
              <div className="portfolio-title-wrap">
                <div className="portfolio-badge">Production</div>
                <div className="portfolio-title">{item.title}</div>
              </div>
              <div className="portfolio-role">{item.role}</div>
              {item.description && (
                <p className="portfolio-description">{item.description}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const PricingGrid: React.FC = () => {
  const { t } = useTranslation();
  const githubRepoUrl = 'https://github.com/LudwigKienle/ai-video-production-editor';
  const githubReleaseUrl = `${githubRepoUrl}/releases/latest`;

  const pricing = [
    {
      title: t('pricing_1_title'),
      description: t('pricing_1_desc'),
      meta: t('pricing_1_meta'),
      bullets: [t('pricing_1_bullet_1'), t('pricing_1_bullet_2'), t('pricing_1_bullet_3')],
      cta: t('pricing_1_cta'),
      href: githubReleaseUrl,
    },
    {
      title: t('pricing_2_title'),
      description: t('pricing_2_desc'),
      meta: t('pricing_2_meta'),
      bullets: [t('pricing_2_bullet_1'), t('pricing_2_bullet_2'), t('pricing_2_bullet_3')],
      cta: t('pricing_2_cta'),
      href: './docs.html',
      featured: true,
    },
    {
      title: t('pricing_3_title'),
      description: t('pricing_3_desc'),
      meta: t('pricing_3_meta'),
      bullets: [t('pricing_3_bullet_1'), t('pricing_3_bullet_2'), t('pricing_3_bullet_3')],
      cta: t('pricing_3_cta'),
      href: githubRepoUrl,
    },
  ];

  return (
    <div className="pricing-grid">
      {pricing.map((item, idx) => (
        <article className={`pricing-card ${item.featured ? 'is-featured' : ''}`} key={idx}>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
          <div className="pricing-meta">{item.meta}</div>
          <ul className="pricing-list">
            {item.bullets.map((bullet, bIdx) => (
              <li key={bIdx}>{bullet}</li>
            ))}
          </ul>
          <a className="btn btn-secondary pricing-btn" href={item.href}>{item.cta}</a>
        </article>
      ))}
    </div>
  );
};

export const PricingComparisonTable: React.FC = () => {
  const { t } = useTranslation();

  const pricingRows = [
    { feature: t('table_row_1_feat'), trial: t('table_row_1_trial'), byok: t('table_row_1_byok'), hosted: t('table_row_1_hosted') },
    { feature: t('table_row_2_feat'), trial: t('table_row_2_trial'), byok: t('table_row_2_byok'), hosted: t('table_row_2_hosted') },
    { feature: t('table_row_3_feat'), trial: t('table_row_3_trial'), byok: t('table_row_3_byok'), hosted: t('table_row_3_hosted') },
    { feature: t('table_row_4_feat'), trial: t('table_row_4_trial'), byok: t('table_row_4_byok'), hosted: t('table_row_4_hosted') },
  ];

  return (
    <div className="pricing-table-wrap">
      <table className="pricing-table" aria-label="Pricing Vergleich">
        <thead>
          <tr>
            <th>{t('table_head_comp')}</th>
            <th>{t('table_head_trial')}</th>
            <th>{t('table_head_byok')}</th>
            <th>{t('table_head_hosted')}</th>
          </tr>
        </thead>
        <tbody>
          {pricingRows.map((row, idx) => (
            <tr key={idx}>
              <td>{row.feature}</td>
              <td>{row.trial}</td>
              <td>{row.byok}</td>
              <td>{row.hosted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const FaqGrid: React.FC = () => {
  const { t } = useTranslation();

  const faqItems = [
    { title: t('faq_1_q'), description: t('faq_1_a') },
    { title: t('faq_2_q'), description: t('faq_2_a') },
    { title: t('faq_3_q'), description: t('faq_3_a') },
    { title: t('faq_4_q'), description: t('faq_4_a') },
    { title: t('faq_5_q'), description: t('faq_5_a') },
    { title: t('faq_6_q'), description: t('faq_6_a') },
  ];

  return (
    <div className="faq-grid">
      {faqItems.map((item, idx) => (
        <details className={`faq-item stagger-${idx + 1}`} key={idx}>
          <summary><span className="faq-chevron">▸</span>{item.title}</summary>
          <p>{item.description}</p>
        </details>
      ))}
    </div>
  );
};

export const ContactCard: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="contact-card">
      <div><div className="contact-label">{t('contact_email')}</div><div className="contact-value">luikienle@gmail.com</div></div>
      <div><div className="contact-label">{t('contact_location')}</div><div className="contact-value">Berlin · Remote</div></div>
      <div><div className="contact-label">{t('contact_response_time')}</div><div className="contact-value">24h</div></div>
      <div><div className="contact-label">{t('contact_inquiry')}</div><div className="contact-value">{t('contact_commercial')}</div></div>
    </div>
  );
};

export const TeamGrid: React.FC = () => (
  <div className="team-grid">
    <article className="team-card">
      <img src="/assets/team/ludwig.png" alt="Ludwig Maximillian Kienle" />
      <div>
        <div className="team-name">Ludwig Maximillian Kienle</div>
        <div className="team-role">Founder · Creative Director</div>
      </div>
      <p className="team-bio">Fokus auf cinematic AI production, Brand Storytelling und hochwertige visuelle Kampagnen.</p>
    </article>
  </div>
);

// Add StudioShowcase properly
export const StudioShowcase: React.FC = () => {
  const studioFeatures = [
    {
      title: 'Infinite Scene Map',
      description: 'Dein gesamter Film auf einer Canvas. Behalte den Ueberblick ueber Story-Arcs, Szenen und Assets.',
      bullets: ['Story-Uebersicht', 'Szenen-Tagging'],
      image: '/assets/features/scene_map_v2.png',
      span: 2,
      icon: '🗺️',
    },
    {
      title: 'AI Avatar Studio',
      description: 'Dirigiere digitale Darsteller mit praezisem Lip-Sync und emotionaler Tiefe.',
      bullets: ['Custom Avatare', 'Multi-Language'],
      image: '/assets/features/avatar_studio_v2.png',
      span: 1,
      icon: '👤',
    },
    {
      title: 'AI Director',
      description: 'Text-to-Set in Echtzeit. Kontrolliere Licht, Kameraobjektive und Bewegungen.',
      bullets: ['Virtuelle Linsen', 'Licht-Steuerung'],
      image: '/assets/features/set_design_v2.png',
      span: 1,
      icon: '🎬',
    },
    {
      title: 'Concept & Casting',
      description: 'Entwickle konsistente Charaktere und einzigartige Stilwelten.',
      bullets: ['Face Consistency', 'Style Transfer'],
      image: '/assets/features/concept_casting.png',
      span: 2,
      icon: '🎨',
    },
  ];

  return (
    <div className="bento-grid">
      {studioFeatures.map((feature) => (
        <div
          className={`bento-card ${feature.span === 2 ? 'bento-span-2' : ''} ${feature.span === 3 ? 'bento-span-3' : ''}`}
          key={feature.title}
          style={{ backgroundImage: `url(${feature.image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          <div className="bento-bg" />
          <div className="bento-content">
            <div className="bento-icon-wrapper">{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
// Forced update to trigger rebuild
