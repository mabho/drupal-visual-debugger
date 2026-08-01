# drupal-visual-debugger

Framework-agnostic engine that renders on-screen overlays and a fly-out
inspector panel from Drupal's Twig theme-debug output. This package has no
dependency on Drupal at runtime — it only needs the debug HTML comments
Drupal's Twig debugging writes into the page. It's consumed by:

- the `visual_debugger` Drupal module (as a vendored/CDN'd library), and
- the Drupal Visual Debugger Chrome extension (as a bundled dependency).

## Requirements for the page being inspected

Twig debugging must be enabled (`services.yml` -> `twig.config.debug: true`,
or the equivalent `development.services.yml` override). Without it, Drupal
doesn't emit the `THEME DEBUG` / `THEME HOOK` / `BEGIN OUTPUT` comments this
library parses, and there's nothing to render. This is true whether you're
using the Drupal module or the Chrome extension.

## Usage

```js
import { init } from 'drupal-visual-debugger';

init();
```

With options:

```js
import { init, webStorageAdapter } from 'drupal-visual-debugger';

init({
  root: document.body,
  storage: webStorageAdapter, // swap for a chrome.storage adapter in the extension
  strings: { activateDebugger: 'Ativar depurador' }, // override any default string
  debug: false,
});
```

As a plain script (no bundler), once built:

```html
<link rel="stylesheet" href="dist/visual-debugger.min.css">
<link rel="stylesheet" href="dist/visual-debugger.fonts.css">
<script src="dist/visual-debugger.global.min.js"></script>
<script>DrupalVisualDebugger.init();</script>
```

Both stylesheets are required for the **overlay** (the highlighted boxes
drawn over inspected page elements) — `visual-debugger.min.css` is this
package's own compiled styles (layout, color, sizing — all driven by CSS
custom properties, see "CSS" below); `visual-debugger.fonts.css` is the
vendored icon font's `@font-face` + glyph declarations (see "Icon font"
below). They ship as two separate files rather than one bundle on purpose.

The **controller panel** (the fly-out inspector) doesn't need either file —
it renders behind a Shadow DOM boundary with its own embedded copy of both,
so it's fully self-contained and immune to the host page's CSS in both
directions. See "Shadow DOM" below.

## Build

```
npm install
npm run build
```

Produces, all under `dist/`:

