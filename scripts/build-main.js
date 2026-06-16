const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const production = process.env.NODE_ENV === 'production';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    'electron',
    'fsevents'
];

esbuild.build({
    entryPoints: ['electron/main.js', 'electron/preload.js'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: external,
    outdir: 'dist-electron',
    minify: production,
    sourcemap: !production,
    format: 'cjs',
}).then(() => {
    console.log('Main process build finished successfully.');
}).catch(() => {
    console.error('Main process build failed.');
    process.exit(1);
});
