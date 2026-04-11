// Screams — Creator Dashboard

let streamKey = '';
let authToken = '';
let ws = null;
let tipCount = 0;
let hlsPlayer = null;

// --- Restore session ---

const saved = localStorage.getItem('lump_streamer');
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
  if (!sk || !at) return;

  try {
    const resp = await fetch(`/api/v1/streams/${sk}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error?.message || json.error);
    const data = { displayName: json.data.name };

    streamKey = sk;
    authToken = at;
    localStorage.setItem('lump_streamer', JSON.stringify({ streamKey: sk, authToken: at, displayName: data.displayName }));
    enterDashboard(data.displayName);
  } catch (e) {
    showSetupError(e.message);
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

  let retryTimer = null;

  function tryConnect() {
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (hlsPlayer) hlsPlayer.destroy();
      hlsPlayer = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6 });
      hlsPlayer.loadSource(hlsUrl);
      hlsPlayer.attachMedia(video);

      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        video.style.display = 'block';
        offline.style.display = 'none';
        document.getElementById('liveIndicator').classList.remove('hidden');
        document.getElementById('streamStatus').textContent = 'Live';
        document.getElementById('streamStatus').style.color = 'var(--green)';
      });

      hlsPlayer.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          video.style.display = 'none';
          offline.style.display = 'flex';
          document.getElementById('liveIndicator').classList.add('hidden');
          document.getElementById('streamStatus').textContent = 'Offline';
          document.getElementById('streamStatus').style.color = '';
          hlsPlayer.destroy();
          hlsPlayer = null;
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
        video.style.display = 'block';
        offline.style.display = 'none';
      });
    }
  }

  tryConnect();
  retryTimer = setInterval(tryConnect, 5000);
}

// --- WebSocket ---

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?stream=${encodeURIComponent(streamKey)}&username=Streamer&role=streamer`;

  ws = new WebSocket(url);

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'tip') addTip(msg);
      if (msg.type === 'viewer_count') {
        document.getElementById('viewerCount').textContent = msg.count;
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWS, 3000);
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

  await fetch('/api/v1/streams/me', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ title, category }),
  });
  showToast('Stream info updated!');
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
  el.textContent = msg;
  el.style.display = 'block';
}
