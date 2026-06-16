import React from 'react';

type RouteMatch = {
  path: string;
  params: Record<string, string>;
};

const matchRoute = (hash: string, pattern: string): RouteMatch | null => {
  const path = hash.replace(/^#/, '') || '/';
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    const value = pathParts[i];
    if (part.startsWith(':')) {
      params[part.slice(1)] = value;
    } else if (part !== value) {
      return null;
    }
  }
  return { path, params };
};

export const useHashRoute = (patterns: string[]) => {
  const [hash, setHash] = React.useState(() => window.location.hash || '#/');

  React.useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  for (const pattern of patterns) {
    const match = matchRoute(hash, pattern);
    if (match) {
      return match;
    }
  }

  return { path: '/', params: {} };
};

type LinkProps = React.PropsWithChildren<{
  to: string;
  className?: string;
  style?: React.CSSProperties;
}>;

export const HashLink: React.FC<LinkProps> = ({ to, className, style, children }) => (
  <a className={className} style={style} href={`#${to}`}>
    {children}
  </a>
);
