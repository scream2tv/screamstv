// Screams — Watch Page

const pathParts = location.pathname.split('/');
const STREAM_KEY = pathParts[pathParts.length - 1];

// USERNAME is kept as a local-only identifier for this browser (used if
// we ever wire up a "remember me" flow). It is NOT passed to the WebSocket
// anymore — the server forces unauthenticated viewers to "Viewer" and
// ignores ?username=. See src/ws/handler.ts.
const USERNAME = getOrCreateUsername();
document.getElementById('navUsername').textContent = 'Viewer';

let ws = null;
let hlsPlayer = null;
let isTheater = false;
let isFollowing = false;

// --- Load Streamer Info ---

function showStreamerError(text) {
  const el = document.getElementById('streamerLoadError');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
}
function clearStreamerError() {
  const el = document.getElementById('streamerLoadError');
  if (el) el.classList.remove('visible');
}

async function loadStreamerInfo() {
  try {
    const resp = await fetch(`/api/v1/streams/${STREAM_KEY}`);
    const json = await resp.json();
    if (!resp.ok) {
      document.getElementById('offlineText').textContent = 'Channel not found';
      document.getElementById('streamerName').textContent = 'Unknown channel';
      showStreamerError('Channel not found');
      return;
    }
    const data = json.data;

    clearStreamerError();
    document.getElementById('streamerName').textContent = data.name;
    document.getElementById('streamerAvatar').textContent = data.name.charAt(0).toUpperCase();
    document.getElementById('streamTitle').textContent = data.title;
    document.getElementById('streamCategory').textContent = data.category;
    document.title = `${data.name} — Screams`;
    streamerShieldedAddress = data.shielded_address || null;

    if (data.is_live) {
      initPlayer();
    }
  } catch (e) {
    console.error('Failed to load streamer info:', e);
    document.getElementById('streamerName').textContent = 'Loading failed';
    showStreamerError("Couldn't load channel info");
  }
}

// --- HLS Player ---

function initPlayer() {
  const video = document.getElementById('videoPlayer');
  const offline = document.getElementById('playerOffline');
  const hlsUrl = `${location.origin}/media/live/${STREAM_KEY}/index.m3u8`;

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    if (hlsPlayer) hlsPlayer.destroy();
    hlsPlayer = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6 });
    hlsPlayer.loadSource(hlsUrl);
    hlsPlayer.attachMedia(video);

    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      video.style.display = 'block';
      offline.style.display = 'none';
      document.getElementById('livePill').style.display = 'inline-flex';
    });

    hlsPlayer.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        video.style.display = 'none';
        offline.style.display = 'flex';
        document.getElementById('livePill').style.display = 'none';
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

// Retry connecting to stream periodically. Briefly flip the offline
// panel into a "checking" state + swap the primary label so the user
// can see something's happening.
setInterval(() => {
  if (hlsPlayer) return;
  const offline = document.getElementById('playerOffline');
  const offlineText = document.getElementById('offlineText');
  if (!offline || !offlineText) return;

  offline.classList.add('checking');
  const originalText = 'Signal offline';
  offlineText.textContent = 'Reconnecting…';
  setTimeout(() => {
    offline.classList.remove('checking');
    if (offlineText.textContent === 'Reconnecting…') {
      offlineText.textContent = originalText;
    }
  }, 1600);

  initPlayer();
}, 8000);

// --- Player Controls ---

document.getElementById('playPauseBtn').addEventListener('click', () => {
  const video = document.getElementById('videoPlayer');
  if (video.paused) { video.play(); } else { video.pause(); }
});

document.getElementById('muteBtn').addEventListener('click', () => {
  const video = document.getElementById('videoPlayer');
  video.muted = !video.muted;
  document.getElementById('muteBtn').innerHTML = video.muted ? '&#x1F507;' : '&#x1F50A;';
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
  const video = document.getElementById('videoPlayer');
  video.volume = e.target.value / 100;
  video.muted = false;
  document.getElementById('muteBtn').innerHTML = video.volume === 0 ? '&#x1F507;' : '&#x1F50A;';
});

document.getElementById('theaterBtn').addEventListener('click', () => {
  isTheater = !isTheater;
  document.getElementById('watchLayout').classList.toggle('theater', isTheater);
});

document.getElementById('fullscreenBtn').addEventListener('click', () => {
  const wrap = document.getElementById('playerWrap');
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    wrap.requestFullscreen().catch(() => {});
  }
});

// --- WebSocket ---
//
// Exponential backoff reconnect: 1s → 2s → 4s → 8s → max 30s.
// The backoff resets on the server's {type:"connected"} handshake.
// Close code 4001 (Priority #3 invalid-token path) is treated as fatal
// — no reconnect loop, visible "Authentication failed" message.
// We deliberately no longer pass &username= — the server now forces
// "Viewer" for unauthenticated connections (see ws/handler.ts).

const WS_BACKOFF_MIN = 1000;
const WS_BACKOFF_MAX = 30000;
let wsBackoff = WS_BACKOFF_MIN;
let wsFatal = false;
let wsHadOpen = false;
let wsReconnectTimer = null;

function connectWS() {
  if (wsFatal) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?stream=${encodeURIComponent(STREAM_KEY)}&role=viewer`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    wsHadOpen = true;
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'connected') {
        // Server-side handshake: reset backoff and surface reconnect UX
        wsBackoff = WS_BACKOFF_MIN;
        if (wsReconnectTimer) {
          addChatMessage({ type: 'system', message: 'Chat reconnected' });
          wsReconnectTimer = null;
        } else {
          addChatMessage({ type: 'system', message: 'Connected to chat' });
        }
        return;
      }
      if (msg.type === 'chat' || msg.type === 'tip' || msg.type === 'system') {
        addChatMessage(msg);
      }
      if (msg.type === 'viewer_count') {
        updateViewerCounts(msg.count);
      }
    } catch {}
  });

  ws.addEventListener('close', (event) => {
    if (event.code === 4001) {
      wsFatal = true;
      addChatMessage({ type: 'system', message: 'Authentication failed — chat disabled' });
      return;
    }

    // Only announce a disconnect if we had been successfully open — otherwise
    // we'd flood the chat with reconnect notices on a server that's down.
    if (wsHadOpen && !wsReconnectTimer) {
      addChatMessage({ type: 'system', message: 'Chat disconnected — reconnecting…' });
    }

    const delay = wsBackoff;
    wsBackoff = Math.min(wsBackoff * 2, WS_BACKOFF_MAX);
    wsReconnectTimer = setTimeout(connectWS, delay);
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

// --- Chat Input ---

document.getElementById('chatSendBtn').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ type: 'chat', message: text }));
  input.value = '';
}

// --- Follow ---

document.getElementById('followBtn').addEventListener('click', () => {
  isFollowing = !isFollowing;
  const btn = document.getElementById('followBtn');
  btn.textContent = isFollowing ? 'Following' : 'Follow';
  btn.classList.toggle('btn-following', isFollowing);
});

// Note: tipping is in Phase 2. The previous wallet-detection /
// tip-modal / sendTipWithWallet block was deleted in this commit
// because the DOM elements it bound to (#tipBtnBar, #tipModal,
// .tip-preset, etc.) were stripped out of watch.html long ago, so
// every page load was throwing a TypeError on the first
// addEventListener and silently breaking everything below — including
// the WebSocket reconnect added in this same priority. When Midnight
// integration ships in Priority #5 it'll come back behind real DOM.

let streamerShieldedAddress = null;

// --- Init ---

loadStreamerInfo();
connectWS();
