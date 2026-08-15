/**
 * Default strings for the controller panel. The Drupal module wrapper
 * should override these with Drupal.t()-resolved translations; the Chrome
 * extension can pass its own i18n messages (e.g. via chrome.i18n) or just
 * use these defaults.
 */
export const defaultStrings = {
  copyToClipboard: 'Copy to clipboard',
  debuggerActivated: 'Debugger activated',
  basicInfo: 'Object Type',
  themeSuggestions: 'Theme Suggestions',
  clickDragButton: 'Click and drag to resize',
  templateFilePath: 'Template File Path',
  folderPath: 'Folder path',
  activeElement: 'Active Element',
  noActiveElement: 'No active element.',
  noSelectedElement: 'No selected element.',
  tabSelected: 'Selected',
  tabList: 'List',
  tabItems: 'Items',
  subViewListed: 'Listed',
  subViewBranched: 'Branched',
  subViewGrouped: 'Grouped',
  toggleExpandCollapse: 'Expand/collapse',
  aggregateGroups: 'Aggregate',
  allElements: 'All Elements',
  tabCache: 'Cache',
  cacheHit: 'Cache Hit',
  cacheMiss: 'Cache Miss',
  cacheTags: 'Cache Tags',
  cacheContexts: 'Cache Contexts',
  cacheKeys: 'Cache Keys',
  cacheMaxAge: 'Cache Max-Age',
  preBubblingCacheTags: 'Pre-Bubbling Cache Tags',
  preBubblingCacheContexts: 'Pre-Bubbling Cache Contexts',
  preBubblingCacheKeys: 'Pre-Bubbling Cache Keys',
  preBubblingCacheMaxAge: 'Pre-Bubbling Cache Max-Age',
  renderingTime: 'Rendering Time',
  noElementForCacheEntry: 'No page element resolved for this cache entry.',
  noDebugDataTitle: 'No Drupal debug data found',
  noDebugDataMessage: 'This page may not be a Drupal site, or Twig debugging is turned off.',
  noDebugDataHint:
    "To enable it, set twig.config.debug: true in your site's services.yml (commonly sites/development.services.yml), disable Twig cache, then rebuild the site's cache.",
};
