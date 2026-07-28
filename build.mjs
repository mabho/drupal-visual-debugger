import * as esbuild from 'esbuild';

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
  target: ['es2019'],
};

// ESM build — for the Chrome extension's bundler and any modern consumer.
await esbuild.build({
  ...shared,
  format: 'esm',
  outfile: 'dist/visual-debugger.esm.js',
});

// CommonJS build — for Node-based tooling / older bundlers.
await esbuild.build({
  ...shared,
  format: 'cjs',
  outfile: 'dist/visual-debugger.cjs.js',
});

// Global/IIFE build — for the Drupal module to reference directly as a
// <script> via visual_debugger.libraries.yml, no bundler required.
await esbuild.build({
  ...shared,
  format: 'iife',
  globalName: 'DrupalVisualDebugger',
  outfile: 'dist/visual-debugger.global.js',
});

// Minified global build for production libraries.yml.
await esbuild.build({
  ...shared,
  format: 'iife',
  globalName: 'DrupalVisualDebugger',
  outfile: 'dist/visual-debugger.global.min.js',
  minify: true,
});

console.log('Build complete: dist/visual-debugger.{esm,cjs,global,global.min}.js');
