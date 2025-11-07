const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { createObjectCsvWriter } = require('csv-writer');

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

  try {
    const url = `${baseUrl}${adjustedPath}`;
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Coursebox-Migration-Parser/1.0' }
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
      error: null
    };
  } catch (error) {
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

  if (!bothOk) {
    status = 'ERROR';
    if (prodData.status !== 200) notes.push(`Prod: ${prodData.status}`);
    if (devData.status !== 200) notes.push(`Dev: ${devData.status}`);
  } else {
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
    devError: devData.error || ''
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
    { id: 'devStatus', title: 'Dev HTTP' }
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
 * Group results by page type (removing locale prefix)
 */
function groupByPageType(results) {
  const LOCALES = ['ar', 'fr', 'de', 'es', 'it', 'pt', 'zh', 'ko', 'ja', 'nl'];
  const groups = new Map();

  for (const result of results) {
    let basePath = result.url;
    let locale = 'en';

    // Extract locale and base path
    for (const loc of LOCALES) {
      if (result.url === `/${loc}`) {
        basePath = '/';
        locale = loc;
        break;
      } else if (result.url.startsWith(`/${loc}/`)) {
        basePath = result.url.substring(loc.length + 1); // Remove /{locale}
        locale = loc;
        break;
      }
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
    html += `
      <tr class="group-header">
        <td colspan="6">
          <h3 style="margin: 0; padding: 10px 0;">
            📄 ${pageTitle}
            <span style="font-size: 14px; font-weight: normal; color: #666;">
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
  const statusColor = r.status === 'OK' ? 'green' : r.status === 'DIFF' ? 'orange' : 'red';
  const bgColor = r.status === 'DIFF' ? '#fff3cd' : r.status === 'ERROR' ? '#f8d7da' : '#d4edda';

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

  // Add locale badge and clickable links
  const localeLabel = r.locale === 'en' ? '🇬🇧 EN' : `🌍 ${r.locale.toUpperCase()}`;
  const urlDisplay = `
    <div style="margin-bottom: 8px;">
      <strong>${r.url}</strong>
      <span class="locale-badge" style="background: #e0e0e0; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${localeLabel}</span>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 4px;">
      <a href="${prodFullUrl}" target="_blank" style="background: #4CAF50; color: white; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 11px;">
        🔗 Prod
      </a>
      <a href="${devFullUrl}" target="_blank" style="background: #2196F3; color: white; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 11px;">
        🔗 Dev
      </a>
    </div>
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
    <tr style="border-bottom: 2px solid #333;">
      <td colspan="6" style="padding: 8px; background-color: #f8f9fa;">
        <strong>Differences:</strong> ${r.notes}
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
    .match-cell { background-color: #d4edda !important; border-left: 3px solid #28a745 !important; }
    .diff-cell { background-color: #ffe6e6 !important; border-left: 3px solid #ff4444 !important; }
    .migration-cell { background-color: #fff3cd !important; border-left: 3px solid #ffa500 !important; }
    .group-header { background-color: #f0f0f0; font-weight: bold; }
    .group-header td { border-top: 3px solid #333 !important; padding: 15px 10px !important; }
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

  return html;
}

async function runParser(config, socket) {
  const { prodUrl, devUrl, urls, checks } = config;
  const results = [];
  const socketId = socket.id;

  activeParsingJobs.set(socketId, { stopped: false });

  socket.emit('progress', {
    type: 'start',
    total: urls.length,
    message: `Starting comparison of ${urls.length} URLs...`
  });

  try {
    for (let i = 0; i < urls.length; i++) {
      const job = activeParsingJobs.get(socketId);
      if (job && job.stopped) {
        socket.emit('progress', {
          type: 'stopped',
          message: 'Parser stopped by user'
        });
        activeParsingJobs.delete(socketId);
        return { stopped: true };
      }

      const url = urls[i];

      socket.emit('progress', {
        type: 'fetching',
        current: i + 1,
        total: urls.length,
        url,
        message: `[${i + 1}/${urls.length}] Fetching: ${url}`
      });

      const prodData = await fetchPageData(prodUrl, url, checks);
      await delay(1000);

      if (activeParsingJobs.get(socketId)?.stopped) {
        socket.emit('progress', { type: 'stopped', message: 'Parser stopped by user' });
        activeParsingJobs.delete(socketId);
        return { stopped: true };
      }

      const devData = await fetchPageData(devUrl, url, checks);
      await delay(1000);

      if (activeParsingJobs.get(socketId)?.stopped) {
        socket.emit('progress', { type: 'stopped', message: 'Parser stopped by user' });
        activeParsingJobs.delete(socketId);
        return { stopped: true };
      }

      const comparison = comparePages(prodData, devData, checks);
      results.push(comparison);

      socket.emit('progress', {
        type: 'compared',
        current: i + 1,
        total: urls.length,
        url,
        status: comparison.status,
        message: `[${i + 1}/${urls.length}] ${url} - ${comparison.status}`
      });
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

    runParser({ prodUrl, devUrl, urls, checks }, socket)
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
    const urls = [];
    $('url loc').each((_, element) => {
      const url = $(element).text().trim();
      if (url) urls.push(url);
    });

    console.log(`Found ${urls.length} URLs in sitemap`);

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
      templates: templateExamples.size
    });
  } catch (error) {
    console.error('Sitemap parse error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse sitemap'
    });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    activeParsingJobs.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\nCoursebox Parser Server running on http://localhost:${PORT}`);
  console.log(`UI available at http://localhost:${PORT}`);
});
