const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const RESULT_DIR = path.join(__dirname, 'result');
const CSV_ENGLISH = path.join(RESULT_DIR, 'comparison-report-english.csv');
const CSV_OTHER = path.join(RESULT_DIR, 'comparison-report-other-languages.csv');
const HREFLANG_FILE = path.join(RESULT_DIR, 'sitemap_hreflang_groups.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'PAGES_MIGRATION_PROGRESS.md');

// Load hreflang groups
const hreflangData = JSON.parse(fs.readFileSync(HREFLANG_FILE, 'utf-8'));

// Create URL -> canonical mapping (use paths, not full URLs)
const urlToCanonical = new Map();
for (const [canonical, translations] of Object.entries(hreflangData.translation_groups)) {
  for (const url of Object.values(translations)) {
    urlToCanonical.set(url, canonical);
  }
}

// Load comparison reports
const urlsStatus = new Map();

function loadCSV(filePath) {
  return new Promise((resolve) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        urlsStatus.set(row.URL, row.Status);
        results.push(row);
      })
      .on('end', () => resolve(results));
  });
}

async function main() {
  console.log('Loading comparison reports...');
  await loadCSV(CSV_ENGLISH);
  await loadCSV(CSV_OTHER);

  console.log(`Total URLs: ${urlsStatus.size}`);

  // Group by canonical
  const canonicalStatuses = new Map();
  for (const [url, status] of urlsStatus) {
    const canonical = urlToCanonical.get(url);
    if (!canonical) continue;

    if (!canonicalStatuses.has(canonical)) {
      canonicalStatuses.set(canonical, {});
    }
    canonicalStatuses.get(canonical)[url] = status;
  }

  // Analyze ERROR pages
  const fullyError = [];
  const partiallyError = [];

  for (const [canonical, statuses] of canonicalStatuses) {
    const statusValues = Object.values(statuses);
    const errorCount = statusValues.filter(s => s === 'ERROR').length;
    const okCount = statusValues.filter(s => s === 'OK').length;
    const diffCount = statusValues.filter(s => s === 'DIFF').length;

    if (errorCount === statusValues.length) {
      // Fully ERROR
      fullyError.push({
        canonical,
        translations: hreflangData.translation_groups[canonical],
        count: errorCount
      });
    } else if (errorCount > 0) {
      // Partially ERROR
      const errorUrls = Object.entries(statuses)
        .filter(([_, status]) => status === 'ERROR')
        .map(([url, _]) => url);

      partiallyError.push({
        canonical,
        translations: hreflangData.translation_groups[canonical],
        errorCount,
        okCount,
        diffCount,
        errorUrls
      });
    }
  }

  console.log(`\nFully ERROR: ${fullyError.length} pages`);
  console.log(`Partially ERROR: ${partiallyError.length} pages`);

  // Create markdown report
  const lines = [];
  lines.push('# Static Pages Migration Progress\n');
  lines.push(`**Created:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Total Unique Pages:** ${canonicalStatuses.size}`);
  lines.push(`**Fully ERROR (need full migration):** ${fullyError.length}`);
  lines.push(`**Partially ERROR (need translations):** ${partiallyError.length}`);
  lines.push(`**Status:** 🚧 NOT STARTED (0/${fullyError.length + partiallyError.length} - 0%)\n`);
  lines.push('---\n');

  lines.push('## 📊 Overview\n');
  lines.push('**Architecture:** Next.js + Sanity CMS');
  lines.push('**Languages:** en, ar, es, de, fr, pt, it, zh, ko, ja, nl (11 languages)');
  lines.push('**Translation approach:** Each language has unique slug (hreflang links)');
  lines.push('**Data source:** Webflow (prod) → Sanity (dev)\n');
  lines.push('---\n');

  // Fully ERROR pages
  if (fullyError.length > 0) {
    lines.push(`## ❌ Priority 1: Fully ERROR Pages (${fullyError.length} pages)\n`);
    lines.push('**These pages are completely missing - need full migration for all languages.**\n');

    fullyError.forEach((page, i) => {
      const locales = Object.keys(page.translations).join(', ');
      const enUrl = page.translations.en || Object.values(page.translations)[0];

      lines.push(`${i + 1}. **${page.canonical}**`);
      lines.push(`   - Languages: ${Object.keys(page.translations).length} (${locales})`);
      lines.push(`   - Example: ${enUrl}`);
      lines.push(`   - Status: ⏳ Not started\n`);
    });

    lines.push('---\n');
  }

  // Partially ERROR pages
  if (partiallyError.length > 0) {
    lines.push(`## ⚠️ Priority 2: Partially ERROR Pages (${partiallyError.length} pages)\n`);
    lines.push('**These pages exist in some languages but missing translations.**\n');

    partiallyError.forEach((page, i) => {
      const allLocales = Object.keys(page.translations);
      const errorLocales = page.errorUrls
        .map(url => {
          for (const [locale, locPath] of Object.entries(page.translations)) {
            if (locPath === url) return locale;
          }
          return null;
        })
        .filter(Boolean);

      lines.push(`${i + 1}. **${page.canonical}**`);
      lines.push(`   - Total languages: ${allLocales.length}`);
      lines.push(`   - ✅ OK: ${page.okCount}, ⚠️ DIFF: ${page.diffCount}, ❌ ERROR: ${page.errorCount}`);
      lines.push(`   - Missing languages: ${errorLocales.join(', ')}`);
      lines.push(`   - Status: ⏳ Not started\n`);
    });

    lines.push('---\n');
  }

  lines.push(`**Last Updated:** ${new Date().toISOString().split('T')[0]}\n`);

  // Save report
  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');

  console.log(`\n✅ Report saved: ${OUTPUT_FILE}`);
  console.log(`\nSummary:`);
  console.log(`  - Fully ERROR: ${fullyError.length} pages (need full migration)`);
  console.log(`  - Partially ERROR: ${partiallyError.length} pages (need translations)`);
  console.log(`  - Total to migrate: ${fullyError.length + partiallyError.length} pages`);
}

main().catch(console.error);
