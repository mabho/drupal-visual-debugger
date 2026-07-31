import * as esbuild from 'esbuild';
import * as sass from 'sass';
import { writeFileSync, cpSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
  target: ['es2019'],
};

const jsBuilds = [
  // ESM build — for the Chrome extension's bundler and any modern consumer.
  { ...shared, format: 'esm', outfile: 'dist/visual-debugger.esm.js' },
  // CommonJS build — for Node-based tooling / older bundlers.
  { ...shared, format: 'cjs', outfile: 'dist/visual-debugger.cjs.js' },
  // Global/IIFE build — for the Drupal module to reference directly as a
  // <script> via visual_debugger.libraries.yml, no bundler required.
  {
    ...shared,
    format: 'iife',
    globalName: 'DrupalVisualDebugger',
    outfile: 'dist/visual-debugger.global.js',
  },
  // Minified global build for production libraries.yml.
  {
    ...shared,
    format: 'iife',
    globalName: 'DrupalVisualDebugger',
    outfile: 'dist/visual-debugger.global.min.js',
    minify: true,
  },
];

function buildStyles() {
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

  // The icon font (fonts/visual-debugger-icons/) is a vendored IcoMoon
  // package. Its .scss uses legacy @import + unnamespaced variable
  // overrides (the pre-@use way of parameterizing a partial), which isn't
  // worth adapting to this project's @use-based Dart Sass setup just to
  // re-emit the same handful of @font-face/content rules IcoMoon already
  // compiled. So instead of feeding its .scss into the Sass compile above,
  // we copy its precompiled style.css over as-is. See README "Icon font".
  cpSync('fonts/visual-debugger-icons/style.css', 'dist/visual-debugger.fonts.css');

  // Copy the icon font binaries alongside the compiled CSS — both
  // visual-debugger.fonts.css's and the IcoMoon demo's @font-face src URLs
  // are relative, e.g. "fonts/visual-debugger-icons.ttf".
  cpSync('fonts/visual-debugger-icons/fonts', 'dist/fonts', { recursive: true });
}

if (watch) {
  const { watch: watchFs } = await import('node:fs');

  // esbuild's own context().watch() uses its Go binary's file watcher, which
  // doesn't reliably pick up changes in this environment. Rebuilding via
  // Node's fs.watch (same mechanism as the Sass watcher below) is reliable.
  const contexts = await Promise.all(
    jsBuilds.map((options) => esbuild.context(options))
  );

  const rebuildJs = () =>
    Promise.all(contexts.map((ctx) => ctx.rebuild())).catch((error) =>
      console.error('JS rebuild failed:', error.message)
    );

  await rebuildJs();
  watchFs('src', { recursive: true }, () => {
    rebuildJs().then(() => console.log('Rebuilt JS.'));
  });

  buildStyles();
  watchFs('sass', { recursive: true }, () => {
    try {
      buildStyles();
      console.log('Rebuilt styles.');
    } catch (error) {
      console.error('Style rebuild failed:', error.message);
    }
  });

  console.log('Watching for changes (src/ and sass/ via fs.watch)...');
} else {
  await Promise.all(jsBuilds.map((options) => esbuild.build(options)));
  buildStyles();

  console.log(
    'Build complete: dist/visual-debugger.{esm,cjs,global,global.min}.js, dist/visual-debugger.{css,min.css,fonts.css}, dist/fonts'
  );
}