- `visual-debugger.{esm,cjs,global,global.min}.js` — the JS bundles (see `build.mjs`'s `jsBuilds` for what each targets).
- `visual-debugger.{css,min.css}` (+ `.css.map`) — this package's own styles, compiled from `sass/visual-debugger.scss`.
- `visual-debugger.fonts.css` — the vendored icon font's CSS, copied as-is (see "Icon font" below).
- `fonts/` — the icon font's binary files (`.ttf`/`.woff`/`.svg`), copied as-is.

Along the way, `build.mjs` also (re)generates `generated/panelStyles.css` —
a build-time-only, gitignored file (kept out of `src/`, which is otherwise
all hand-authored) that `controllerPanel.js` imports directly; it's not
part of the published package on its own, only embedded into the JS
bundles above. See "Shadow DOM" below.

## Source map — old module file to new module

| Original (`visual_debugger/js/source/...`) | New location | Notes |
| --- | --- | --- |
| `vd.js` — comment parsing | `src/parser/drupalThemeDebugParser.js` | Regexes rewritten as literals (see below); Drupal-specific by design. |
| `vd.js` — layer generation, resize/mutation observers | `src/render/overlayLayer.js` | Fully agnostic; no Drupal references. |
| `themeElement.js` | `src/model/themeElement.js` | Now a plain factory (`createEmptyThemeElement()`), not a mutated-and-reset singleton. |
| `controllerElement.js` | `src/render/controllerPanel.js` | `Drupal.t()` → injected `strings`; `localStorage` → injected `storage` adapter. |
| (scattered `classNames`/`ids` in both files) | `src/constants.js` | Consolidated once; class names/IDs/attributes kept identical to the original for CSS compatibility. |

## Notable changes from the original module

- **Regex bug fix**: the theme-suggestions regex was built via
  `new RegExp("...\\s*\\n\\s*...")` from a plain string, where `\s` isn't a
  recognized JS string escape and silently became a literal `s`. It happened
  to keep working because the `s*` was optional, but it wasn't matching
  whitespace as intended. Rewritten as a real regex literal
  (`/FILE NAME SUGGESTIONS:\s*\n\s*([^']*)\s*\n*\s*/`) in
  `drupalThemeDebugParser.js`.
- **No more shared mutable singleton**: `Drupal.themeElement` was a single
  object mutated while scanning, then shallow-cloned per match and reset via
  `Object.assign(this, this.initialState)`. The parser now just creates a
  fresh plain object per match — same result, no shared state to reason
  about.
- **Storage and strings are injectable**: `controllerPanel.js` takes a
  `storage` adapter and a `strings` object instead of calling
  `localStorage` and `Drupal.t()` directly, so the same code works unchanged
  inside a Chrome extension's content script.
- **Factory instead of singleton**: `createControllerPanel()` returns an
  independent instance via closures, rather than a shared object-literal
  mutated via `this`.

## CSS

This package intentionally keeps every class name, element ID, and
data-attribute identical to the original module (see `src/constants.js`),
so the `sass/` here is a near-direct port of the original module's
`css/source`. It's entirely var-driven — every rule reads a `--vd-*` custom
property (prefix is `$prefix` in `sass/base/_variables.scss`) rather than a
literal value, so a consumer can re-theme the whole panel by overriding CSS
custom properties without touching the Sass. `npm run build` compiles
`sass/visual-debugger.scss` with Dart Sass into `dist/visual-debugger.css`
/ `.min.css`.

### Icon font

The icons (`.icon-eye`, `.icon-checkbox-checked`, etc.) come from a vendored
[IcoMoon](https://icomoon.io/) icon font package at
`fonts/visual-debugger-icons/`. That folder is IcoMoon's own export as
downloaded — untouched, not authored in this repo:

- `style.css` / `style.scss` — IcoMoon's own compiled CSS and its `.scss`
  source (`@font-face` + one `.icon-x:before { content: ... }` rule per
  icon).
- `variables.scss` — the glyph-code variables `style.scss` uses.
- `fonts/*.ttf`, `*.woff`, `*.svg` — the font binaries.
- `selection.json` — IcoMoon's project file; upload this back to
  icomoon.io's "Import Project" to edit the icon set (see "Replacing the
  icon set" below).
- `demo.html`, `demo-files/`, `Read Me.txt` — IcoMoon's own demo/reference
  files, not used by the build.

**Why `style.css` is copied instead of compiling `style.scss`**: `style.scss`
uses legacy `@import` plus unnamespaced variables (`$icomoon-font-path`,
`$icomoon-font-family` from `variables.scss`) — the pre-`@use` way of
parameterizing a Sass partial. Wiring that into this project's `@use`-based
module setup would mean forking/adapting IcoMoon's generated file just to
re-emit the exact same handful of rules it already compiled correctly. So
`build.mjs` doesn't feed `style.scss` into the Dart Sass compile at all —
it copies IcoMoon's own precompiled `style.css` verbatim to
`dist/visual-debugger.fonts.css`, and copies `fonts/visual-debugger-icons/fonts/`
to `dist/fonts/` alongside it (both `style.css` and the copied file's
`@font-face` `src: url(...)` are relative paths like
`fonts/visual-debugger-icons.ttf`, so this only works because the CSS file
and the `fonts/` folder land as siblings inside `dist/`).

Icon *sizing and color* (as opposed to which glyph a class renders) is a
separate concern handled by this package's own `sass/base/_icons.scss` —
e.g. `.icon-eye { font-size: ... }` — which is real Sass, compiled normally
into `visual-debugger.css` alongside everything else.

**Replacing the icon set**: to add, remove, or change an icon, go to
[icomoon.io/app](https://icomoon.io/app), import
`fonts/visual-debugger-icons/selection.json` ("Import Project"), make your
changes, then "Generate Font" and download the resulting package. Unzip it
and replace every file inside `fonts/visual-debugger-icons/` with the new
package's contents (keep the folder name). Then `npm run build` — no code
changes needed elsewhere unless you renamed or removed an icon class that's
referenced in `src/constants.js` (e.g. `CLASS_NAMES.iconEye`).

### Open Sans

The panel's typography uses [Open Sans Semi Condensed](https://fonts.google.com/specimen/Open+Sans),
vendored as static TTFs in `fonts/open-sans/` (downloaded from Google
Fonts, as-is — not fetched at build time, for the same reason as the icon
font: the panel is self-contained and shouldn't depend on Google's CDN
being reachable, or on a `<link>`/`@import` sitting in the host page's
`<head>` reliably applying inside a Shadow DOM). Only three weights are
vendored/embedded: Light (300, used for headings —
`--vd-font-family--title`/`--vd-font-weight--title`), Medium (500, body
content — `--vd-font-family--content`/`--vd-font-weight--content`), and
Bold (700, e.g. the active tab). There's no true Regular/400 cut of this
condensed style, so content is deliberately set to weight 500 rather than
mislabeling the Medium face as 400. Italic cuts were also downloaded but
aren't embedded — nothing in the panel renders italic text today.

`build.mjs`'s `buildOpenSansFontFaceCss()` converts each vendored TTF to
WOFF2 (via the `wawoff2` devDependency — pure JS/WASM, no native build
step) and base64-embeds the result directly into
`generated/panelStyles.css`, alongside the icon font (see "Shadow DOM"
below and above). WOFF2 roughly halves the size versus embedding the raw
TTFs. To change weights or swap in a different Google Font: replace the
files in `fonts/open-sans/`, update the `OPEN_SANS_FACES` list in
`build.mjs` to match, and update `--font-family--title`/`--font-family--content`
in `sass/base/_variables.scss` if the family name changed.

## Shadow DOM

The controller panel (`createControllerPanel` /
`render/controllerPanel.js`) renders inside a Shadow DOM (`{ mode: 'open'
}`), so the host page's CSS can't affect anything inside the panel, and
nothing the panel declares — including every `--vd-*` custom property —
can affect anything outside it. Concretely:

- `panel.controllerLayer` (what you append to the document, e.g. in
  `init()`) is a bare host `<div id="visual-debugger--controller-host">`
  with no `visual-debugger*` classes of its own — nothing for a page's CSS
  to coincidentally match. All the real panel markup lives inside its
  `.shadowRoot`.
- That shadow root's own `<style>` starts with `:host { all: initial; }`,
  which resets every *inherited* CSS property (font, color, line-height,
  and any `--vd-*` custom property a page might set on `:root`/`body`) at
  the boundary. Without this, inherited properties would still cross into
  the shadow tree by normal CSS inheritance — Shadow DOM's rule-scoping on
  its own only stops *matched* rules from crossing, not inheritance.
- That same stylesheet is a self-contained copy of the panel's compiled
  CSS plus the icon font and Open Sans (base64-embedded WOFF2, converted
  from the vendored TTFs) — see `build.mjs`'s `buildPanelStyles()` and
  "Icon font" / "Open Sans" above for why both fonts are embedded rather
  than linked by a relative path or loaded from Google (a relative `url()`
  inside an injected `<style>` resolves against the *host page's* URL, not
  this library's, so the normal relative-path font CSS would 404 if reused
  as-is).
- The overlay (`createOverlayEngine` / `render/overlayLayer.js`) is
  deliberately **not** behind a Shadow DOM boundary — its highlighted boxes
  are positioned over real page elements in the light DOM and don't need
  this. It still relies on the standalone `visual-debugger.min.css` /
  `.fonts.css` files being linked (see "Usage" above).
- One consequence: overriding a `--vd-*` custom property from the host
  page's own CSS (e.g. `:root { --vd-color--object-type--node: red; }`)
  still reaches the overlay, but no longer reaches the panel — theming the
  panel now requires either changing `sass/base/_variables.scss` and
  rebuilding, or (not currently wired up) exposing a way to pass extra CSS
  into the embedded stylesheet.

## License

GPL-2.0-or-later (matches Drupal.org contribution requirements for the
`visual_debugger` module this package feeds into).
