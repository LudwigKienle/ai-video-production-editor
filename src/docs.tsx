import React from 'react';
import { createRoot } from 'react-dom/client';
import './landing.css';
import LandingLayout from './landing/LandingLayout';
import LandingNav from './landing/LandingNav';
import LandingFooter from './landing/LandingFooter';
import DocsSupportChat from './components/DocsSupportChat';
import { SUPPORT_CHANNELS, SUPPORT_VIDEO_LIBRARY, YOUTUBE_CHANNEL_URL } from './docs/supportResources';

const DocsPage: React.FC = () => {
  return (
    <LandingLayout>
      <header className="landing-hero page-hero reveal">
        <LandingNav
          active="docs"
          brandLabel="AI Video Production Editor"
          logoAlt="AI Video Production Editor logo"
          portalHref={null}
          studioHref="./studio.html"
          studioLabel="Open Studio"
        />

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="chip">Documentation</span>
            <h1>AI Video Production Editor</h1>
            <p>
              Everything you need to set up API keys, run the editor, and ship
              cinematic results fast.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#setup">Get Started</a>
              <a className="btn btn-ghost" href="#troubleshoot">Troubleshooting</a>
              <a className="btn btn-ghost" href={YOUTUBE_CHANNEL_URL} aria-label="Open AIVideoProductionEditor YouTube tutorials">YouTube Tutorials</a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-panel-inner">
              <div className="hero-panel-title">Quick Start</div>
              <div className="hero-panel-meta">
                <span>1. Settings → API Keys</span>
                <span>2. Choose a provider</span>
                <span>3. Start generating</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section id="setup" className="section reveal">
        <div className="section-header">
          <h2>Setup</h2>
          <p>Connect your providers and configure the editor.</p>
        </div>
        <div className="docs-grid">
          <div className="docs-card">
            <h3>1. Account & Workspace</h3>
            <p>Sign in, create a workspace, and open your first project.</p>
          </div>
          <div className="docs-card">
            <h3>2. API Keys</h3>
            <p>Go to Settings → API Keys. Paste keys for OpenAI, Replicate, Google (Gemini), xAI, or any provider you use.</p>
          </div>
          <div className="docs-card">
            <h3>3. Provider Settings</h3>
            <p>Pick your default models for text, image, and video generation.</p>
          </div>
        </div>
      </section>

      <section className="section reveal">
        <div className="section-header">
          <h2>Core Workflows</h2>
          <p>From storyboard to final delivery.</p>
        </div>
        <div className="docs-grid">
          <div className="docs-card">
            <h3>Storyboard</h3>
            <p>Create shots, lock style, and push to timeline.</p>
          </div>
          <div className="docs-card">
            <h3>Filming</h3>
            <p>Generate shot variations, select the best take, and iterate.</p>
          </div>
          <div className="docs-card">
            <h3>Auto Cut</h3>
            <p>Analyze long footage and generate the most engaging cut.</p>
          </div>
          <div className="docs-card">
            <h3>Marketing Assets</h3>
            <p>Create posters, thumbnails, and social content using your project context.</p>
          </div>
        </div>
      </section>

      <section className="section reveal" id="video-learning-path">
        <div className="section-header">
          <h2>Video Learning Path</h2>
          <p>Use the official YouTube walkthroughs as a support ladder from quick overview to full production flow.</p>
        </div>
        <div className="support-video-grid">
          {SUPPORT_VIDEO_LIBRARY.map((video) => (
            <a
              key={video.id}
              className="support-video-card"
              href={video.url}
              target="_blank"
              rel="noreferrer"
            >
              <div className="support-video-thumb">
                <img src={video.thumbnailUrl} alt="" loading="lazy" />
                <span>{video.durationLabel}</span>
              </div>
              <div className="support-video-body">
                <h3>{video.title}</h3>
                <p>{video.focus}</p>
                <div className="support-video-use">{video.supportUse}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section id="troubleshoot" className="section reveal">
        <div className="section-header">
          <h2>Troubleshooting</h2>
          <p>Common issues and quick fixes.</p>
        </div>
        <div className="troubleshoot-grid">
          <div className="troubleshoot-card">
            <h3>Generation failed</h3>
            <p>Check API keys, model availability, and provider status.</p>
          </div>
          <div className="troubleshoot-card">
            <h3>Slow outputs</h3>
            <p>Use smaller resolutions, lower guidance, or faster models.</p>
          </div>
          <div className="troubleshoot-card">
            <h3>Missing assets</h3>
            <p>Ensure asset links are public and the storage bucket is reachable.</p>
          </div>
        </div>
      </section>

      <section className="section reveal" id="support-map">
        <div className="section-header">
          <h2>Support Map</h2>
          <p>Choose the right channel based on whether you need a tutorial, a bug report, or a private security path.</p>
        </div>
        <div className="docs-grid">
          {SUPPORT_CHANNELS.map((channel) => (
            <a key={channel.label} className="docs-card support-link-card" href={channel.href} target="_blank" rel="noreferrer">
              <h3>{channel.label}</h3>
              <p>{channel.description}</p>
            </a>
          ))}
        </div>
      </section>

      <DocsSupportChat />

      <section className="section contact-section reveal">
        <div className="section-header">
          <h2>Support</h2>
          <p>We’ll help you ship fast.</p>
        </div>
        <div className="contact-card">
          <div>
            <div className="contact-label">Email</div>
            <div className="contact-value">luikienle@gmail.com</div>
          </div>
          <div>
            <div className="contact-label">Phone</div>
            <div className="contact-value">+49 152 36760377</div>
          </div>
          <div>
            <div className="contact-label">Gumroad</div>
            <div className="contact-value">https://ludwigkienle.gumroad.com/l/bimhsp</div>
          </div>
        </div>
      </section>

      <LandingFooter
        brandLabel="AI Video Production Editor"
        platformHref="./studio.html"
        platformLabel="Open Studio"
        portalHref={null}
      />
    </LandingLayout>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<DocsPage />);
}

export default DocsPage;
