import * as esbuild from 'esbuild';
import * as sass from 'sass';
import { compress as compressWoff2 } from 'wawoff2';
import { writeFileSync, readFileSync, cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

// package.json is this project's single source of truth for the version
// stamped into every dist/ output below — read once here rather than
// hardcoding it anywhere else so the two can never drift apart.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const repoUrl = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');

// `/*!`, not `/*` — the "preserve this comment" convention nearly every
// CSS/JS minifier (esbuild's own included, though esbuild's `banner`
// bypasses minification entirely anyway — see below) and downstream
// bundler respects, so the banner survives even if the consuming project
// runs this output through its own build step.
const BANNER = `/*!
 * ${pkg.name} v${pkg.version}
 * ${repoUrl}
 * License: ${pkg.license}
 */`;

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
  target: ['es2019'],
  // Lets controllerPanel.js `import panelStyles from
  // '../../generated/panelStyles.css'` and get its contents as a plain
  // string (esbuild's built-in text loader) — see buildPanelStyles() below.
  loader: { '.css': 'text' },
  // Added to every JS output verbatim, *after* bundling/minification —
  // esbuild's own sourcemap generation already accounts for the extra
  // lines this inserts, so all four JS builds (including the minified
  // one) stay correctly mapped with no extra work here.
  banner: { js: BANNER },
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

// Static weights vendored in fonts/open-sans/ (Google Fonts' "Open Sans
// Semi Condensed" cut — see README "Open Sans"). No true Regular/400 cut
// exists for this condensed style, so _variables.scss's content
// font-weight is 500 ("Medium") instead. Italic cuts exist but aren't
// embedded — nothing in the panel renders italic text today.
const OPEN_SANS_FACES = [
  { file: 'OpenSans_SemiCondensed-Light.ttf', weight: 300 },
  { file: 'OpenSans_SemiCondensed-Medium.ttf', weight: 500 },
  { file: 'OpenSans_SemiCondensed-Bold.ttf', weight: 700 },
];

/**
 * Builds `@font-face` rules for the vendored Open Sans Semi Condensed
 * weights, converting each TTF to WOFF2 (roughly half the size) and
 * base64-embedding the result — same reasoning as the icon font's `src:`
 * rewrite in `buildPanelStyles()`: a relative `url()` inside the panel's
 * injected `<style>` would resolve against the *host page's* URL, not
 * this library's.
 *
 * @returns {Promise<string>} The concatenated `@font-face` rules.
 */
async function buildOpenSansFontFaceCss() {
  const faces = await Promise.all(
    OPEN_SANS_FACES.map(async ({ file, weight }) => {
      const ttf = readFileSync(`fonts/open-sans/${file}`);
      const woff2 = await compressWoff2(ttf);
      const base64 = Buffer.from(woff2).toString('base64');
      return `@font-face {
  font-family: 'Open Sans Semi Condensed';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('data:font/woff2;base64,${base64}') format('woff2');
}`;
    })
  );
  return faces.join('\n');
}

/**
 * Generates `generated/panelStyles.css` — the styles the controller panel
 * embeds into its own Shadow DOM, as opposed to `buildStyles()` below,
 * which produces the standalone `dist/*.css` for the overlay's light DOM.
 * Gitignored, like `dist/`. Must run before the esbuild step, since
 * `controllerPanel.js` imports this file directly.
 *
 * Concatenates: (1) `:host { all: initial; }`, resetting inherited CSS at
 * the shadow boundary; (2) the vendored IcoMoon icon font CSS with its
 * `src:` rewritten to a base64 `data:` URI (a relative `url()` in an
 * injected `<style>` resolves against the host page, not this library);
 * (3) the Open Sans `@font-face` rules (`buildOpenSansFontFaceCss()`);
 * (4) the panel's own compiled CSS.
 *
 * @returns {Promise<void>}
 */
async function buildPanelStyles() {
  const hostReset = ':host { all: initial; }';

  const fontBase64 = readFileSync(
    'fonts/visual-debugger-icons/fonts/visual-debugger-icons.woff'
  ).toString('base64');
  const iconsCssSource = readFileSync(
    'fonts/visual-debugger-icons/style.css',
    'utf8'
  );
  const embeddedIconsCss = iconsCssSource.replace(
    /src:[\s\S]*?;/,
    `src: url('data:font/woff;base64,${fontBase64}') format('woff');`
  );

  const openSansCss = await buildOpenSansFontFaceCss();

  const panelCssResult = sass.compile('sass/visual-debugger.scss', {
    style: 'compressed',
  });

  // Unlike esbuild's own `outfile` (which creates missing parent
  // directories automatically), plain writeFileSync doesn't — and unlike
  // dist/, nothing else creates generated/ before this runs.
  mkdirSync('generated', { recursive: true });
  writeFileSync(
    'generated/panelStyles.css',
    [hostReset, embeddedIconsCss, openSansCss, panelCssResult.css].join('\n')
  );
}

/**
 * Prepends `BANNER` to compiled CSS, keeping any sourcemap aligned: each
 * line the banner adds needs one empty `;` entry prepended to the
 * sourcemap's `mappings` string (Source Map v3), or every mapped position
 * ends up off by however many lines the banner pushed the content down.
 *
 * @param {string} css Compiled CSS, banner-free.
 * @param {object} [sourceMap] The sourcemap `sass.compile()` produced for
 *   `css`, if any (the minified build doesn't request one).
 * @returns {{ css: string, sourceMap: object|undefined }}
 */
function prependCssBanner(css, sourceMap) {
  const bannerLineCount = BANNER.split('\n').length;
  return {
    css: `${BANNER}\n${css}`,
    sourceMap: sourceMap && {
      ...sourceMap,
      mappings: ';'.repeat(bannerLineCount) + sourceMap.mappings,
    },
  };
}

function buildStyles() {
  // Compile Sass to plain CSS.
  const cssResult = sass.compile('sass/visual-debugger.scss', {
    style: 'expanded',
    sourceMap: true,
  });
  const banneredCss = prependCssBanner(cssResult.css, cssResult.sourceMap);

  writeFileSync('dist/visual-debugger.css', banneredCss.css);
  writeFileSync(
    'dist/visual-debugger.css.map',
    JSON.stringify(banneredCss.sourceMap)
  );

  // Minified CSS build for production libraries.yml.
  const cssMinResult = sass.compile('sass/visual-debugger.scss', {
    style: 'compressed',
  });
  writeFileSync('dist/visual-debugger.min.css', prependCssBanner(cssMinResult.css).css);

  // The vendored IcoMoon icon font's .scss uses legacy @import, not worth
  // adapting to this project's @use setup — copy its precompiled CSS
  // as-is instead (see README "Icon font"). Not banner-stamped: it's a
  // verbatim third-party copy.
  cpSync('fonts/visual-debugger-icons/style.css', 'dist/visual-debugger.fonts.css');

  // Its @font-face src URLs are relative (e.g. "fonts/visual-debugger-icons.ttf").
  cpSync('fonts/visual-debugger-icons/fonts', 'dist/fonts', { recursive: true });
}

if (watch) {
  const { watch: watchFs } = await import('node:fs');

  // Must exist before the first esbuild pass — controllerPanel.js imports
  // it directly.
  await buildPanelStyles();

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
  watchFs('sass', { recursive: true }, async () => {
    try {
      buildStyles();
      await buildPanelStyles();
      // The panel's styles are embedded in the JS bundle, so a Sass change
      // also needs a JS rebuild to take effect.
      rebuildJs().then(() => console.log('Rebuilt styles.'));
    } catch (error) {
      console.error('Style rebuild failed:', error.message);
    }
  });

  console.log('Watching for changes (src/ and sass/ via fs.watch)...');
} else {
  await buildPanelStyles();
  await Promise.all(jsBuilds.map((options) => esbuild.build(options)));
  buildStyles();

  console.log(
    'Build complete: dist/visual-debugger.{esm,cjs,global,global.min}.js, dist/visual-debugger.{css,min.css,fonts.css}, dist/fonts'
  );
}
