import React from 'react';
import ReactDOM from 'react-dom/client';
import SplashHost from './splash/SplashHost';

const renderFatalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : '';

  let overlay = document.getElementById('fatal-error-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'fatal-error-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = '#0b0f19';
    overlay.style.color = '#e5e7eb';
    overlay.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    overlay.style.padding = '24px';
    overlay.style.zIndex = '9999';
    overlay.style.whiteSpace = 'pre-wrap';
    overlay.style.overflow = 'auto';
    document.body.innerHTML = '';
    document.body.appendChild(overlay);
  }

  overlay.textContent = `Renderer error:\n${message}\n\n${stack}`.trim();
};

window.addEventListener('error', (event) => {
  renderFatalError(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  renderFatalError(event.reason);
});

const applyPlatformAttributes = () => {
  const root = document.documentElement;
  const ua = navigator.userAgent.toLowerCase();
  const isElectron = ua.includes(' electron/') || Boolean((window as unknown as { electron?: unknown }).electron);
  const platform = ua.includes('mac') ? 'mac' : ua.includes('win') ? 'windows' : 'linux';
  root.dataset.runtime = isElectron ? 'electron' : 'web';
  root.dataset.platform = platform;
};

applyPlatformAttributes();

// The start animation gets its own small root so it shows before the (large) app
// module has loaded; the app loads and renders in parallel underneath.
const splashElement = document.createElement('div');
splashElement.id = 'splash-root';
document.body.appendChild(splashElement);
ReactDOM.createRoot(splashElement).render(<SplashHost />);

const rootElement = document.getElementById('root');
if (!rootElement) {
  renderFatalError('Could not find root element to mount to');
} else {
  const root = ReactDOM.createRoot(rootElement);
  // Let the splash paint its first frame before the app module is evaluated (about two frames).
  new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); setTimeout(resolve, 120); })
    .then(() => import('./App'))
    .then(({ default: App }) => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    })
    .catch(renderFatalError);
}
