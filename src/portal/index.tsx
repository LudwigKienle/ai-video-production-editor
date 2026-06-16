import React from 'react';
import ReactDOM from 'react-dom/client';
import { PortalApp } from './PortalApp';

const rootElement = document.getElementById('portal-root');
if (!rootElement) {
  throw new Error('Portal root element not found');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <PortalApp />
  </React.StrictMode>,
);
