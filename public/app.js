const socket = io();

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const prodUrlInput = document.getElementById('prodUrl');
const devUrlInput = document.getElementById('devUrl');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressLog = document.getElementById('progressLog');
const summaryGrid = document.getElementById('summaryGrid');
const htmlReportLink = document.getElementById('htmlReportLink');
const csvReportEnglishLink = document.getElementById('csvReportEnglishLink');
const csvReportOtherLink = document.getElementById('csvReportOtherLink');
const statusIndicator = document.getElementById('status');
const urlsEditor = document.getElementById('urlsEditor');
const urlCount = document.getElementById('urlCount');
const saveUrlsButton = document.getElementById('saveUrlsButton');
const parseSitemapButton = document.getElementById('parseSitemapButton');

let isRunning = false;

socket.on('connect', () => {
  console.log('Connected to server');
  statusIndicator.textContent = 'Connected';
  statusIndicator.className = 'connected';
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  statusIndicator.textContent = 'Disconnected';
  statusIndicator.className = 'disconnected';
});

socket.on('progress', (data) => {
  handleProgress(data);
});

function resetUI() {
  progressSection.style.display = 'none';
  resultsSection.style.display = 'none';
  progressLog.innerHTML = '';
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  summaryGrid.innerHTML = '';
  isRunning = false;
  startButton.disabled = false;
  startButton.textContent = 'Start Comparison';
  startButton.style.display = 'inline-block';
  stopButton.style.display = 'none';
}

function handleProgress(data) {
  const { type, current, total, url, status, message, summary } = data;

  switch (type) {
    case 'start':
      progressSection.style.display = 'block';
      resultsSection.style.display = 'none';
      progressLog.innerHTML = '';
      addLogEntry(message, 'info');
      break;

    case 'fetching':
      const percentage = Math.round((current / total) * 100);
      updateProgressBar(percentage);
      addLogEntry(message, 'info');
      break;

    case 'compared':
      const pct = Math.round((current / total) * 100);
      updateProgressBar(pct);
      const logClass = status === 'OK' ? 'success' : status === 'DIFF' ? 'warning' : 'error';
      addLogEntry(message, logClass);
      break;

    case 'generating':
      updateProgressBar(100);
      addLogEntry(message, 'info');
      break;

    case 'complete':
      addLogEntry(message, 'success');
      displayResults(summary, new Date());
      isRunning = false;
      startButton.disabled = false;
      startButton.textContent = 'Start Comparison';
      startButton.style.display = 'inline-block';
      stopButton.style.display = 'none';
      break;

    case 'stopped':
      addLogEntry(message, 'warning');
      setTimeout(resetUI, 1000);
      break;

    case 'error':
      addLogEntry(`ERROR: ${message}`, 'error');
      isRunning = false;
      startButton.disabled = false;
      startButton.textContent = 'Start Comparison';
      startButton.style.display = 'inline-block';
      stopButton.style.display = 'none';
      break;
  }
}

