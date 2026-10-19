// Tailwind v3 build of the classes the studio uses. The app loads Tailwind from
// cdn.tailwindcss.com at runtime; recording uses this local build instead, so takes
// look identical and do not depend on that CDN.
const root = require('path').resolve(__dirname, '../../..');
module.exports = {
  content: [`${root}/src/**/*.{ts,tsx,js,jsx}`, `${root}/*.{html,tsx}`, `${root}/{components,workspaces,hooks,utils}/**/*.{ts,tsx}`],
  theme: { extend: {} },
};
