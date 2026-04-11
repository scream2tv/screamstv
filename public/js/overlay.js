// Screams — OBS Overlay

const ALERT_DURATION_MS = 8000;
const EXIT_ANIMATION_MS = 400;

const container = document.getElementById('alertContainer');
const statusEl = document.getElementById('connectionStatus');

const params = new URLSearchParams(location.search);
const streamKey = params.get('stream') || params.get('streamer') || '';

let ws = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?stream=${encodeURIComponent(streamKey)}&username=OBS&role=viewer`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    statusEl.textContent = 'connected';
  });

  ws.addEventListener('close', () => {
    statusEl.textContent = 'reconnecting…';
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'tip') {
        showAlert(data);
      }
    } catch (err) {
      console.error('Parse error:', err);
    }
  });
}

function showAlert(tip) {
  const el = document.createElement('div');
  el.className = 'tip-alert';
  el.style.position = 'relative';

  const message = tip.message ? escapeHtml(tip.message) : '';
  const username = tip.username ? escapeHtml(tip.username) : 'Someone';

  el.innerHTML = `
    <div class="alert-header">
      <div class="alert-icon">&#x1F4B0;</div>
      <div>
        <div class="alert-title">${username} tipped!</div>
        <div class="alert-amount">${escapeHtml(tip.amount)}<span class="alert-currency"> tNIGHT</span></div>
      </div>
    </div>
    ${message ? `<div class="alert-message">${message}</div>` : ''}
    <div class="alert-bar"></div>
  `;

  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('exiting');
    setTimeout(() => {
      el.remove();
    }, EXIT_ANIMATION_MS);
  }, ALERT_DURATION_MS);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

if (streamKey) {
  connectWS();
} else {
  statusEl.textContent = 'no stream key — add ?stream=<key> to URL';
}