function updateProgressBar(percentage) {
  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${percentage}%`;
}

function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  progressLog.appendChild(entry);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function displayResults(summary, timestamp) {
  resultsSection.style.display = 'block';

  const timeAgo = timestamp ? formatTimeAgo(timestamp) : '';

  summaryGrid.innerHTML = `
    <div class="summary-card success">
      <h3>✅ Perfect Match</h3>
      <div class="value">${summary.ok}</div>
      <small>All elements identical</small>
    </div>
    <div class="summary-card warning">
      <h3>⚠️ Differences</h3>
      <div class="value">${summary.diff}</div>
      <small>Some elements differ</small>
    </div>
    <div class="summary-card error">
      <h3>❌ Errors</h3>
      <div class="value">${summary.error}</div>
      <small>Pages unavailable</small>
    </div>
    <div class="summary-card">
      <h3>📊 Total</h3>
      <div class="value">${summary.total}</div>
      <small>URLs checked</small>
    </div>
  `;

  if (timestamp) {
    summaryGrid.innerHTML += `
      <div class="summary-card" style="grid-column: 1 / -1;">
        <h3>🕐 Last Generated</h3>
        <div class="value" style="font-size: 1.2rem;">${timeAgo}</div>
        <small>${new Date(timestamp).toLocaleString()}</small>
      </div>
    `;
  }

  htmlReportLink.href = `/result/comparison-report.html?t=${Date.now()}`;
  csvReportEnglishLink.href = `/result/comparison-report-english.csv?t=${Date.now()}`;
  csvReportOtherLink.href = `/result/comparison-report-other-languages.csv?t=${Date.now()}`;
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);

  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

async function checkExistingReports() {
  try {
    const response = await fetch('/api/reports');
    const data = await response.json();

    if (data.exists) {
      const summary = data.summary || { ok: 0, diff: 0, error: 0, total: 0 };
      displayResults(summary, data.timestamp);
    }
  } catch (error) {
    console.error('Failed to check existing reports:', error);
  }
}

startButton.addEventListener('click', async () => {
  if (isRunning) return;

  const prodUrl = prodUrlInput.value.trim();
  const devUrl = devUrlInput.value.trim();

  if (!prodUrl || !devUrl) {
    alert('Please enter both Production and Development URLs');
    return;
  }

  const checks = {
    status: document.getElementById('checkStatus').checked,
    title: document.getElementById('checkTitle').checked,
    description: document.getElementById('checkDescription').checked,
    h1: document.getElementById('checkH1').checked,
    ogImage: document.getElementById('checkOgImage').checked
  };

  if (!checks.title && !checks.description && !checks.h1 && !checks.ogImage) {
    alert('Please select at least one element to compare');
    return;
  }

  isRunning = true;
  startButton.disabled = true;
  startButton.textContent = 'Running...';
  startButton.style.display = 'none';
  stopButton.style.display = 'inline-block';

  try {
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prodUrl,
        devUrl,
        checks,
        socketId: socket.id
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to start parser');
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    resetUI();
  }
});

stopButton.addEventListener('click', async () => {
  stopButton.disabled = true;
  stopButton.textContent = 'Stopping...';

  try {
    const response = await fetch('/api/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        socketId: socket.id
      })
    });

    const result = await response.json();
    if (!result.success) {
      console.error('Failed to stop parser:', result.message);
    }
  } catch (error) {
    console.error('Error stopping parser:', error);
    resetUI();
  } finally {
    stopButton.disabled = false;
    stopButton.textContent = 'Stop Parser';
  }
});

function countUrls(content) {
  const urls = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  return urls.length;
}

function updateUrlCount() {
  const count = countUrls(urlsEditor.value);
  urlCount.textContent = `${count} URL${count !== 1 ? 's' : ''}`;
}

async function loadUrls() {
  try {
    const response = await fetch('/api/urls');
    const data = await response.json();
    urlsEditor.value = data.content;
    updateUrlCount();
  } catch (error) {
    console.error('Failed to load URLs:', error);
  }
}

async function saveUrls() {
  try {
    saveUrlsButton.disabled = true;
    saveUrlsButton.textContent = 'Saving...';

    const response = await fetch('/api/urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: urlsEditor.value
      })
    });

    const result = await response.json();

    if (result.success) {
      updateUrlCount();
      saveUrlsButton.textContent = '✓ Saved';
      setTimeout(() => {
        saveUrlsButton.textContent = 'Save Changes';
        saveUrlsButton.disabled = false;
      }, 2000);
    } else {
      throw new Error(result.error || 'Failed to save');
    }
  } catch (error) {
    alert(`Error saving URLs: ${error.message}`);
    saveUrlsButton.textContent = 'Save Changes';
    saveUrlsButton.disabled = false;
  }
}

async function parseSitemap() {
  try {
    parseSitemapButton.disabled = true;
    parseSitemapButton.textContent = 'Parsing...';

    const response = await fetch('/api/sitemap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Reload URLs from server
      await loadUrls();
      updateUrlCount();

      parseSitemapButton.textContent = `✓ Imported ${result.count} URLs`;
      setTimeout(() => {
        parseSitemapButton.textContent = 'Import from Sitemap';
        parseSitemapButton.disabled = false;
      }, 3000);
    } else {
      throw new Error(result.error || 'Failed to parse sitemap');
    }
  } catch (error) {
    console.error('Sitemap parse error:', error);
    alert(`Error parsing sitemap: ${error.message}`);
    parseSitemapButton.textContent = 'Import from Sitemap';
    parseSitemapButton.disabled = false;
  }
}

urlsEditor.addEventListener('input', updateUrlCount);
saveUrlsButton.addEventListener('click', saveUrls);
parseSitemapButton.addEventListener('click', parseSitemap);

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    prodUrlInput.value = config.prodUrl;
    devUrlInput.value = config.devUrl;

    document.getElementById('checkStatus').checked = config.checks.status;
    document.getElementById('checkTitle').checked = config.checks.title;
    document.getElementById('checkDescription').checked = config.checks.description;
    document.getElementById('checkH1').checked = config.checks.h1;
    document.getElementById('checkOgImage').checked = config.checks.ogImage;
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

loadConfig();
loadUrls();
checkExistingReports();

// ============================================
// Tab Navigation
// ============================================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;

    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

// ============================================
// Sitemap Compare Tab
// ============================================

const sitemapDevUrlInput = document.getElementById('sitemapDevUrl');
const webflowSitemapStatus = document.getElementById('webflowSitemapStatus');
const refreshWebflowSitemapBtn = document.getElementById('refreshWebflowSitemap');
const startSitemapCompareBtn = document.getElementById('startSitemapCompare');
const sitemapProgressSection = document.getElementById('sitemapProgressSection');
const sitemapProgressLog = document.getElementById('sitemapProgressLog');
const sitemapResultsSection = document.getElementById('sitemapResultsSection');
const sitemapSummaryGrid = document.getElementById('sitemapSummaryGrid');
const sitemapHtmlReportLink = document.getElementById('sitemapHtmlReportLink');

let sitemapCompareRunning = false;

// Check Webflow sitemap status
async function checkWebflowSitemap() {
  try {
    const response = await fetch('/api/sitemap-reports');
    const data = await response.json();

    if (data.exists) {
      webflowSitemapStatus.textContent = `✅ Available (${formatTimeAgo(data.timestamp)})`;
      webflowSitemapStatus.className = 'info-value success';

      // Show existing results
      displaySitemapResults(data.stats, data.issues, data.timestamp);
    } else {
      webflowSitemapStatus.textContent = '⚠️ Not downloaded yet';
      webflowSitemapStatus.className = 'info-value';
    }
  } catch (error) {
    webflowSitemapStatus.textContent = '❌ Error checking status';
    webflowSitemapStatus.className = 'info-value error';
  }
}

// Refresh Webflow sitemap
refreshWebflowSitemapBtn.addEventListener('click', async () => {
  try {
    refreshWebflowSitemapBtn.disabled = true;
    refreshWebflowSitemapBtn.textContent = '⏳ Downloading...';

    const response = await fetch('/api/refresh-webflow-sitemap', { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      refreshWebflowSitemapBtn.textContent = `✅ Downloaded (${result.urlCount} URLs)`;
      webflowSitemapStatus.textContent = '✅ Just updated';
      webflowSitemapStatus.className = 'info-value success';

      setTimeout(() => {
        refreshWebflowSitemapBtn.textContent = '🔄 Refresh Webflow Sitemap';
        refreshWebflowSitemapBtn.disabled = false;
      }, 3000);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    refreshWebflowSitemapBtn.textContent = '🔄 Refresh Webflow Sitemap';
    refreshWebflowSitemapBtn.disabled = false;
  }
});

// Start sitemap comparison
startSitemapCompareBtn.addEventListener('click', async () => {
  if (sitemapCompareRunning) return;

  const devUrl = sitemapDevUrlInput.value.trim();
  if (!devUrl) {
    alert('Please enter Development URL');
    return;
  }

  sitemapCompareRunning = true;
  startSitemapCompareBtn.disabled = true;
  startSitemapCompareBtn.textContent = 'Running...';

  sitemapProgressSection.style.display = 'block';
  sitemapResultsSection.style.display = 'none';
  sitemapProgressLog.innerHTML = '';

  try {
    const response = await fetch('/api/compare-sitemaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devUrl, socketId: socket.id })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    resetSitemapUI();
  }
});

// Handle sitemap progress events
socket.on('sitemap-progress', (data) => {
  handleSitemapProgress(data);
});

function handleSitemapProgress(data) {
  const { type, message, stats, issues } = data;

  switch (type) {
    case 'start':
    case 'status':
      addSitemapLogEntry(message);
      break;

    case 'complete':
      addSitemapLogEntry('✅ Comparison complete!', 'success');
      displaySitemapResults(stats, issues);
      resetSitemapUI();
      break;

    case 'error':
      addSitemapLogEntry(`❌ Error: ${message}`, 'error');
      resetSitemapUI();
      break;
  }
}

function addSitemapLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  sitemapProgressLog.appendChild(entry);
  sitemapProgressLog.scrollTop = sitemapProgressLog.scrollHeight;
}

function displaySitemapResults(stats, issues, timestamp) {
  sitemapResultsSection.style.display = 'block';

  const timeAgo = timestamp ? formatTimeAgo(timestamp) : 'Just now';

  sitemapSummaryGrid.innerHTML = `
    <div class="summary-card info">
      <h3>📊 Webflow Slugs</h3>
      <div class="value">${stats.webflowSlugs?.toLocaleString() || 0}</div>
      <small>Unique pages in prod</small>
    </div>
    <div class="summary-card info">
      <h3>📊 Next.js Slugs</h3>
      <div class="value">${stats.nextjsSlugs?.toLocaleString() || 0}</div>
      <small>Unique pages in dev</small>
    </div>
    <div class="summary-card success">
      <h3>✅ Matching</h3>
      <div class="value">${stats.matchingSlugs?.toLocaleString() || 0}</div>
      <small>Pages in both</small>
    </div>
    <div class="summary-card success">
      <h3>🎯 Perfect Match</h3>
      <div class="value">${stats.perfectMatch?.toLocaleString() || 0}</div>
      <small>All languages match</small>
    </div>
    <div class="summary-card error">
      <h3>❌ Missing in Dev</h3>
      <div class="value">${issues?.missingInNextjs || 0}</div>
      <small>Need to migrate</small>
    </div>
    <div class="summary-card warning">
      <h3>ℹ️ New in Dev</h3>
      <div class="value">${issues?.missingInWebflow || 0}</div>
      <small>New pages</small>
    </div>
    <div class="summary-card warning">
      <h3>⚠️ Missing Languages</h3>
      <div class="value">${issues?.missingLanguages || 0}</div>
      <small>Need translations</small>
    </div>
    <div class="summary-card" style="grid-column: 1 / -1;">
      <h3>🕐 Last Generated</h3>
      <div class="value" style="font-size: 1.2rem;">${timeAgo}</div>
      <small>${timestamp ? new Date(timestamp).toLocaleString() : 'Just now'}</small>
    </div>
  `;

  sitemapHtmlReportLink.href = `/result/sitemap-comparison.html?t=${Date.now()}`;
}

function resetSitemapUI() {
  sitemapCompareRunning = false;
  startSitemapCompareBtn.disabled = false;
  startSitemapCompareBtn.textContent = 'Start Comparison';
}

// Initialize sitemap tab
checkWebflowSitemap();

// ============================================
// Cache Warmup Tab
// ============================================

const warmupUrlInput = document.getElementById('warmupUrl');
const warmupUrlCountDisplay = document.getElementById('warmupUrlCount');
const startWarmupBtn = document.getElementById('startWarmup');
const stopWarmupBtn = document.getElementById('stopWarmup');
const warmupProgressSection = document.getElementById('warmupProgressSection');
const warmupProgressFill = document.getElementById('warmupProgressFill');
const warmupProgressText = document.getElementById('warmupProgressText');
const warmupProgressLog = document.getElementById('warmupProgressLog');
const warmupResultsSection = document.getElementById('warmupResultsSection');
const warmupSummaryGrid = document.getElementById('warmupSummaryGrid');

let warmupRunning = false;

// Update warmup URL count from urls-main.txt
async function updateWarmupUrlCount() {
  try {
    const response = await fetch('/api/urls');
    const data = await response.json();
    const count = data.content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')).length;
    warmupUrlCountDisplay.textContent = `${count} URLs`;
  } catch (error) {
    warmupUrlCountDisplay.textContent = 'Error loading';
  }
}

// Check existing warmup reports
async function checkWarmupReports() {
  try {
    const response = await fetch('/api/warmup/reports');
    const data = await response.json();

    if (data.exists) {
      displayWarmupResults(data.stats, data.timestamp);
    }
  } catch (error) {
    console.error('Failed to check warmup reports:', error);
  }
}

// Start warmup
startWarmupBtn.addEventListener('click', async () => {
  if (warmupRunning) return;

  const baseUrl = warmupUrlInput.value.trim();
  if (!baseUrl) {
    alert('Please enter Target URL');
    return;
  }

  warmupRunning = true;
  startWarmupBtn.style.display = 'none';
  stopWarmupBtn.style.display = 'inline-block';

  warmupProgressSection.style.display = 'block';
  warmupResultsSection.style.display = 'none';
  warmupProgressLog.innerHTML = '';
  warmupProgressFill.style.width = '0%';
  warmupProgressText.textContent = '0%';

  try {
    const response = await fetch('/api/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, socketId: socket.id })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    resetWarmupUI();
  }
});

// Stop warmup
stopWarmupBtn.addEventListener('click', async () => {
  stopWarmupBtn.disabled = true;
  stopWarmupBtn.textContent = 'Stopping...';

  try {
    await fetch('/api/warmup/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socketId: socket.id })
    });
  } catch (error) {
    console.error('Error stopping warmup:', error);
  } finally {
    stopWarmupBtn.disabled = false;
    stopWarmupBtn.textContent = 'Stop Warmup';
  }
});

// Handle warmup progress events
socket.on('warmup-progress', (data) => {
  handleWarmupProgress(data);
});

function handleWarmupProgress(data) {
  const { type, current, total, url, status, duration, message, stats } = data;

  switch (type) {
    case 'start':
      addWarmupLogEntry(message, 'info');
      break;

    case 'fetched':
      const percentage = Math.round((current / total) * 100);
      warmupProgressFill.style.width = `${percentage}%`;
      warmupProgressText.textContent = `${percentage}%`;

      const logClass = status === 200 ? 'success' : 'error';
      addWarmupLogEntry(message, logClass);
      break;

    case 'generating':
      warmupProgressFill.style.width = '100%';
      warmupProgressText.textContent = '100%';
      addWarmupLogEntry(message, 'info');
      break;

    case 'complete':
      addWarmupLogEntry(message, 'success');
      displayWarmupResults(stats);
      resetWarmupUI();
      break;

    case 'stopped':
      addWarmupLogEntry(message, 'warning');
      resetWarmupUI();
      break;

    case 'error':
      addWarmupLogEntry(`ERROR: ${message}`, 'error');
      resetWarmupUI();
      break;
  }
}

function addWarmupLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  warmupProgressLog.appendChild(entry);
  warmupProgressLog.scrollTop = warmupProgressLog.scrollHeight;
}

function displayWarmupResults(stats, timestamp) {
  warmupResultsSection.style.display = 'block';

  const timeAgo = timestamp ? formatTimeAgo(timestamp) : 'Just now';
  const totalTimeStr = stats.totalTime ? `${Math.round(stats.totalTime / 1000)}s` : 'N/A';

  warmupSummaryGrid.innerHTML = `
    <div class="summary-card success">
      <h3>✅ Success (200)</h3>
      <div class="value">${stats.success || 0}</div>
      <small>Pages loaded</small>
    </div>
    <div class="summary-card error">
      <h3>❌ Errors</h3>
      <div class="value">${stats.errors || 0}</div>
      <small>Failed requests</small>
    </div>
    <div class="summary-card warning">
      <h3>⏱️ Avg Duration</h3>
      <div class="value">${stats.avgDuration || 0}ms</div>
      <small>Per page</small>
    </div>
    <div class="summary-card">
      <h3>🕐 Total Time</h3>
      <div class="value">${totalTimeStr}</div>
      <small>${stats.total || 0} pages</small>
    </div>
    <div class="summary-card" style="grid-column: 1 / -1;">
      <h3>🕐 Last Run</h3>
      <div class="value" style="font-size: 1.2rem;">${timeAgo}</div>
      <small>${timestamp ? new Date(timestamp).toLocaleString() : 'Just now'}</small>
    </div>
  `;
}

function resetWarmupUI() {
  warmupRunning = false;
  startWarmupBtn.style.display = 'inline-block';
  stopWarmupBtn.style.display = 'none';
}

// Initialize warmup tab
updateWarmupUrlCount();
checkWarmupReports();
