import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

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

const rootElement = document.getElementById('root');
if (!rootElement) {
  renderFatalError('Could not find root element to mount to');
} else {
  const root = ReactDOM.createRoot(rootElement);
  try {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    renderFatalError(error);
  }
}
