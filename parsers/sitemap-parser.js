/**
 * Sitemap Parser
 *
 * Parses sitemap.xml and extracts unique English pages (1 example per template)
 *
 * Usage: node sitemap-parser.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const SITEMAP_URL = 'https://www.coursebox.ai/sitemap.xml';
const OUTPUT_TXT = path.join(__dirname, '..', 'result', 'webflow-pages.txt');
const OUTPUT_STATS = path.join(__dirname, '..', 'result', 'sitemap-stats.json');

// Locales to exclude (keep only English)
const EXCLUDED_LOCALES = ['ar', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'nl', 'pl', 'sv', 'tr', 'he', 'hi', 'th', 'vi', 'id', 'ms', 'fil', 'uk', 'ro', 'cs'];

// Template patterns (only keep 1 example per template)
const TEMPLATE_PATTERNS = [
  { pattern: /^\/rto-materials\/[^\/]+$/, name: '/rto-materials/[slug]' },
  { pattern: /^\/alternatives\/[^\/]+$/, name: '/alternatives/[slug]' },
  { pattern: /^\/blog\/[^\/]+$/, name: '/blog/[slug]' },
  { pattern: /^\/features\/[^\/]+$/, name: '/features/[slug]' },
  { pattern: /^\/team\/[^\/]+$/, name: '/team/[slug]' }
];

/**
 * Check if URL is a localized version (non-English)
 */
function isLocalizedUrl(pathname) {
  return EXCLUDED_LOCALES.some(locale => {
    return pathname === `/${locale}` || pathname.startsWith(`/${locale}/`);
  });
}

/**
 * Detect template pattern for URL
 */
function detectTemplate(pathname) {
  for (const { pattern, name } of TEMPLATE_PATTERNS) {
    if (pattern.test(pathname)) {
      return name;
    }
  }
  return null;
}

/**
 * Fetch and parse sitemap
 */
async function fetchSitemap() {
  console.log('Fetching sitemap...');
  console.log(`URL: ${SITEMAP_URL}\n`);

  const response = await axios.get(SITEMAP_URL);
  const xml = response.data;

  console.log(`Sitemap downloaded (${xml.length} bytes)\n`);
  return xml;
}

/**
 * Parse XML and extract URLs
 */
function parseXml(xml) {
  console.log('Parsing XML...\n');

  const $ = cheerio.load(xml, { xmlMode: true });
  const urls = [];

  $('url loc').each((_, element) => {
    const url = $(element).text().trim();
    if (url) {
      urls.push(url);
    }
  });

  console.log(`Found ${urls.length} URLs in sitemap\n`);
  return urls;
}

/**
 * Filter URLs
 */
function filterUrls(urls) {
  console.log('Filtering URLs...\n');

  const templateExamples = new Map();
  const filtered = [];
  const stats = {
    total: urls.length,
    localized: 0,
    duplicateTemplates: 0,
    unique: 0
  };

  for (const url of urls) {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    // Remove trailing slash
    const cleanPath = pathname.endsWith('/') && pathname !== '/'
      ? pathname.slice(0, -1)
      : pathname;

    // Keep /ar as localization example
    if (cleanPath === '/ar') {
      filtered.push(cleanPath);
      stats.unique++;
      console.log(`  Localization example: ${cleanPath}`);
      continue;
    }

    // Skip other localized
    if (isLocalizedUrl(cleanPath)) {
      stats.localized++;
      continue;
    }

    // Check template
    const template = detectTemplate(cleanPath);
    if (template) {
      if (templateExamples.has(template)) {
        stats.duplicateTemplates++;
        continue;
      }
      templateExamples.set(template, cleanPath);
      console.log(`  Template: ${template} → ${cleanPath}`);
    }

    filtered.push(cleanPath);
    stats.unique++;
  }

  stats.templates = templateExamples.size;
  stats.templateExamples = Object.fromEntries(templateExamples);

  console.log(`   Total URLs: ${stats.total}`);
  console.log(`   Localized (excluded): ${stats.localized} (kept /ar as example)`);
  console.log(`   Template duplicates (excluded): ${stats.duplicateTemplates}`);
  console.log(`   Template patterns: ${stats.templates}`);
  console.log(`   Unique URLs saved: ${stats.unique}\n`);

  return { filtered, stats };
}

/**
 * Save results
 */
function saveResults(urls, stats) {
  // Ensure result directory exists
  const resultDir = path.join(__dirname, '..', 'result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  // Save URL list
  fs.writeFileSync(OUTPUT_TXT, urls.join('\n'), 'utf-8');
  console.log(`URL list saved: ${OUTPUT_TXT}`);
  console.log(`   (${urls.length} URLs)\n`);

  // Save stats
  fs.writeFileSync(OUTPUT_STATS, JSON.stringify(stats, null, 2), 'utf-8');
  console.log(`Statistics saved: ${OUTPUT_STATS}\n`);

  // Show template examples
  if (stats.templateExamples && Object.keys(stats.templateExamples).length > 0) {
    console.log('Template examples:');
    for (const [template, example] of Object.entries(stats.templateExamples)) {
      console.log(`   ${template} → ${example}`);
    }
  }
}

/**
 * Main
 */
async function main() {
  const startTime = Date.now();

  try {
    // Fetch sitemap
    const xml = await fetchSitemap();

    // Parse XML
    const urls = parseXml(xml);

    // Filter URLs
    const { filtered, stats } = filterUrls(urls);

    // Save results
    saveResults(filtered, stats);

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nCompleted in ${duration}s`);
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run
main();
