import * as esbuild from 'esbuild';
import * as sass from 'sass';
import { writeFileSync, cpSync } from 'node:fs';

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

// Compile Sass to plain CSS.
const cssResult = sass.compile('sass/visual-debugger.scss', {
  style: 'expanded',
  sourceMap: true,
  });

writeFileSync('dist/visual-debugger.css', cssResult.css);
writeFileSync(
  'dist/visual-debugger.css.map',
  JSON.stringify(cssResult.sourceMap)
);

// Minified CSS build for production libraries.yml.
const cssMinResult = sass.compile('sass/visual-debugger.scss', {
  style: 'compressed',
});
writeFileSync('dist/visual-debugger.min.css', cssMinResult.css);

// Copy the icon font files alongside the compiled CSS — the CSS's
// @font-face src URLs are relative to dist/, e.g. "fonts/visual-debugger-icons.ttf".
cpSync('fonts/visual-debugger-icons/fonts', 'dist/fonts', { recursive: true });

console.log(
  'Build complete: dist/visual-debugger.{esm,cjs,global,global.min}.js, dist/visual-debugger.{css,min.css}, dist/fonts'
);
