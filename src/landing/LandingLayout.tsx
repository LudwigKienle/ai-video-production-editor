import React, { useEffect, useState, useCallback } from 'react';

interface LandingLayoutProps {
  children: React.ReactNode;
}

const LandingLayout: React.FC<LandingLayoutProps> = ({ children }) => {
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    document.body.dataset.theme = 'cinematic';
  }, []);

  // Reveal + stagger observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');

            // Add stagger delays to direct grid children
            const grids = entry.target.querySelectorAll(
              '.service-grid, .case-grid, .portfolio-grid, .pricing-grid, .faq-grid, .process-grid, .docs-grid'
            );
            grids.forEach((grid) => {
              Array.from(grid.children).forEach((child, idx) => {
                const el = child as HTMLElement;
                if (!el.classList.contains('process-connector')) {
                  el.style.transitionDelay = `${0.08 * (idx + 1)}s`;
                }
              });
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  // Mouse glow
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const glow = document.getElementById('mouse-glow');
      if (glow) {
        glow.style.left = `${e.clientX}px`;
        glow.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Scroll-to-top visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 600);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="landing">
      <div id="mouse-glow" className="mouse-glow" />
      {children}
      <button
        className={`scroll-to-top ${showScrollTop ? 'is-visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Scroll to top"
      >
        ↑
      </button>
    </div>
  );
};

export default LandingLayout;
