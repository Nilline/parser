const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createObjectCsvWriter } = require('csv-writer');
const sitemapCompare = require('./lib/sitemap-compare');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/result', express.static('result'));

const PORT = process.env.PORT || 3001;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const activeParsingJobs = new Map();
const activeWarmupJobs = new Map();

/**
 * Adjust URL for Dev environment
 * Both Prod and Dev use same URL structure (no /en/ prefix for English)
 */
function adjustUrlForDev(path) {
  // Return path as-is without adding /en/ prefix
  return path;
}

async function fetchPageData(baseUrl, path, checks) {
  const isDev = baseUrl.includes('vercel.app');
  const adjustedPath = isDev ? adjustUrlForDev(path) : path;

  // Track redirects (shared between try/catch)
  let redirected = false;
  let redirectUrl = null;
  let originalStatus = null;

  try {
    const url = `${baseUrl}${adjustedPath}`;

    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Coursebox-Migration-Parser/1.0' },
      maxRedirects: 5,
      beforeRedirect: (options, { headers, statusCode }) => {
        if (!redirected) {
          redirected = true;
          originalStatus = statusCode;
          redirectUrl = options.href;
        }
      }
    });

    const $ = cheerio.load(response.data);

    let title = '';
    let description = '';
    let h1 = '';
    let ogImage = '';

    if (checks.title) {
      title = $('title').text().trim() || '';
    }

    if (checks.description) {
      description = $('meta[name="description"]').attr('content')?.trim() || '';
    }

    if (checks.h1) {
      const h1Tags = [];
      $('h1').each((i, el) => {
        h1Tags.push($(el).text().trim());
      });
      h1 = h1Tags.join(' | ') || '';
    }

    if (checks.ogImage) {
      ogImage = $('meta[property="og:image"]').attr('content') || '';
    }

    return {
      url: path,
      title,
      description,
      h1,
      ogImage,
      status: response.status,
      error: null,
      redirected,
      redirectStatus: originalStatus,
      redirectUrl: redirectUrl ? new URL(redirectUrl).pathname : null
    };
  } catch (error) {
    // Check if redirect happened before error (e.g., redirect to 404 page)
    let finalRedirectUrl = null;
    if (redirected && redirectUrl) {
      try {
        finalRedirectUrl = new URL(redirectUrl).pathname;
      } catch {
        finalRedirectUrl = redirectUrl;
      }
    }

    return {
      url: path,
      title: '',
      description: '',
      h1: '',
      ogImage: '',
      status: error.response?.status || 0,
      error: error.message,
      redirected,
      redirectStatus: originalStatus,
      redirectUrl: finalRedirectUrl
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

function comparePages(prodData, devData, checks) {
  const bothOk = prodData.status === 200 && devData.status === 200;

  const titleMatch = !checks.title || prodData.title === devData.title;
  const descMatch = !checks.description || prodData.description === devData.description;
  const h1Match = !checks.h1 || prodData.h1 === devData.h1;
  const ogImageMatch = !checks.ogImage || prodData.ogImage === devData.ogImage;

  const ogImageMigration = checks.ogImage && !ogImageMatch &&
    isExpectedOgImageMigration(prodData.ogImage, devData.ogImage);

  let status = 'OK';
  let notes = [];
  let diffCount = 0;

  // Check for redirects
  const prodRedirect = prodData.redirected ? `${prodData.redirectStatus} → ${prodData.redirectUrl}` : null;
  const devRedirect = devData.redirected ? `${devData.redirectStatus} → ${devData.redirectUrl}` : null;

  if (!bothOk) {
    status = 'ERROR';
    if (prodData.status !== 200) {
      if (prodData.redirected) {
        notes.push(`Prod: ${prodData.redirectStatus} redirect → ${prodData.redirectUrl}`);
      } else {
        notes.push(`Prod: ${prodData.status}`);
      }
    }
    if (devData.status !== 200) {
      if (devData.redirected) {
        notes.push(`Dev: ${devData.redirectStatus} redirect → ${devData.redirectUrl}`);
      } else {
        notes.push(`Dev: ${devData.status}`);
      }
    }
  } else {
    // Add redirect info even when status is 200 (redirect followed successfully)
    if (prodData.redirected) {
      notes.push(`Prod redirected: ${prodData.redirectStatus} → ${prodData.redirectUrl}`);
    }
    if (devData.redirected) {
      notes.push(`Dev redirected: ${devData.redirectStatus} → ${devData.redirectUrl}`);
    }

    if (checks.title && !titleMatch) { notes.push('Title'); diffCount++; }
    if (checks.description && !descMatch) { notes.push('Description'); diffCount++; }
    if (checks.h1 && !h1Match) { notes.push('H1'); diffCount++; }

    if (checks.ogImage && !ogImageMatch) {
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
    devError: devData.error || '',
    prodRedirected: prodData.redirected || false,
    prodRedirectStatus: prodData.redirectStatus || null,
    prodRedirectUrl: prodData.redirectUrl || null,
    devRedirected: devData.redirected || false,
    devRedirectStatus: devData.redirectStatus || null,
    devRedirectUrl: devData.redirectUrl || null
  };
}

async function generateCsvReport(results, checks) {
  const resultDir = path.join(__dirname, 'result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  const headers = [
    { id: 'url', title: 'URL' },
    { id: 'status', title: 'Status' },
    { id: 'diffCount', title: 'Differences' },
    { id: 'notes', title: 'What Differs' }
  ];

  if (checks.title) {
    headers.push(
      { id: 'prodTitle', title: 'Prod Title' },
      { id: 'devTitle', title: 'Dev Title' },
      { id: 'titleMatch', title: 'Title Match' }
    );
  }

  if (checks.description) {
    headers.push(
      { id: 'prodDescription', title: 'Prod Description' },
      { id: 'devDescription', title: 'Dev Description' },
      { id: 'descMatch', title: 'Desc Match' }
    );
  }

  if (checks.h1) {
    headers.push(
      { id: 'prodH1', title: 'Prod H1' },
      { id: 'devH1', title: 'Dev H1' },
      { id: 'h1Match', title: 'H1 Match' }
    );
  }

  if (checks.ogImage) {
    headers.push(
      { id: 'prodOgImage', title: 'Prod OG Image' },
      { id: 'devOgImage', title: 'Dev OG Image' },
      { id: 'ogImageMatch', title: 'OG Image Match' }
    );
  }

  headers.push(
    { id: 'prodStatus', title: 'Prod HTTP' },
    { id: 'devStatus', title: 'Dev HTTP' },
    { id: 'prodRedirectUrl', title: 'Prod Redirect To' },
    { id: 'devRedirectUrl', title: 'Dev Redirect To' }
  );

  // Main report (all languages)
  const csvWriter = createObjectCsvWriter({
    path: path.join(__dirname, 'result', 'comparison-report.csv'),
    header: headers
  });
  await csvWriter.writeRecords(results);

  // Split into English and Other Languages
  await splitReportsByLanguage(results, headers);
}

/**
 * Split results into 2 CSV files:
 * 1. English pages (URLs without locale prefix)
 * 2. Other languages (ar, fr, de, es, it, pt, zh, ko, ja, nl)
 */
async function splitReportsByLanguage(results, headers) {
  const LOCALES = ['ar', 'fr', 'de', 'es', 'it', 'pt', 'zh', 'ko', 'ja', 'nl'];

  const englishResults = [];
  const otherLanguagesResults = [];

  for (const result of results) {
    const url = result.url;

    // Check if URL is localized (starts with /{locale}/)
    const isLocalized = LOCALES.some(locale =>
      url === `/${locale}` || url.startsWith(`/${locale}/`)
    );

    if (isLocalized) {
      otherLanguagesResults.push(result);
    } else {
      englishResults.push(result);
    }
  }

  // English CSV
  const englishWriter = createObjectCsvWriter({
    path: path.join(__dirname, 'result', 'comparison-report-english.csv'),
    header: headers
  });
  await englishWriter.writeRecords(englishResults);

  // Other languages CSV
  const otherWriter = createObjectCsvWriter({
    path: path.join(__dirname, 'result', 'comparison-report-other-languages.csv'),
    header: headers
  });
  await otherWriter.writeRecords(otherLanguagesResults);

  console.log(`Split reports: ${englishResults.length} English, ${otherLanguagesResults.length} Other languages`);
}

function generateHtmlReport(results, prodUrl, devUrl, checks) {
  const resultDir = path.join(__dirname, 'result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  // Group results by page type (base path without locale)
  const groupedResults = groupByPageType(results);

  const rows = generateGroupedRows(groupedResults, checks, prodUrl, devUrl);

  const html = generateHtmlTemplate(results, rows, prodUrl, devUrl, checks);

  fs.writeFileSync(path.join(__dirname, 'result', 'comparison-report.html'), html);
}

/**
 * Group results by page type (using sitemap-based mapping)
 * Groups pages by their EN version URL
 */
function groupByPageType(results) {
  const LOCALES = ['ar', 'fr', 'de', 'es', 'it', 'pt', 'zh', 'ko', 'ja', 'nl'];
  const groups = new Map();

  // Load pages mapping (sitemap-based)
  let pagesMapping = {};
  try {
    const mappingPath = path.join(__dirname, 'pages-mapping.json');
    if (fs.existsSync(mappingPath)) {
      pagesMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
  } catch (error) {
    console.warn('Warning: Could not load pages-mapping.json, using fallback grouping');
  }

  // First pass: collect all EN pages
  const enPages = new Set();
  for (const result of results) {
    const url = result.url;
    const isLocalized = LOCALES.some(loc => url === `/${loc}` || url.startsWith(`/${loc}/`));
    if (!isLocalized) {
      enPages.add(url);
    }
  }

  for (const result of results) {
    const url = result.url;

    let locale = 'en';
    let basePath = url;

    for (const loc of LOCALES) {
      if (url === `/${loc}`) {
        locale = loc;
        basePath = '/';
        break;
      } else if (url.startsWith(`/${loc}/`)) {
        locale = loc;
        // Extract path without locale prefix
        const pathWithoutLocale = url.substring(loc.length + 2); // Remove /{locale}/
        basePath = `/${pathWithoutLocale}`;
        break;
      }
    }

    // Use mapping if available
    if (pagesMapping[url]) {
      basePath = pagesMapping[url];
    }

    // If no EN version exists for this basePath, use the localized URL as group key
    if (!enPages.has(basePath) && locale !== 'en') {
      // Keep the localized URL as basePath if no EN equivalent
      basePath = url;
    }

    if (!groups.has(basePath)) {
      groups.set(basePath, []);
    }

    groups.get(basePath).push({ ...result, locale });
  }

  // Sort groups by base path
  return new Map([...groups.entries()].sort());
}

/**
 * Generate HTML rows grouped by page type
 */
function generateGroupedRows(groupedResults, checks, prodUrl, devUrl) {
  let html = '';

  for (const [basePath, pageResults] of groupedResults) {
    const pageTitle = basePath === '/' ? 'Home Pages' : `${basePath} Pages`;
    const pageCount = pageResults.length;

    // Group header
    const prodLink = `${prodUrl}${basePath}`;
    html += `
      <tr class="group-header">
        <td colspan="6">
          <h3 style="margin: 0; padding: 10px 0; color: #fafafa;">
            📄 <a href="${prodLink}" target="_blank" style="color: #3b82f6; text-decoration: none; border-bottom: 1px dashed #3f3f46;">${pageTitle}</a>
            <span style="font-size: 14px; font-weight: normal;">
              (${pageCount} language${pageCount > 1 ? 's' : ''})
            </span>
          </h3>
        </td>
      </tr>
    `;

    // Sort by locale (en first, then alphabetically)
    const sortedResults = pageResults.sort((a, b) => {
      if (a.locale === 'en') return -1;
      if (b.locale === 'en') return 1;
      return a.locale.localeCompare(b.locale);
    });

    // Generate rows for each language version
    for (const r of sortedResults) {
      html += generatePageRow(r, checks, prodUrl, devUrl);
    }
  }

  return html;
}

/**
 * Generate HTML row for a single page result
 */
function generatePageRow(r, checks, prodUrl, devUrl) {
  const statusColor = r.status === 'OK' ? '#22c55e' : r.status === 'DIFF' ? '#f59e0b' : '#ef4444';
  const bgColor = r.status === 'DIFF' ? 'rgba(245, 158, 11, 0.25)' : r.status === 'ERROR' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(34, 197, 94, 0.15)';

  const elementRows = [];

  if (checks.title) {
    const cellClass = r.titleMatch === '✅' ? 'match-cell' : 'diff-cell';
    elementRows.push(`
      <td class="label-cell">Title</td>
      <td class="${cellClass}">${r.prodTitle || '<em>empty</em>'}</td>
      <td class="${cellClass}">${r.devTitle || '<em>empty</em>'}</td>
      <td style="text-align: center;">${r.titleMatch}</td>
    `);
  }

  if (checks.description) {
    const cellClass = r.descMatch === '✅' ? 'match-cell' : 'diff-cell';
    elementRows.push(`
      <td class="label-cell">Description</td>
      <td class="${cellClass}">${r.prodDescription || '<em>empty</em>'}</td>
      <td class="${cellClass}">${r.devDescription || '<em>empty</em>'}</td>
      <td style="text-align: center;">${r.descMatch}</td>
    `);
  }

  if (checks.h1) {
    const cellClass = r.h1Match === '✅' ? 'match-cell' : 'diff-cell';
    elementRows.push(`
      <td class="label-cell">H1</td>
      <td class="${cellClass}">${r.prodH1 || '<em>empty</em>'}</td>
      <td class="${cellClass}">${r.devH1 || '<em>empty</em>'}</td>
      <td style="text-align: center;">${r.h1Match}</td>
    `);
  }

  if (checks.ogImage) {
    let cellClass = 'match-cell';
    if (r.ogImageMatch === '⚠️') {
      cellClass = 'migration-cell'; // Yellow - CDN migration is OK
    } else if (r.ogImageMatch === '❌') {
      cellClass = 'diff-cell'; // Red - real difference
    }

    elementRows.push(`
      <td class="label-cell">OG Image</td>
      <td class="small-text ${cellClass}">${r.prodOgImage || '<em>empty</em>'}</td>
      <td class="small-text ${cellClass}">${r.devOgImage || '<em>empty</em>'}</td>
      <td style="text-align: center;">${r.ogImageMatch}</td>
    `);
  }

  const rowspan = elementRows.length;

  // Build clickable URLs for Prod and Dev
  const devPath = adjustUrlForDev(r.url);
  const prodFullUrl = `${prodUrl}${r.url}`;
  const devFullUrl = `${devUrl}${devPath}`;

  // Build redirect info badges
  let prodRedirectBadge = '';
  let devRedirectBadge = '';

  if (r.prodRedirected) {
    prodRedirectBadge = `
      <div style="margin-top: 4px; padding: 4px 8px; background: rgba(245, 158, 11, 0.2); border-radius: 4px; font-size: 11px; border-left: 3px solid #f59e0b; color: #fafafa;">
        ↪️ <strong>Prod ${r.prodRedirectStatus}</strong> → ${r.prodRedirectUrl}
      </div>
    `;
  }

  if (r.devRedirected) {
    devRedirectBadge = `
      <div style="margin-top: 4px; padding: 4px 8px; background: rgba(59, 130, 246, 0.2); border-radius: 4px; font-size: 11px; border-left: 3px solid #3b82f6; color: #fafafa;">
        ↪️ <strong>Dev ${r.devRedirectStatus}</strong> → ${r.devRedirectUrl}
      </div>
    `;
  }

  // Add locale badge and clickable links
  const localeLabel = r.locale === 'en' ? '🇬🇧 EN' : `🌍 ${r.locale.toUpperCase()}`;
  const urlDisplay = `
    <div style="margin-bottom: 8px;">
      <strong>${r.url}</strong>
      <span class="locale-badge" style="background: #3f3f46; color: #a1a1aa; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${localeLabel}</span>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 4px;">
      <a href="${prodFullUrl}" target="_blank" style="background: #22c55e; color: #0a0a0b; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 11px; font-weight: 500;">
        🔗 Prod
      </a>
      <a href="${devFullUrl}" target="_blank" style="background: #3b82f6; color: white; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 11px; font-weight: 500;">
        🔗 Dev
      </a>
    </div>
    ${prodRedirectBadge}
    ${devRedirectBadge}
  `;

  const htmlRows = elementRows.map((rowContent, index) => {
    if (index === 0) {
      return `
    <tr style="background-color: ${bgColor}">
      <td rowspan="${rowspan}" class="url-cell">${urlDisplay}</td>
      <td rowspan="${rowspan}" class="status-cell" style="color: ${statusColor};">
        ${r.status}
        ${r.diffCount > 0 ? `<br><span class="small-text">(${r.diffCount} diffs)</span>` : ''}
      </td>
      ${rowContent}
    </tr>`;
    } else {
      return `
    <tr style="background-color: ${bgColor}">
      ${rowContent}
    </tr>`;
    }
  }).join('');

  return `
    ${htmlRows}
    <tr style="border-bottom: 2px solid #3f3f46;">
      <td colspan="6" style="padding: 8px; background-color: #18181b; color: #a1a1aa;">
        <strong style="color: #fafafa;">Differences:</strong> ${r.notes}
      </td>
    </tr>
  `;
}

/**
 * Generate complete HTML template
 */
function generateHtmlTemplate(results, rows, prodUrl, devUrl, checks) {

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Coursebox Site Comparison Report</title>
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

    body { font-family: Arial, sans-serif; margin: 20px; background: var(--bg-primary); color: var(--text-primary); font-size: 14px; }
    h1 { color: var(--text-primary); }
    h3 { color: var(--text-secondary); }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; background: var(--bg-secondary); font-size: 13px; }
    th, td { border: 1px solid var(--border-subtle); padding: 8px; text-align: left; word-wrap: break-word; }
    th { background-color: var(--accent-primary); color: white; position: sticky; top: 0; font-size: 14px; }
    td { max-width: 300px; color: var(--text-primary); }
    .summary { background: var(--bg-secondary); padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid var(--border-subtle); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; }
    .summary-item { padding: 10px; border-left: 4px solid var(--accent-success); background: var(--bg-tertiary); border-radius: 0 6px 6px 0; }
    .summary-item h4 { color: var(--text-primary); margin: 0 0 5px 0; }
    .summary-item p { color: var(--text-primary); }
    .summary-item small { color: var(--text-tertiary); }
    .summary-item.warning { border-left-color: var(--accent-warning); }
    .summary-item.error { border-left-color: var(--accent-error); }
    .summary p { color: var(--text-secondary); margin: 5px 0; }
    .summary strong { color: var(--text-primary); }
    hr { border: none; border-top: 1px solid var(--border-subtle); }
    .url-cell { font-weight: bold; vertical-align: top; }
    .status-cell { font-weight: bold; text-align: center; vertical-align: top; }
    .label-cell { font-weight: bold; }
    .small-text { font-size: 11px; color: #fff !important; }
    .match-cell { background-color: rgba(34, 197, 94, 0.2) !important; border-left: 3px solid var(--accent-success) !important; }
    .diff-cell { background-color: rgba(239, 68, 68, 0.3) !important; border-left: 3px solid var(--accent-error) !important; }
    .migration-cell { background-color: rgba(245, 158, 11, 0.3) !important; border-left: 3px solid var(--accent-warning) !important; color: #fff !important; }
    .group-header { background-color: var(--bg-tertiary); font-weight: bold; }
    .group-header td { border-top: 3px solid var(--border-default) !important; padding: 15px 10px !important; }
    .group-header a { color: var(--accent-primary); }
    .group-header a:hover { color: #60a5fa; }

    /* Filter buttons */
    .filter-buttons { margin: 15px 0; display: flex; gap: 10px; flex-wrap: wrap; }
    .filter-btn {
      padding: 10px 20px;
      border: 2px solid var(--border-default);
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      transition: all 0.2s;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }
    .filter-btn:hover { transform: translateY(-2px); box-shadow: 0 2px 8px rgba(0,0,0,0.3); background: var(--bg-elevated); }
    .filter-btn.active { border-width: 3px; }
    .filter-btn[data-filter="all"].active { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--text-primary); }
    .filter-btn[data-filter="OK"] { background: rgba(34, 197, 94, 0.15); color: var(--accent-success); border-color: var(--accent-success); }
    .filter-btn[data-filter="OK"].active { background: var(--accent-success); color: var(--bg-primary); }
    .filter-btn[data-filter="DIFF"] { background: rgba(245, 158, 11, 0.15); color: var(--accent-warning); border-color: var(--accent-warning); }
    .filter-btn[data-filter="DIFF"].active { background: var(--accent-warning); color: var(--bg-primary); }
    .filter-btn[data-filter="ERROR"] { background: rgba(239, 68, 68, 0.15); color: var(--accent-error); border-color: var(--accent-error); }
    .filter-btn[data-filter="ERROR"].active { background: var(--accent-error); color: white; }

    /* Hidden rows */
    tr.hidden { display: none; }
    .group-header.hidden { display: none; }

    /* Filter counter */
    .filter-count { font-size: 12px; margin-left: 5px; opacity: 0.8; }

    /* Links */
    a { color: var(--accent-primary); }
    a:hover { color: #60a5fa; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-subtle); }
  </style>
</head>
<body>
  <h1>🔍 Coursebox Site Comparison Report</h1>

  <div class="summary">
    <h3>📊 Summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <h4>✅ Perfect Match</h4>
        <p style="font-size: 24px; margin: 5px 0; color: #fff !important;">${results.filter(r => r.status === 'OK').length}</p>
        <small>All elements identical</small>
      </div>
      <div class="summary-item warning">
        <h4>⚠️ Differences Found</h4>
        <p style="font-size: 24px; margin: 5px 0; color: #fff !important;">${results.filter(r => r.status === 'DIFF').length}</p>
        <small>Some elements differ</small>
      </div>
      <div class="summary-item error">
        <h4>❌ Errors</h4>
        <p style="font-size: 24px; margin: 5px 0; color: #fff !important;">${results.filter(r => r.status === 'ERROR').length}</p>
        <small>Pages unavailable</small>
      </div>
    </div>
    <hr style="margin: 15px 0;">
    <p><strong>Total URLs:</strong> ${results.length}</p>
    <p><strong>Checked elements:</strong> ${[
      checks.title && 'Title',
      checks.description && 'Description',
      checks.h1 && 'H1',
      checks.ogImage && 'OG Image'
    ].filter(Boolean).join(', ')}</p>
    <p><strong>Prod URL:</strong> ${prodUrl}</p>
    <p><strong>Dev URL:</strong> ${devUrl}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <h3>📄 Detailed Comparison</h3>

  <div class="filter-buttons">
    <button class="filter-btn active" data-filter="all">
      🔍 All <span class="filter-count">(${results.length})</span>
    </button>
    <button class="filter-btn" data-filter="OK">
      ✅ OK <span class="filter-count">(${results.filter(r => r.status === 'OK').length})</span>
    </button>
    <button class="filter-btn" data-filter="DIFF">
      ⚠️ DIFF <span class="filter-count">(${results.filter(r => r.status === 'DIFF').length})</span>
    </button>
    <button class="filter-btn" data-filter="ERROR">
      ❌ ERROR <span class="filter-count">(${results.filter(r => r.status === 'ERROR').length})</span>
    </button>
  </div>

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

  <script>
    // Filter functionality
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const filter = this.dataset.filter;

        // Update active button
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');

        // Get all page groups
        const groups = document.querySelectorAll('.group-header');

        groups.forEach(groupHeader => {
          // Find all rows belonging to this group (until next group-header)
          const groupRows = [];
          let nextRow = groupHeader.nextElementSibling;
          while (nextRow && !nextRow.classList.contains('group-header')) {
            groupRows.push(nextRow);
            nextRow = nextRow.nextElementSibling;
          }

          // Check statuses in this group
          const statusCells = groupRows.filter(row => row.querySelector('.status-cell'));
          const statuses = statusCells.map(row => {
            const cell = row.querySelector('.status-cell');
            return cell ? cell.textContent.trim().split('\\n')[0] : '';
          });

          // Show/hide based on filter
          if (filter === 'all') {
            groupHeader.classList.remove('hidden');
            groupRows.forEach(row => row.classList.remove('hidden'));
          } else {
            // Check if any row in group matches filter
            const hasMatch = statuses.some(s => s === filter);

            if (hasMatch) {
              groupHeader.classList.remove('hidden');
              // Show only matching page blocks
              let currentStatus = '';
              groupRows.forEach(row => {
                const statusCell = row.querySelector('.status-cell');
                if (statusCell) {
                  currentStatus = statusCell.textContent.trim().split('\\n')[0];
                }
                if (currentStatus === filter) {
                  row.classList.remove('hidden');
                } else {
                  row.classList.add('hidden');
                }
              });
            } else {
              groupHeader.classList.add('hidden');
              groupRows.forEach(row => row.classList.add('hidden'));
            }
          }
        });
      });
    });
  </script>
</body>
</html>
  `;

  return html;
}

/**
 * Fetch page for cache warmup (only status and timing)
 */
async function fetchPageForWarmup(baseUrl, path) {
  const startTime = Date.now();

  try {
    const url = `${baseUrl}${path}`;

    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Coursebox-Cache-Warmup/1.0' },
      maxRedirects: 5
    });

    const duration = Date.now() - startTime;

    return {
      url: path,
      status: response.status,
      duration,
      error: null,
      cached: response.headers['x-vercel-cache'] || response.headers['cf-cache-status'] || 'unknown'
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      url: path,
      status: error.response?.status || 0,
      duration,
      error: error.message,
      cached: 'error'
    };
  }
}

/**
 * Generate warmup CSV report
 */
async function generateWarmupCsvReport(results, baseUrl) {
  const resultDir = path.join(__dirname, 'result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: path.join(resultDir, 'warmup-report.csv'),
    header: [
      { id: 'url', title: 'URL' },
      { id: 'status', title: 'HTTP Status' },
      { id: 'duration', title: 'Duration (ms)' },
      { id: 'cached', title: 'Cache Status' },
      { id: 'error', title: 'Error' }
    ]
  });

  await csvWriter.writeRecords(results);
}

/**
 * Generate warmup HTML report
 */
function generateWarmupHtmlReport(results, baseUrl, stats) {
  const resultDir = path.join(__dirname, 'result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  const rows = results.map(r => {
    const statusColor = r.status === 200 ? '#22c55e' : '#ef4444';
    const bgColor = r.status === 200 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.25)';
    const durationColor = r.duration < 500 ? '#22c55e' : r.duration < 1500 ? '#f59e0b' : '#ef4444';

    return `
      <tr style="background-color: ${bgColor}">
        <td>
          <a href="${baseUrl}${r.url}" target="_blank" style="color: #3b82f6;">${r.url}</a>
        </td>
        <td style="color: ${statusColor}; font-weight: bold; text-align: center;">${r.status}</td>
        <td style="color: ${durationColor}; text-align: right;">${r.duration}ms</td>
        <td style="text-align: center;">${r.cached}</td>
        <td style="color: #ef4444;">${r.error || ''}</td>
      </tr>
    `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cache Warmup Report - ${baseUrl}</title>
  <style>
    :root {
      --bg-primary: #0a0a0b;
      --bg-secondary: #111113;
      --bg-tertiary: #18181b;
      --border-subtle: #27272a;
      --text-primary: #fafafa;
      --text-secondary: #a1a1aa;
      --accent-primary: #3b82f6;
      --accent-success: #22c55e;
      --accent-warning: #f59e0b;
      --accent-error: #ef4444;
    }
    body { font-family: Arial, sans-serif; margin: 20px; background: var(--bg-primary); color: var(--text-primary); }
    h1 { color: var(--text-primary); }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; background: var(--bg-secondary); }
    th, td { border: 1px solid var(--border-subtle); padding: 8px; text-align: left; }
    th { background-color: var(--accent-primary); color: white; position: sticky; top: 0; }
    .summary { background: var(--bg-secondary); padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid var(--border-subtle); }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 15px; }
    .summary-item { padding: 10px; border-left: 4px solid var(--accent-success); background: var(--bg-tertiary); border-radius: 0 6px 6px 0; }
    .summary-item h4 { color: var(--text-primary); margin: 0 0 5px 0; }
    .summary-item p { font-size: 24px; margin: 5px 0; color: #fff; }
    .summary-item small { color: var(--text-secondary); }
    .summary-item.warning { border-left-color: var(--accent-warning); }
    .summary-item.error { border-left-color: var(--accent-error); }
    a { color: var(--accent-primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🔥 Cache Warmup Report</h1>

  <div class="summary">
    <h3>📊 Summary</h3>
    <div class="summary-grid">
      <div class="summary-item">
        <h4>✅ Success (200)</h4>
        <p>${stats.success}</p>
        <small>Pages loaded</small>
      </div>
      <div class="summary-item error">
        <h4>❌ Errors</h4>
        <p>${stats.errors}</p>
        <small>Failed requests</small>
      </div>
      <div class="summary-item warning">
        <h4>⏱️ Avg Duration</h4>
        <p>${stats.avgDuration}ms</p>
        <small>Per page</small>
      </div>
      <div class="summary-item">
        <h4>🕐 Total Time</h4>
        <p>${Math.round(stats.totalTime / 1000)}s</p>
        <small>${stats.total} pages</small>
      </div>
    </div>
    <hr style="margin: 15px 0; border: none; border-top: 1px solid var(--border-subtle);">
    <p><strong>Target URL:</strong> ${baseUrl}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <h3>📄 Detailed Results</h3>
  <table>
    <thead>
      <tr>
        <th>URL</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Cache</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>
  `;

  fs.writeFileSync(path.join(resultDir, 'warmup-report.html'), html);
}

/**
 * Run cache warmup for a single site
 */
async function runWarmup(config, socket) {
  const { baseUrl, urls } = config;
  const results = [];
  const socketId = socket.id;
  const BATCH_SIZE = config.batchSize || 10;
  const DELAY_BETWEEN_BATCHES = 200;
  const startTime = Date.now();

  activeWarmupJobs.set(socketId, { stopped: false });

  socket.emit('warmup-progress', {
    type: 'start',
    total: urls.length,
    message: `Starting cache warmup for ${urls.length} URLs (${BATCH_SIZE} parallel requests)...`
  });

  try {
    for (let batchStart = 0; batchStart < urls.length; batchStart += BATCH_SIZE) {
      const job = activeWarmupJobs.get(socketId);
      if (job && job.stopped) {
        socket.emit('warmup-progress', {
          type: 'stopped',
          message: 'Warmup stopped by user'
        });
        activeWarmupJobs.delete(socketId);
        return { stopped: true, results };
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, urls.length);
      const batchUrls = urls.slice(batchStart, batchEnd);

      const batchPromises = batchUrls.map(url => fetchPageForWarmup(baseUrl, url));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Emit progress for each result
      for (let i = 0; i < batchResults.length; i++) {
        const r = batchResults[i];
        socket.emit('warmup-progress', {
          type: 'fetched',
          current: batchStart + i + 1,
          total: urls.length,
          url: batchUrls[i],
          status: r.status,
          duration: r.duration,
          message: `[${batchStart + i + 1}/${urls.length}] ${batchUrls[i]} - ${r.status} (${r.duration}ms)`
        });
      }

      if (batchEnd < urls.length) {
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }

    const totalTime = Date.now() - startTime;
    const successResults = results.filter(r => r.status === 200);
    const errorResults = results.filter(r => r.status !== 200);
    const avgDuration = Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length);

    const stats = {
      total: results.length,
      success: successResults.length,
      errors: errorResults.length,
      avgDuration,
      totalTime
    };

    socket.emit('warmup-progress', {
      type: 'generating',
      message: 'Generating warmup reports...'
    });

    await generateWarmupCsvReport(results, baseUrl);
    generateWarmupHtmlReport(results, baseUrl, stats);

    // Save summary
    const resultDir = path.join(__dirname, 'result');
    fs.writeFileSync(
      path.join(resultDir, 'warmup-summary.json'),
      JSON.stringify({ stats, baseUrl, timestamp: new Date().toISOString() }, null, 2)
    );

    socket.emit('warmup-progress', {
      type: 'complete',
      stats,
      message: `Warmup complete! ${stats.success}/${stats.total} pages loaded in ${Math.round(totalTime/1000)}s`
    });

    activeWarmupJobs.delete(socketId);
    return { results, stats };
  } catch (error) {
    activeWarmupJobs.delete(socketId);
    throw error;
  }
}

async function runParser(config, socket) {
  const { prodUrl, devUrl, urls, checks } = config;
  const results = [];
  const socketId = socket.id;
  const BATCH_SIZE = config.batchSize || 5;
  const DELAY_BETWEEN_BATCHES = 500;

  activeParsingJobs.set(socketId, { stopped: false });

  socket.emit('progress', {
    type: 'start',
    total: urls.length,
    message: `Starting comparison of ${urls.length} URLs (${BATCH_SIZE} parallel requests)...`
  });

  try {
    for (let batchStart = 0; batchStart < urls.length; batchStart += BATCH_SIZE) {
      const job = activeParsingJobs.get(socketId);
      if (job && job.stopped) {
        socket.emit('progress', {
          type: 'stopped',
          message: 'Parser stopped by user'
        });
        activeParsingJobs.delete(socketId);
        return { stopped: true, results };
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, urls.length);
      const batchUrls = urls.slice(batchStart, batchEnd);

      socket.emit('progress', {
        type: 'fetching',
        current: batchStart + 1,
        total: urls.length,
        batchSize: batchUrls.length,
        message: `[${batchStart + 1}-${batchEnd}/${urls.length}] Fetching batch of ${batchUrls.length} URLs...`
      });

      const batchPromises = batchUrls.map(async (url) => {
        const [prodData, devData] = await Promise.all([
          fetchPageData(prodUrl, url, checks),
          fetchPageData(devUrl, url, checks)
        ]);
        return comparePages(prodData, devData, checks);
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      for (let i = 0; i < batchResults.length; i++) {
        const comparison = batchResults[i];
        socket.emit('progress', {
          type: 'compared',
          current: batchStart + i + 1,
          total: urls.length,
          url: batchUrls[i],
          status: comparison.status,
          message: `[${batchStart + i + 1}/${urls.length}] ${batchUrls[i]} - ${comparison.status}`
        });
      }

      if (batchEnd < urls.length) {
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }

    socket.emit('progress', {
      type: 'generating',
      message: 'Generating reports...'
    });

    await generateCsvReport(results, checks);
    generateHtmlReport(results, prodUrl, devUrl, checks);

    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'OK').length,
      diff: results.filter(r => r.status === 'DIFF').length,
      error: results.filter(r => r.status === 'ERROR').length
    };

    const resultDir = path.join(__dirname, 'result');
    if (!fs.existsSync(resultDir)) {
      fs.mkdirSync(resultDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultDir, 'summary.json'),
      JSON.stringify({ summary, timestamp: new Date().toISOString() }, null, 2)
    );

    socket.emit('progress', {
      type: 'complete',
      summary,
      message: 'Comparison complete!'
    });

    activeParsingJobs.delete(socketId);
    return { results, summary };
  } catch (error) {
    activeParsingJobs.delete(socketId);
    throw error;
  }
}

app.post('/api/parse', async (req, res) => {
  try {
    const { prodUrl, devUrl, checks } = req.body;

    const urlsPath = path.join(__dirname, 'urls-main.txt');
    if (!fs.existsSync(urlsPath)) {
      return res.status(400).json({ error: 'URLs file not found' });
    }

    const urls = fs.readFileSync(urlsPath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    const socketId = req.body.socketId;
    const socket = io.sockets.sockets.get(socketId);

    if (!socket) {
      return res.status(400).json({ error: 'Socket connection not found' });
    }

    runParser({ prodUrl, devUrl, urls, checks, batchSize: 5 }, socket)
      .catch(error => {
        socket.emit('progress', {
          type: 'error',
          message: error.message
        });
      });

    res.json({ success: true, message: 'Parser started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    prodUrl: 'https://www.coursebox.ai',
    devUrl: 'https://coursebox-ai.vercel.app',
    checks: {
      status: true,
      title: true,
      description: true,
      h1: true,
      ogImage: true
    }
  });
});

app.get('/api/urls', (req, res) => {
  try {
    const urlsPath = path.join(__dirname, 'urls-main.txt');
    if (!fs.existsSync(urlsPath)) {
      return res.status(404).json({ error: 'URLs file not found' });
    }
    const content = fs.readFileSync(urlsPath, 'utf-8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/urls', (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    const urlsPath = path.join(__dirname, 'urls-main.txt');
    fs.writeFileSync(urlsPath, content, 'utf-8');

    const urls = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    res.json({
      success: true,
      message: 'URLs saved successfully',
      count: urls.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stop', (req, res) => {
  try {
    const { socketId } = req.body;
    if (!socketId) {
      return res.status(400).json({ error: 'socketId is required' });
    }

    const job = activeParsingJobs.get(socketId);
    if (job) {
      job.stopped = true;
      res.json({ success: true, message: 'Parser stopped' });
    } else {
      res.json({ success: false, message: 'No active parser found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CACHE WARMUP ENDPOINTS
// ============================================

/**
 * Start cache warmup for a single site
 * POST /api/warmup
 * Body: { baseUrl: "https://www.coursebox.ai", socketId: "..." }
 */
app.post('/api/warmup', async (req, res) => {
  try {
    const { baseUrl, socketId } = req.body;

    if (!baseUrl) {
      return res.status(400).json({ error: 'baseUrl is required' });
    }

    const urlsPath = path.join(__dirname, 'urls-main.txt');
    if (!fs.existsSync(urlsPath)) {
      return res.status(400).json({ error: 'URLs file not found. Parse sitemap first.' });
    }

    const urls = fs.readFileSync(urlsPath, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (urls.length === 0) {
      return res.status(400).json({ error: 'No URLs found in urls-main.txt' });
    }

    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      return res.status(400).json({ error: 'Socket connection not found' });
    }

    // Check if already running
    if (activeWarmupJobs.get(socketId)) {
      return res.status(400).json({ error: 'Warmup already running' });
    }

    runWarmup({ baseUrl, urls, batchSize: 10 }, socket)
      .catch(error => {
        socket.emit('warmup-progress', {
          type: 'error',
          message: error.message
        });
      });

    res.json({ success: true, message: 'Cache warmup started', urlCount: urls.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Stop cache warmup
 * POST /api/warmup/stop
 */
app.post('/api/warmup/stop', (req, res) => {
  try {
    const { socketId } = req.body;
    if (!socketId) {
      return res.status(400).json({ error: 'socketId is required' });
    }

    const job = activeWarmupJobs.get(socketId);
    if (job) {
      job.stopped = true;
      res.json({ success: true, message: 'Warmup stopped' });
    } else {
      res.json({ success: false, message: 'No active warmup found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get warmup reports info
 * GET /api/warmup/reports
 */
app.get('/api/warmup/reports', (req, res) => {
  try {
    const resultDir = path.join(__dirname, 'result');
    const summaryPath = path.join(resultDir, 'warmup-summary.json');
    const csvPath = path.join(resultDir, 'warmup-report.csv');
    const htmlPath = path.join(resultDir, 'warmup-report.html');

    if (!fs.existsSync(summaryPath)) {
      return res.json({ exists: false });
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

    res.json({
      exists: true,
      csv: fs.existsSync(csvPath),
      html: fs.existsSync(htmlPath),
      timestamp: summary.timestamp,
      baseUrl: summary.baseUrl,
      stats: summary.stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports', (req, res) => {
  try {
    const resultDir = path.join(__dirname, 'result');
    const csvPath = path.join(resultDir, 'comparison-report.csv');
    const htmlPath = path.join(resultDir, 'comparison-report.html');
    const summaryPath = path.join(resultDir, 'summary.json');

    const csvExists = fs.existsSync(csvPath);
    const htmlExists = fs.existsSync(htmlPath);

    if (!csvExists && !htmlExists) {
      return res.json({ exists: false });
    }

    let timestamp = null;
    let summary = null;

    if (fs.existsSync(summaryPath)) {
      const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      summary = summaryData.summary;
      timestamp = summaryData.timestamp;
    } else if (csvExists) {
      const stats = fs.statSync(csvPath);
      timestamp = stats.mtime;
    }

    res.json({
      exists: true,
      csv: csvExists,
      html: htmlExists,
      timestamp: timestamp,
      summary: summary,
      age: timestamp ? Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Parse sitemap and update URL list
app.post('/api/sitemap', async (req, res) => {
  try {
    console.log('Starting sitemap parse...');

    const SITEMAP_URL = 'https://www.coursebox.ai/sitemap.xml';

    // Paths to exclude from parsing (CSV-generated pages)
    const EXCLUDED_PATHS = ['/blog/', '/rto-materials/', '/alternatives/'];

    // Template patterns (only keep 1 example per template)
    const TEMPLATE_PATTERNS = [
      { pattern: /^\/features\/[^\/]+$/, name: '/features/[slug]' },
      { pattern: /^\/team\/[^\/]+$/, name: '/team/[slug]' }
    ];

    // Fetch sitemap
    console.log(`Fetching ${SITEMAP_URL}...`);
    const response = await axios.get(SITEMAP_URL, {
      timeout: 60000,
      headers: {
        'User-Agent': 'Coursebox-Migration-Parser/1.0'
      }
    });

    if (!response.data || typeof response.data !== 'string') {
      throw new Error('Invalid sitemap response');
    }

    const xml = response.data;
    console.log(`Sitemap downloaded (${xml.length} bytes)`);

    // Parse XML
    const $ = cheerio.load(xml, { xmlMode: true });
    const urlsSet = new Set(); // Use Set to avoid duplicates
    const pagesMapping = {}; // Map: localized URL -> EN URL

    // Extract URLs from <loc> and hreflang <link> tags
    $('url').each((_, urlNode) => {
      const $url = $(urlNode);

      // Main <loc> tag
      const mainLoc = $url.find('loc').text().trim();
      if (mainLoc) urlsSet.add(mainLoc);

      // Find EN version URL (hreflang="en") - use xhtml\:link selector for namespaced tags
      let enUrl = null;
      $url.find('xhtml\\:link').each((_, link) => {
        const hreflang = $(link).attr('hreflang');
        const href = $(link).attr('href');
        if (hreflang === 'en' && href) {
          try {
            const parsed = new URL(href);
            enUrl = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });

      // All <xhtml:link rel="alternate" hreflang="..."> tags
      $url.find('xhtml\\:link').each((_, link) => {
        const href = $(link).attr('href');
        const hreflang = $(link).attr('hreflang');
        // Skip x-default, only add actual language versions
        if (href && hreflang && hreflang !== 'x-default') {
          urlsSet.add(href);

          // Build mapping: localized URL -> EN URL (skip excluded paths)
          if (enUrl && hreflang !== 'en') {
            try {
              const parsed = new URL(href);
              const localizedPath = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '');

              // Skip excluded paths (blog, rto-materials, alternatives)
              const isExcluded = EXCLUDED_PATHS.some(ex => localizedPath.includes(ex) || enUrl.includes(ex));

              // Only add if paths differ (localized slug) and not excluded
              if (localizedPath !== enUrl && !isExcluded) {
                pagesMapping[localizedPath] = enUrl;
              }
            } catch (e) {
              // Invalid URL, skip
            }
          }
        }
      });
    });

    // Save pages-mapping.json
    const mappingPath = path.join(__dirname, 'pages-mapping.json');
    fs.writeFileSync(mappingPath, JSON.stringify(pagesMapping, null, 2), 'utf-8');
    console.log(`Saved pages-mapping.json with ${Object.keys(pagesMapping).length} mappings`);

    const urls = Array.from(urlsSet);
    console.log(`Found ${urls.length} URLs in sitemap (including all translations)`);

    if (urls.length === 0) {
      throw new Error('No URLs found in sitemap');
    }

    // Filter URLs
    const templateExamples = new Map();
    const filtered = [];

    for (const url of urls) {
      const parsed = new URL(url);
      let pathname = parsed.pathname;

      // Remove trailing slash
      if (pathname.endsWith('/') && pathname !== '/') {
        pathname = pathname.slice(0, -1);
      }

      // Skip excluded paths (blog, rto-materials)
      const isExcluded = EXCLUDED_PATHS.some(excludedPath =>
        pathname.includes(excludedPath)
      );
      if (isExcluded) continue;

      // Check template
      let template = null;
      for (const { pattern, name } of TEMPLATE_PATTERNS) {
        if (pattern.test(pathname)) {
          template = name;
          break;
        }
      }

      if (template) {
        if (templateExamples.has(template)) continue;
        templateExamples.set(template, pathname);
      }

      filtered.push(pathname);
    }

    console.log(`Filtered to ${filtered.length} unique URLs`);

    // Save to urls-main.txt
    const urlsPath = path.join(__dirname, 'urls-main.txt');
    fs.writeFileSync(urlsPath, filtered.join('\n'), 'utf-8');
    console.log(`Saved to ${urlsPath}`);

    res.json({
      success: true,
      count: filtered.length,
      total: urls.length,
      templates: templateExamples.size,
      mappings: Object.keys(pagesMapping).length
    });
  } catch (error) {
    console.error('Sitemap parse error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse sitemap'
    });
  }
});

// Sitemap comparison endpoint
const activeSitemapJobs = new Map();

app.post('/api/compare-sitemaps', async (req, res) => {
  try {
    const { devUrl } = req.body;
    const socketId = req.body.socketId;
    const socket = io.sockets.sockets.get(socketId);

    if (!socket) {
      return res.status(400).json({ error: 'Socket connection not found' });
    }

    // Check if already running
    if (activeSitemapJobs.get(socketId)) {
      return res.status(400).json({ error: 'Comparison already running' });
    }

    activeSitemapJobs.set(socketId, { running: true });

    // Path to Webflow sitemap
    const prodSitemapPath = path.join(__dirname, 'data', 'sitemap.xml');

    if (!fs.existsSync(prodSitemapPath)) {
      activeSitemapJobs.delete(socketId);
      return res.status(400).json({ error: 'Webflow sitemap not found. Please download it first.' });
    }

    res.json({ success: true, message: 'Sitemap comparison started' });

    // Run comparison async
    try {
      socket.emit('sitemap-progress', { type: 'start', message: 'Starting sitemap comparison...' });

      const result = await sitemapCompare.runComparison(
        { prodSitemapPath, devUrl },
        (data) => socket.emit('sitemap-progress', data)
      );

      // Save results
      const resultDir = path.join(__dirname, 'result');
      if (!fs.existsSync(resultDir)) {
        fs.mkdirSync(resultDir, { recursive: true });
      }

      // Generate HTML report
      const htmlReport = sitemapCompare.generateHtmlReport(
        result.comparison,
        result.stats,
        { prodUrl: 'https://www.coursebox.ai', devUrl }
      );
      fs.writeFileSync(path.join(resultDir, 'sitemap-comparison.html'), htmlReport);

      // Save JSON report
      const jsonReport = {
        timestamp: new Date().toISOString(),
        config: { prodUrl: 'https://www.coursebox.ai', devUrl },
        stats: result.stats,
        issues: {
          missingInNextjs: result.comparison.issues.missingInNextjs,
          missingInWebflow: result.comparison.issues.missingInWebflow,
          missingLanguages: result.comparison.issues.missingLanguages
        }
      };
      fs.writeFileSync(path.join(resultDir, 'sitemap-comparison.json'), JSON.stringify(jsonReport, null, 2));

      socket.emit('sitemap-progress', {
        type: 'complete',
        stats: result.stats,
        issues: {
          missingInNextjs: result.comparison.issues.missingInNextjs.length,
          missingInWebflow: result.comparison.issues.missingInWebflow.length,
          missingLanguages: result.comparison.issues.missingLanguages.length
        }
      });

    } catch (err) {
      socket.emit('sitemap-progress', { type: 'error', message: err.message });
    } finally {
      activeSitemapJobs.delete(socketId);
    }

  } catch (error) {
    console.error('Sitemap comparison error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sitemap-reports', (req, res) => {
  try {
    const resultDir = path.join(__dirname, 'result');
    const jsonPath = path.join(resultDir, 'sitemap-comparison.json');
    const htmlPath = path.join(resultDir, 'sitemap-comparison.html');

    if (!fs.existsSync(jsonPath)) {
      return res.json({ exists: false });
    }

    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    res.json({
      exists: true,
      html: fs.existsSync(htmlPath),
      timestamp: report.timestamp,
      stats: report.stats,
      issues: {
        missingInNextjs: report.issues.missingInNextjs.length,
        missingInWebflow: report.issues.missingInWebflow.length,
        missingLanguages: report.issues.missingLanguages.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download/refresh Webflow sitemap
app.post('/api/refresh-webflow-sitemap', async (req, res) => {
  try {
    const SITEMAP_URL = 'https://www.coursebox.ai/sitemap.xml';

    const response = await axios.get(SITEMAP_URL, {
      timeout: 60000,
      headers: { 'User-Agent': 'Coursebox-Migration-Parser/1.0' }
    });

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(path.join(dataDir, 'sitemap.xml'), response.data);

    // Count URLs
    const urlCount = (response.data.match(/<loc>/g) || []).length;

    res.json({
      success: true,
      message: 'Webflow sitemap downloaded',
      urlCount,
      size: response.data.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeParsingJobs.delete(socket.id);
    activeSitemapJobs.delete(socket.id);
    activeWarmupJobs.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\nCoursebox Parser Server running on http://localhost:${PORT}`);
  console.log(`UI available at http://localhost:${PORT}`);
});
