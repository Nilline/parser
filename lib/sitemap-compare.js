/**
 * Sitemap Comparison Module
 * Compares Webflow (prod) sitemap with Next.js (dev) sitemap
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const EXPECTED_LANGUAGES = ['ar', 'es', 'de', 'fr', 'pt', 'it', 'zh', 'ko', 'ja', 'nl', 'en'];

/**
 * Fetch URL content with timeout
 */
function fetchUrl(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'SitemapCompare/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Parse sitemap XML and extract URLs with hreflang
 */
function parseSitemap(xml) {
  const urls = new Map();

  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let match;

  while ((match = urlRegex.exec(xml)) !== null) {
    const urlBlock = match[1];

    const locMatch = urlBlock.match(/<loc>([^<]+)<\/loc>/);
    if (!locMatch) continue;
    const loc = locMatch[1].trim();

    const slug = extractSlug(loc);

    const hreflangs = new Map();
    const hreflangRegex = /hreflang="([^"]+)"\s+href="([^"]+)"/g;
    let hrefMatch;
    while ((hrefMatch = hreflangRegex.exec(urlBlock)) !== null) {
      hreflangs.set(hrefMatch[1], hrefMatch[2]);
    }

    const hasXDefault = hreflangs.has('x-default');

    if (!urls.has(slug)) {
      urls.set(slug, {
        loc,
        hreflangs,
        hasXDefault,
        languages: new Set()
      });
    }

    const urlLang = extractLanguage(loc);
    if (urlLang) {
      urls.get(slug).languages.add(urlLang);
    }

    for (const [lang, href] of hreflangs) {
      urls.get(slug).hreflangs.set(lang, href);
      if (lang !== 'x-default') {
        urls.get(slug).languages.add(lang);
      }
    }
  }

  return urls;
}

/**
 * Extract slug from URL (preserves category prefixes like blog/, alternatives/)
 */
function extractSlug(url) {
  try {
    const u = new URL(url);
    let pathname = u.pathname;

    pathname = pathname.replace(/^\//, '');

    const langPrefixes = ['ar/', 'es/', 'de/', 'fr/', 'pt/', 'it/', 'zh/', 'ko/', 'ja/', 'nl/', 'en/'];
    for (const prefix of langPrefixes) {
      if (pathname.startsWith(prefix)) {
        pathname = pathname.slice(prefix.length);
        break;
      }
    }

    pathname = pathname.replace(/\/$/, '');

    if (!pathname || EXPECTED_LANGUAGES.includes(pathname)) {
      return '__homepage__';
    }

    return pathname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Extract canonical slug from hreflang group
 */
function extractCanonicalSlug(hreflangs) {
  const canonical = hreflangs.get('x-default') || hreflangs.get('en');
  if (canonical) {
    return extractSlug(canonical);
  }
  for (const [lang, url] of hreflangs) {
    if (lang !== 'x-default') {
      return extractSlug(url);
    }
  }
  return null;
}

/**
 * Extract language from URL
 */
function extractLanguage(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/^\//, '');

    for (const lang of EXPECTED_LANGUAGES) {
      if (pathname === lang || pathname.startsWith(lang + '/')) {
        return lang;
      }
    }

    return 'en';
  } catch {
    return null;
  }
}

/**
 * Group URLs by canonical slug
 */
function groupByCanonicalSlug(urls) {
  const grouped = new Map();

  for (const [originalSlug, data] of urls) {
    const canonicalSlug = extractCanonicalSlug(data.hreflangs) || originalSlug;

    if (!grouped.has(canonicalSlug)) {
      grouped.set(canonicalSlug, {
        languages: new Set(),
        hreflangs: new Map(),
        hasXDefault: false,
        originalSlugs: new Set()
      });
    }

    const group = grouped.get(canonicalSlug);
    group.hasXDefault = group.hasXDefault || data.hasXDefault;
    group.originalSlugs.add(originalSlug);

    for (const lang of data.languages) {
      group.languages.add(lang);
    }

    for (const [lang, href] of data.hreflangs) {
      group.hreflangs.set(lang, href);
      if (lang !== 'x-default') {
        group.languages.add(lang);
      }
    }
  }

  return grouped;
}

/**
 * Compare two sitemaps
 */
function compareSitemaps(webflowGrouped, nextjsGrouped) {
  const issues = {
    missingInNextjs: [],
    missingInWebflow: [],
    missingLanguages: [],
    missingXDefault: []
  };

  const stats = {
    webflowSlugs: webflowGrouped.size,
    nextjsSlugs: nextjsGrouped.size,
    matchingSlugs: 0,
    perfectMatch: 0
  };

  for (const [slug, webflowData] of webflowGrouped) {
    const nextjsData = nextjsGrouped.get(slug);

    if (!nextjsData) {
      issues.missingInNextjs.push({
        slug,
        languages: [...webflowData.languages]
      });
      continue;
    }

    stats.matchingSlugs++;
    let isPerfect = true;

    const missingLangs = [];
    for (const lang of EXPECTED_LANGUAGES) {
      const inWebflow = webflowData.languages.has(lang) || webflowData.hreflangs.has(lang);
      const inNextjs = nextjsData.languages.has(lang) || nextjsData.hreflangs.has(lang);

      if (inWebflow && !inNextjs) {
        missingLangs.push(lang);
        isPerfect = false;
      }
    }

    if (missingLangs.length > 0) {
      issues.missingLanguages.push({
        slug,
        missing: missingLangs,
        hasInWebflow: [...webflowData.languages],
        hasInNextjs: [...nextjsData.languages]
      });
    }

    if (webflowData.hasXDefault && !nextjsData.hasXDefault) {
      issues.missingXDefault.push(slug);
      isPerfect = false;
    }

    if (isPerfect) {
      stats.perfectMatch++;
    }
  }

  for (const [slug, data] of nextjsGrouped) {
    if (!webflowGrouped.has(slug)) {
      issues.missingInWebflow.push({
        slug,
        languages: [...data.languages]
      });
    }
  }

  return { issues, stats };
}

/**
 * Load sitemap from file or URL
 */
async function loadSitemap(source, onProgress) {
  if (source.startsWith('http')) {
    onProgress?.(`Fetching sitemap from ${source}...`);
    return await fetchUrl(source);
  } else {
    onProgress?.(`Loading sitemap from file: ${source}`);
    return fs.readFileSync(source, 'utf8');
  }
}

/**
 * Fetch all sub-sitemaps from sitemap index
 */
async function fetchSitemapIndex(baseUrl, onProgress) {
  const indexUrl = `${baseUrl}/sitemap.xml`;
  onProgress?.(`Fetching sitemap index: ${indexUrl}`);

  const indexXml = await fetchUrl(indexUrl);

  const sitemapLocs = [];
  const locRegex = /<loc>([^<]+)<\/loc>/g;
  let locMatch;
  while ((locMatch = locRegex.exec(indexXml)) !== null) {
    sitemapLocs.push(locMatch[1]);
  }

  onProgress?.(`Found ${sitemapLocs.length} sub-sitemaps`);

  const allUrls = new Map();

  for (const loc of sitemapLocs) {
    const sitemapUrl = loc.replace('http://localhost:3000', baseUrl);
    const filename = sitemapUrl.split('/').pop();
    onProgress?.(`Fetching: ${filename}`);

    try {
      const subXml = await fetchUrl(sitemapUrl);
      const subUrls = parseSitemap(subXml);

      for (const [slug, data] of subUrls) {
        if (!allUrls.has(slug)) {
          allUrls.set(slug, data);
        } else {
          const existing = allUrls.get(slug);
          for (const lang of data.languages) {
            existing.languages.add(lang);
          }
          for (const [lang, href] of data.hreflangs) {
            existing.hreflangs.set(lang, href);
          }
          existing.hasXDefault = existing.hasXDefault || data.hasXDefault;
        }
      }

      onProgress?.(`  Found ${subUrls.size} URLs in ${filename}`);
    } catch (err) {
      onProgress?.(`  Failed to fetch ${filename}: ${err.message}`);
    }
  }

  return allUrls;
}

/**
 * Generate HTML report
 */
function generateHtmlReport(comparison, stats, config) {
  const { issues } = comparison;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sitemap Comparison Report</title>
  <style>
    /* Dark theme - based on Nilux Transcriber */
    :root {
      --bg-primary: #0a0a0b;
      --bg-secondary: #111113;
      --bg-tertiary: #18181b;
      --bg-elevated: #1f1f23;
      --border-subtle: #27272a;
      --border-default: #3f3f46;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --text-tertiary: #71717a;
      --accent-primary: #3b82f6;
      --accent-success: #22c55e;
      --accent-warning: #f59e0b;
      --accent-error: #ef4444;
    }

    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: var(--bg-primary); color: var(--text-primary); }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: var(--text-primary); border-bottom: 2px solid var(--accent-success); padding-bottom: 10px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .card { background: var(--bg-secondary); padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); text-align: center; border: 1px solid var(--border-subtle); }
    .card h3 { margin: 0 0 10px 0; color: var(--text-secondary); font-size: 14px; text-transform: uppercase; }
    .card .value { font-size: 36px; font-weight: bold; color: var(--text-primary); }
    .card.success { border-color: var(--accent-success); background: rgba(34, 197, 94, 0.1); }
    .card.success .value { color: var(--accent-success); }
    .card.warning { border-color: var(--accent-warning); background: rgba(245, 158, 11, 0.1); }
    .card.warning .value { color: var(--accent-warning); }
    .card.error { border-color: var(--accent-error); background: rgba(239, 68, 68, 0.1); }
    .card.error .value { color: var(--accent-error); }
    .card.info { border-color: var(--accent-primary); background: rgba(59, 130, 246, 0.1); }
    .card.info .value { color: var(--accent-primary); }
    .section { background: var(--bg-secondary); padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid var(--border-subtle); }
    .section h2 { margin-top: 0; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px; }
    .list { max-height: 400px; overflow-y: auto; }
    .list-item { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); font-family: monospace; font-size: 13px; color: var(--text-primary); }
    .list-item:hover { background: var(--bg-tertiary); }
    .list-item .langs { color: var(--text-secondary); font-size: 11px; margin-left: 10px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 5px; }
    .badge.missing { background: rgba(239, 68, 68, 0.2); color: var(--accent-error); }
    .badge.new { background: rgba(59, 130, 246, 0.2); color: var(--accent-primary); }
    .empty { color: var(--text-tertiary); font-style: italic; padding: 20px; text-align: center; }
    .config { background: var(--bg-tertiary); padding: 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; border: 1px solid var(--border-subtle); }
    .config span { margin-right: 20px; color: var(--text-secondary); }
    .config strong { color: var(--text-primary); }
    .filter-buttons { margin-bottom: 15px; }
    .filter-btn { padding: 8px 16px; margin-right: 8px; border: 1px solid var(--border-default); border-radius: 4px; cursor: pointer; background: var(--bg-tertiary); color: var(--text-secondary); }
    .filter-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .filter-btn.active { background: var(--accent-success); color: var(--bg-primary); border-color: var(--accent-success); }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-subtle); }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔍 Sitemap Comparison Report</h1>

    <div class="config">
      <span><strong>Prod:</strong> ${config.prodUrl}</span>
      <span><strong>Dev:</strong> ${config.devUrl}</span>
      <span><strong>Generated:</strong> ${new Date().toLocaleString()}</span>
    </div>

    <div class="summary">
      <div class="card info">
        <h3>Webflow Slugs</h3>
        <div class="value">${stats.webflowSlugs.toLocaleString()}</div>
      </div>
      <div class="card info">
        <h3>Next.js Slugs</h3>
        <div class="value">${stats.nextjsSlugs.toLocaleString()}</div>
      </div>
      <div class="card success">
        <h3>Matching</h3>
        <div class="value">${stats.matchingSlugs.toLocaleString()}</div>
      </div>
      <div class="card success">
        <h3>Perfect Match</h3>
        <div class="value">${stats.perfectMatch.toLocaleString()}</div>
      </div>
      <div class="card error">
        <h3>Missing in Dev</h3>
        <div class="value">${issues.missingInNextjs.length}</div>
      </div>
      <div class="card warning">
        <h3>New in Dev</h3>
        <div class="value">${issues.missingInWebflow.length}</div>
      </div>
      <div class="card warning">
        <h3>Missing Languages</h3>
        <div class="value">${issues.missingLanguages.length}</div>
      </div>
    </div>

    ${issues.missingInNextjs.length > 0 ? `
    <div class="section">
      <h2>❌ Missing in Next.js (${issues.missingInNextjs.length})</h2>
      <p style="color: var(--text-secondary); margin-bottom: 15px;">These pages exist in Webflow but not in Next.js</p>
      <div class="list">
        ${issues.missingInNextjs.map(item => `
          <div class="list-item">
            <span class="badge missing">MISSING</span>
            ${item.slug}
            <span class="langs">(${item.languages.length} langs)</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${issues.missingInWebflow.length > 0 ? `
    <div class="section">
      <h2>ℹ️ New in Next.js (${issues.missingInWebflow.length})</h2>
      <p style="color: var(--text-secondary); margin-bottom: 15px;">These pages exist in Next.js but not in Webflow (new pages)</p>
      <div class="list">
        ${issues.missingInWebflow.map(item => `
          <div class="list-item">
            <span class="badge new">NEW</span>
            ${item.slug}
            <span class="langs">(${item.languages.length} langs)</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${issues.missingLanguages.length > 0 ? `
    <div class="section">
      <h2>⚠️ Missing Languages (${issues.missingLanguages.length})</h2>
      <p style="color: var(--text-secondary); margin-bottom: 15px;">These pages exist but are missing some language versions</p>
      <div class="list">
        ${issues.missingLanguages.map(item => `
          <div class="list-item">
            ${item.slug}
            <span class="langs">Missing: ${item.missing.join(', ')}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${issues.missingInNextjs.length === 0 && issues.missingLanguages.length === 0 ? `
    <div class="section">
      <h2>✅ All Checks Passed!</h2>
      <p class="empty">No issues found. Next.js sitemap matches Webflow sitemap.</p>
    </div>
    ` : ''}
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Main comparison function
 */
async function runComparison(config, onProgress) {
  const { prodSitemapPath, devUrl } = config;

  // Load Webflow sitemap
  onProgress?.({ type: 'status', message: 'Loading Webflow sitemap...' });
  const webflowXml = await loadSitemap(prodSitemapPath, onProgress);
  const webflowUrls = parseSitemap(webflowXml);
  const webflowGrouped = groupByCanonicalSlug(webflowUrls);
  onProgress?.({ type: 'status', message: `Webflow: ${webflowUrls.size} URLs, ${webflowGrouped.size} unique slugs` });

  // Load Next.js sitemaps
  onProgress?.({ type: 'status', message: 'Loading Next.js sitemaps...' });
  const nextjsUrls = await fetchSitemapIndex(devUrl, (msg) => onProgress?.({ type: 'status', message: msg }));
  const nextjsGrouped = groupByCanonicalSlug(nextjsUrls);
  onProgress?.({ type: 'status', message: `Next.js: ${nextjsUrls.size} URLs, ${nextjsGrouped.size} unique slugs` });

  // Compare
  onProgress?.({ type: 'status', message: 'Comparing sitemaps...' });
  const comparison = compareSitemaps(webflowGrouped, nextjsGrouped);

  return {
    comparison,
    stats: comparison.stats,
    webflowCount: webflowUrls.size,
    nextjsCount: nextjsUrls.size
  };
}

module.exports = {
  runComparison,
  generateHtmlReport,
  parseSitemap,
  groupByCanonicalSlug,
  compareSitemaps,
  fetchSitemapIndex
};
