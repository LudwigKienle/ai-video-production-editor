import React, { useEffect, useMemo, useState } from 'react';

export interface LandingNavItem {
  id: string;
  label: string;
  href: string;
}

interface LandingNavProps {
  active?: string;
  brandLabel?: string;
  logoAlt?: string;
  portalHref?: string | null;
  portalLabel?: string;
  studioHref?: string;
  studioLabel?: string;
}

const LandingNav: React.FC<LandingNavProps> = ({
  active,
  brandLabel = 'AI Video Production Editor',
  logoAlt,
  portalHref = null,
  portalLabel = 'Client Portal',
  studioHref = './studio.html',
  studioLabel = 'Launch Studio',
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = useMemo<LandingNavItem[]>(
    () => [
      { id: 'home', label: 'Start', href: './landing.html' },
      { id: 'demo', label: 'Demo', href: './landing.html#showreel' },
      { id: 'features', label: 'Features', href: './landing.html#services' },
      { id: 'workflow', label: 'Workflow', href: './landing.html#studio' },
      { id: 'pricing', label: 'Open Source', href: './landing.html#pricing' },
      { id: 'docs', label: 'Docs', href: './docs.html' },
      { id: 'github', label: 'GitHub', href: 'https://github.com/LudwigKienle/ai-video-production-editor' },
    ],
    []
  );

  const handleMobileNavClick = () => setMobileNavOpen(false);
  const closeMobileNav = () => setMobileNavOpen(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileNav();
      }
    };

    const handleResize = () => {
      if (window.innerWidth > 900) {
        closeMobileNav();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <>
      <nav className="landing-nav">
        <a className="landing-logo" href="./landing.html">
          <img src="/assets/brand/logo_minimal.png" alt={logoAlt || `${brandLabel} logo`} className="logo-icon" />
          <span>{brandLabel}</span>
        </a>
        <div className="landing-nav-links">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={active === item.id ? 'is-active' : undefined}
              aria-current={active === item.id ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="landing-cta">
          {portalHref && <a className="btn btn-secondary" href={portalHref}>{portalLabel}</a>}
          <a className="btn btn-primary" href={studioHref}>{studioLabel}</a>
        </div>
        <button
          className="mobile-nav-toggle"
          onClick={() => setMobileNavOpen((prev) => !prev)}
          aria-label="Toggle navigation"
          aria-expanded={mobileNavOpen}
        >
          <span />
          <span />
        </button>
      </nav>
      <div className={`mobile-nav ${mobileNavOpen ? 'is-open' : ''}`}>
        {navItems.map((item) => (
          <a
            key={item.id}
            href={item.href}
            onClick={handleMobileNavClick}
            className={active === item.id ? 'is-active' : undefined}
          >
            {item.label}
          </a>
        ))}
      </div>
    </>
  );
};

export default LandingNav;
