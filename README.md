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
<script src="dist/visual-debugger.global.min.js"></script>
<script>DrupalVisualDebugger.init();</script>
```

## Build

```
npm install
npm run build
```

Produces `dist/visual-debugger.{esm,cjs,global,global.min}.js`.

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
so the existing `css/source` styles from `visual_debugger` can be reused
with little to no changes. Porting that CSS is the next step.

## License

GPL-2.0-or-later (matches Drupal.org contribution requirements for the
`visual_debugger` module this package feeds into).
