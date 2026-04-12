// Screams — Creator Dashboard

let streamKey = '';
let authToken = '';
let ws = null;
let tipCount = 0;
let hlsPlayer = null;

// --- Restore session ---

const saved = localStorage.getItem('screams_streamer');
if (saved) {
  try {
    const s = JSON.parse(saved);
    if (s.streamKey && s.authToken) {
      streamKey = s.streamKey;
      authToken = s.authToken;
      enterDashboard(s.displayName || 'Streamer');
    }
  } catch {}
}

// --- Setup (registration disabled - invite only) ---

document.getElementById('loginBtn').addEventListener('click', () => {
  document.getElementById('loginModal').classList.toggle('hidden');
});

document.getElementById('loginSubmit').addEventListener('click', async () => {
  const sk = document.getElementById('loginStreamKey').value.trim();
  const at = document.getElementById('loginAuth').value.trim();
  if (!sk || !at) {
    showSetupError('Both fields are required');
    return;
  }

  const btn = document.getElementById('loginSubmit');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Signing in…';
  hideSetupError();

  try {
    const resp = await fetch(`/api/v1/streams/${sk}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error?.message || json.error || 'Sign-in failed');
    const data = { displayName: json.data.name };

    streamKey = sk;
    authToken = at;
    localStorage.setItem('screams_streamer', JSON.stringify({ streamKey: sk, authToken: at, displayName: data.displayName }));
    enterDashboard(data.displayName);
  } catch (e) {
    showSetupError(e.message || 'Sign-in failed');
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = originalLabel;
  }
});

// --- Dashboard ---

function enterDashboard(displayName) {
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');

  document.getElementById('dashName').textContent = displayName;
  document.getElementById('dashStreamKey').textContent = streamKey;
  document.getElementById('watchUrl').textContent = `${location.origin}/watch/${streamKey}`;
  document.getElementById('overlayUrl').textContent = `${location.origin}/overlay.html?stream=${streamKey}`;

  document.getElementById('streamTitle').value = `${displayName}'s stream`;

  connectWS();
  startPreview();
}

// --- Preview ---

function startPreview() {
  const video = document.getElementById('previewVideo');
  const offline = document.getElementById('previewOffline');
  const hlsUrl = `${location.origin}/media/live/${streamKey}/index.m3u8`;

  const RETRY_MIN = 5000;
  const RETRY_MAX = 30000;
  let retryDelay = RETRY_MIN;
  let retryTimer = null;

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(tryConnect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
  }

  function showOnline() {
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    video.style.display = 'block';
    offline.style.display = 'none';
    document.getElementById('liveIndicator').classList.remove('hidden');
    document.getElementById('streamStatus').textContent = 'Live';
    document.getElementById('streamStatus').style.color = 'var(--green)';
  }

  function showOffline() {
    video.style.display = 'none';
    offline.style.display = 'flex';
    document.getElementById('liveIndicator').classList.add('hidden');
    document.getElementById('streamStatus').textContent = 'Offline';
    document.getElementById('streamStatus').style.color = '';
  }

  function tryConnect() {
    clearTimeout(retryTimer);

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (hlsPlayer) hlsPlayer.destroy();
      hlsPlayer = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6 });
      hlsPlayer.loadSource(hlsUrl);
      hlsPlayer.attachMedia(video);

      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        // Connected — stop retrying and reset backoff for next disconnect
        clearTimeout(retryTimer);
        retryDelay = RETRY_MIN;
        showOnline();
      });

      hlsPlayer.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          showOffline();
          hlsPlayer.destroy();
          hlsPlayer = null;
          scheduleRetry();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(retryTimer);
        retryDelay = RETRY_MIN;
        showOnline();
      }, { once: true });
      video.addEventListener('error', () => {
        showOffline();
        scheduleRetry();
      }, { once: true });
    }
  }

  tryConnect();
}

// --- WebSocket ---
//
// Same exponential backoff as watch.js: 1s → 2s → 4s → 8s → max 30s,
// reset on server handshake. No username param — the server ignores it
// for unauthenticated connections anyway. The dashboard keeps using
// role=streamer so media-server events still flow.

const DASH_WS_MIN = 1000;
const DASH_WS_MAX = 30000;
let dashWsBackoff = DASH_WS_MIN;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?stream=${encodeURIComponent(streamKey)}&role=streamer`;

  ws = new WebSocket(url);

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') dashWsBackoff = DASH_WS_MIN;
      if (msg.type === 'tip') addTip(msg);
      if (msg.type === 'viewer_count') {
        document.getElementById('viewerCount').textContent = msg.count;
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    const delay = dashWsBackoff;
    dashWsBackoff = Math.min(dashWsBackoff * 2, DASH_WS_MAX);
    setTimeout(connectWS, delay);
  });
}

let sessionEarnings = 0;

function addTip(tip) {
  const feed = document.getElementById('tipFeed');
  if (tipCount === 0) feed.innerHTML = '';
  tipCount++;

  sessionEarnings += parseFloat(tip.amount) || 0;
  document.getElementById('earningsValue').textContent = sessionEarnings.toFixed(2);

  const item = document.createElement('div');
  item.className = 'tip-item';
  const time = new Date(tip.timestamp).toLocaleTimeString();
  item.innerHTML = `
    <div class="tip-amount">${tip.amount} <span class="currency">tNIGHT</span></div>
    <div style="flex:1">
      <div class="tip-message">${escapeHtml(tip.message || 'No message')}</div>
      <div class="tip-meta">${escapeHtml(tip.username)} &middot; ${time}</div>
    </div>
  `;
  feed.prepend(item);
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

// --- Update Info ---

document.getElementById('updateInfoBtn').addEventListener('click', async () => {
  const title = document.getElementById('streamTitle').value.trim();
  const category = document.getElementById('streamCategory').value;

  const btn = document.getElementById('updateInfoBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Saving…';

  try {
    const resp = await fetch('/api/v1/streams/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ title, category }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    showToast('Stream info updated!');
  } catch (e) {
    showToast(`Update failed: ${e.message || 'network error'}`);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = originalLabel;
  }
});

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

function copyField(id) {
  const text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

function showToast(msg) {
  const toast = document.getElementById('copyToast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function showSetupError(msg) {
  const el = document.getElementById('setupError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function hideSetupError() {
  const el = document.getElementById('setupError');
  if (el) el.style.display = 'none';
}
