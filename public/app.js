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
const csvReportLink = document.getElementById('csvReportLink');
const statusIndicator = document.getElementById('status');
const urlsEditor = document.getElementById('urlsEditor');
const urlCount = document.getElementById('urlCount');
const saveUrlsButton = document.getElementById('saveUrlsButton');

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
      displayResults(summary);
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

function displayResults(summary) {
  resultsSection.style.display = 'block';

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

  htmlReportLink.href = `/result/comparison-report.html?t=${Date.now()}`;
  csvReportLink.href = `/result/comparison-report.csv?t=${Date.now()}`;
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

urlsEditor.addEventListener('input', updateUrlCount);
saveUrlsButton.addEventListener('click', saveUrls);

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
