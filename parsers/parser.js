/**
 * Coursebox Site Comparison Parser
 *
 * Base parser for comparing Production vs Development sites before migration.
 *
 * What it checks:
 * - URL availability (HTTP status)
 * - Title tags (<title>)
 * - Meta descriptions (<meta name="description">)
 * - H1 headings (all <h1> tags)
 * - OG images (<meta property="og:image">)
 *
 * Output:
 * - CSV report (comparison-report.csv)
 * - HTML report (comparison-report.html) with highlighted differences
 *
 * Usage:
 *   npm start
 *
 * Configuration:
 * - URLs list: urls-main.txt
 * - Delay between requests: 1000ms (to avoid server bans)
 * - Reports saved to: result/ directory
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const PROD_URL = 'https://www.coursebox.ai';
const DEV_URL = 'https://coursebox-ai.vercel.app';
const DELAY_MS = 1000;
const URLS_FILE = '../urls-main.txt';
const OUTPUT_CSV = '../result/comparison-report.csv';
const OUTPUT_HTML = '../result/comparison-report.html';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Adjust URL for Dev environment
 * RTO materials need /en/ prefix on Dev but not on Prod
 */
function adjustUrlForDev(path) {
  // RTO materials pages need /en/ prefix on Dev
  if (path.startsWith('/rto-materials/')) {
    return '/en' + path;
  }
  return path;
}

async function fetchPageData(baseUrl, path) {
  // Adjust URL for Dev if needed (define outside try/catch)
  const isDev = baseUrl.includes('vercel.app');
  const adjustedPath = isDev ? adjustUrlForDev(path) : path;

  try {
    const url = `${baseUrl}${adjustedPath}`;
    console.log(`Fetching: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Coursebox-Migration-Parser/1.0'
      }
    });

    const $ = cheerio.load(response.data);

    const title = $('title').text().trim() || '';
    const description = $('meta[name="description"]').attr('content')?.trim() || '';

    const h1Tags = [];
    $('h1').each((i, el) => {
      h1Tags.push($(el).text().trim());
    });
    const h1 = h1Tags.join(' | ') || '';

    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    return {
      url: path,
      title,
      description,
      h1,
      ogImage,
      status: response.status,
      error: null
    };
  } catch (error) {
    console.error(`Error fetching ${baseUrl}${adjustedPath}:`, error.message);
    return {
      url: path,
      title: '',
      description: '',
      h1: '',
      ogImage: '',
      status: error.response?.status || 0,
      error: error.message
    };
  }
}

function isExpectedOgImageMigration(prodUrl, devUrl) {
  if (!prodUrl || !devUrl) return false;

  const prodIsWebflow =
    prodUrl.includes('cdn.prod.website-files.com') ||
    prodUrl.includes('uploads.webflow.com') ||
    prodUrl.includes('assets.website-files.com') ||
    prodUrl.includes('webflow-prod-assets');

  const devIsSanity = devUrl.includes('cdn.sanity.io');

  return prodIsWebflow && devIsSanity;
}

function comparePages(prodData, devData) {
  const bothOk = prodData.status === 200 && devData.status === 200;

  const titleMatch = prodData.title === devData.title;
  const descMatch = prodData.description === devData.description;
  const h1Match = prodData.h1 === devData.h1;
  const ogImageMatch = prodData.ogImage === devData.ogImage;

  const ogImageMigration = !ogImageMatch &&
    isExpectedOgImageMigration(prodData.ogImage, devData.ogImage);

  let status = 'OK';
  let notes = [];
  let diffCount = 0;

  if (!bothOk) {
    status = 'ERROR';
    if (prodData.status !== 200) notes.push(`Prod: ${prodData.status}`);
    if (devData.status !== 200) notes.push(`Dev: ${devData.status}`);
  } else {
    if (!titleMatch) { notes.push('Title'); diffCount++; }
    if (!descMatch) { notes.push('Description'); diffCount++; }
    if (!h1Match) { notes.push('H1'); diffCount++; }

    if (!ogImageMatch) {
      if (ogImageMigration) {
        notes.push('OG Image (CDN migration: Webflow→Sanity)');
      } else {
        notes.push('OG Image');
        diffCount++;
      }
    }

    if (diffCount > 0) {
      status = 'DIFF';
    }
  }

  return {
    url: prodData.url,
    status,
    diffCount,
    notes: notes.length > 0 ? notes.join(', ') : 'All good',

    prodTitle: prodData.title,
    devTitle: devData.title,
    titleMatch: titleMatch ? '✅' : '❌',

    prodDescription: prodData.description,
    devDescription: devData.description,
    descMatch: descMatch ? '✅' : '❌',

    prodH1: prodData.h1,
    devH1: devData.h1,
    h1Match: h1Match ? '✅' : '❌',

    prodOgImage: prodData.ogImage,
    devOgImage: devData.ogImage,
    ogImageMatch: ogImageMatch ? '✅' : (ogImageMigration ? '⚠️' : '❌'),
    ogImageMigration: ogImageMigration,

    prodStatus: prodData.status,
    devStatus: devData.status,
    prodError: prodData.error || '',
    devError: devData.error || ''
  };
}

async function main() {
  console.log('🚀 Starting Coursebox Site Comparison Parser\n');
  console.log(`📋 Prod: ${PROD_URL}`);
  console.log(`📋 Dev:  ${DEV_URL}\n`);
  console.log('🔍 Checking: URL, Title, Description, H1, OG Image\n');

  const urlsPath = path.join(__dirname, URLS_FILE);
  if (!fs.existsSync(urlsPath)) {
    console.error(`❌ File not found: ${URLS_FILE}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(urlsPath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  console.log(`📄 Found ${urls.length} URLs to check\n`);

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] Processing: ${url}`);

    const prodData = await fetchPageData(PROD_URL, url);
    await delay(DELAY_MS);

    const devData = await fetchPageData(DEV_URL, url);
    await delay(DELAY_MS);

    const comparison = comparePages(prodData, devData);
    results.push(comparison);

    console.log(`   Status: ${comparison.status} - ${comparison.notes}`);
  }

  await generateCsvReport(results);
  generateHtmlReport(results);
  printSummary(results);

  console.log('\n✅ Done! Check reports:');
  console.log(`   - ${OUTPUT_CSV}`);
  console.log(`   - ${OUTPUT_HTML}`);
}

async function generateCsvReport(results) {
  const csvWriter = createObjectCsvWriter({
    path: path.join(__dirname, OUTPUT_CSV),
    header: [
      { id: 'url', title: 'URL' },
      { id: 'status', title: 'Status' },
      { id: 'diffCount', title: 'Differences' },
      { id: 'notes', title: 'What Differs' },

      { id: 'prodTitle', title: 'Prod Title' },
      { id: 'devTitle', title: 'Dev Title' },
      { id: 'titleMatch', title: 'Title Match' },

      { id: 'prodDescription', title: 'Prod Description' },
      { id: 'devDescription', title: 'Dev Description' },
      { id: 'descMatch', title: 'Desc Match' },

      { id: 'prodH1', title: 'Prod H1' },
      { id: 'devH1', title: 'Dev H1' },
      { id: 'h1Match', title: 'H1 Match' },

      { id: 'prodOgImage', title: 'Prod OG Image' },
      { id: 'devOgImage', title: 'Dev OG Image' },
      { id: 'ogImageMatch', title: 'OG Image Match' },

      { id: 'prodStatus', title: 'Prod HTTP' },
      { id: 'devStatus', title: 'Dev HTTP' }
    ]
  });

  await csvWriter.writeRecords(results);
  console.log(`\n📊 CSV report saved: ${OUTPUT_CSV}`);
}

function generateHtmlReport(results) {
  const rows = results.map(r => {
    const statusColor = r.status === 'OK' ? 'green' : r.status === 'DIFF' ? 'orange' : 'red';
    const bgColor = r.status === 'DIFF' ? '#fff3cd' : r.status === 'ERROR' ? '#f8d7da' : '#d4edda';

    return `
      <tr style="background-color: ${bgColor}">
        <td rowspan="4" class="url-cell">${r.url}</td>
        <td rowspan="4" class="status-cell" style="color: ${statusColor};">
          ${r.status}
          ${r.diffCount > 0 ? `<br><span class="small-text">(${r.diffCount} diffs)</span>` : ''}
        </td>
        <td class="label-cell">Title</td>
        <td class="${r.titleMatch === '❌' ? 'diff-cell' : ''}">${r.prodTitle || '<em>empty</em>'}</td>
        <td class="${r.titleMatch === '❌' ? 'diff-cell' : ''}">${r.devTitle || '<em>empty</em>'}</td>
        <td style="text-align: center;">${r.titleMatch}</td>
      </tr>
      <tr style="background-color: ${bgColor}">
        <td class="label-cell">Description</td>
        <td class="${r.descMatch === '❌' ? 'diff-cell' : ''}">${r.prodDescription || '<em>empty</em>'}</td>
        <td class="${r.descMatch === '❌' ? 'diff-cell' : ''}">${r.devDescription || '<em>empty</em>'}</td>
        <td style="text-align: center;">${r.descMatch}</td>
      </tr>
      <tr style="background-color: ${bgColor}">
        <td class="label-cell">H1</td>
        <td class="${r.h1Match === '❌' ? 'diff-cell' : ''}">${r.prodH1 || '<em>empty</em>'}</td>
        <td class="${r.h1Match === '❌' ? 'diff-cell' : ''}">${r.devH1 || '<em>empty</em>'}</td>
        <td style="text-align: center;">${r.h1Match}</td>
      </tr>
      <tr style="background-color: ${bgColor}">
        <td class="label-cell">OG Image</td>
        <td class="small-text ${r.ogImageMatch === '❌' && !r.ogImageMigration ? 'diff-cell' : (r.ogImageMigration ? 'migration-cell' : '')}">${r.prodOgImage || '<em>empty</em>'}</td>
        <td class="small-text ${r.ogImageMatch === '❌' && !r.ogImageMigration ? 'diff-cell' : (r.ogImageMigration ? 'migration-cell' : '')}">${r.devOgImage || '<em>empty</em>'}</td>
        <td style="text-align: center;">${r.ogImageMatch}</td>
      </tr>
      <tr style="border-bottom: 2px solid #333;">
        <td colspan="6" style="padding: 8px; background-color: #f8f9fa;">
          <strong>Differences:</strong> ${r.notes}
        </td>
      </tr>
    `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Coursebox Site Comparison Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; font-size: 14px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; background: white; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; word-wrap: break-word; }
    th { background-color: #4CAF50; color: white; position: sticky; top: 0; font-size: 14px; }
    td { max-width: 300px; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; }
    .summary-item { padding: 10px; border-left: 4px solid #4CAF50; background: #f9f9f9; }
    .summary-item.warning { border-left-color: orange; }
    .summary-item.error { border-left-color: red; }
    .url-cell { font-weight: bold; vertical-align: top; }
    .status-cell { font-weight: bold; text-align: center; vertical-align: top; }
    .label-cell { font-weight: bold; }
    .small-text { font-size: 11px; color: #666; }
    .diff-cell { background-color: #ffe6e6 !important; border-left: 3px solid #ff4444 !important; }
    .migration-cell { background-color: #fff9e6 !important; border-left: 3px solid #ffa500 !important; }
  </style>
</head>
<body>
  <h1>🔍 Coursebox Site Comparison Report</h1>

  <div class="summary">
    <h3>📊 Summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <h4>✅ Perfect Match</h4>
        <p style="font-size: 24px; margin: 5px 0;">${results.filter(r => r.status === 'OK').length}</p>
        <small>All elements identical</small>
      </div>
      <div class="summary-item warning">
        <h4>⚠️ Differences Found</h4>
        <p style="font-size: 24px; margin: 5px 0;">${results.filter(r => r.status === 'DIFF').length}</p>
        <small>Some elements differ</small>
      </div>
      <div class="summary-item error">
        <h4>❌ Errors</h4>
        <p style="font-size: 24px; margin: 5px 0;">${results.filter(r => r.status === 'ERROR').length}</p>
        <small>Pages unavailable</small>
      </div>
    </div>
    <hr style="margin: 15px 0;">
    <p><strong>Total URLs:</strong> ${results.length}</p>
    <p><strong>Checked elements:</strong> URL, Title, Description, H1, OG Image</p>
    <p><strong>Prod URL:</strong> ${PROD_URL}</p>
    <p><strong>Dev URL:</strong> ${DEV_URL}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <h3>📄 Detailed Comparison</h3>

  <table>
    <thead>
      <tr>
        <th>URL</th>
        <th>Status</th>
        <th>Element</th>
        <th>Prod Value</th>
        <th>Dev Value</th>
        <th>Match</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>
  `;

  fs.writeFileSync(path.join(__dirname, OUTPUT_HTML), html);
  console.log(`📊 HTML report saved: ${OUTPUT_HTML}`);
}

function printSummary(results) {
  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total URLs checked: ${results.length}`);
  console.log(`✅ OK:          ${results.filter(r => r.status === 'OK').length}`);
  console.log(`⚠️  Differences: ${results.filter(r => r.status === 'DIFF').length}`);
  console.log(`❌ Errors:      ${results.filter(r => r.status === 'ERROR').length}`);
  console.log('='.repeat(50));
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
