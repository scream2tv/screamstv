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
let nativeHlsActive = false;
let isTheater = false;
let isFollowing = false;
let mediaErrorRecoveryCount = 0;
const MAX_MEDIA_ERROR_RECOVERIES = 2;

// Track the most recent chat message timestamp we've rendered so reconnects
// can skip duplicates.
let lastChatTimestamp = 0;

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
    const avatarEl = document.getElementById('streamerAvatar');
    if (data.avatar_url) {
      avatarEl.textContent = '';
      const img = document.createElement('img');
      img.src = data.avatar_url;
      img.alt = data.name;
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = data.name.charAt(0).toUpperCase();
    }
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

// Attempt play with muted fallback for autoplay policy.
// Browsers block unmuted autoplay; retry muted so the stream isn't black.
function tryPlay(video) {
  video.play().catch(() => {
    video.muted = true;
    document.getElementById('muteBtn').textContent = '\u{1F507}';
    video.play().catch(() => {});
  });
}

function showLive(video, offline) {
  video.style.display = 'block';
  offline.style.display = 'none';
  document.getElementById('livePill').style.display = 'inline-flex';
}

function showOffline(video, offline) {
  video.style.display = 'none';
  offline.style.display = 'flex';
  document.getElementById('livePill').style.display = 'none';
}

function initPlayer() {
  const video = document.getElementById('videoPlayer');
  const offline = document.getElementById('playerOffline');
  const hlsUrl = `${location.origin}/media/live/${STREAM_KEY}/index.m3u8`;

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    if (hlsPlayer) hlsPlayer.destroy();
    nativeHlsActive = false;
    hlsPlayer = new Hls({
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      liveBackBufferLength: 0,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      maxBufferHole: 0.5,
      enableWorker: true,
      startFragPrefetch: true,
      lowLatencyMode: false,
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 10000,
      levelLoadingTimeOut: 10000,
    });
    hlsPlayer.loadSource(hlsUrl);
    hlsPlayer.attachMedia(video);

    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      clearTimeout(streamRetryTimer);
      streamRetryDelay = STREAM_RETRY_MIN;
      tryPlay(video);
      showLive(video, offline);
    });

    hlsPlayer.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrorRecoveryCount < MAX_MEDIA_ERROR_RECOVERIES) {
          mediaErrorRecoveryCount++;
          console.warn(`[hls] recovering from MEDIA_ERROR (attempt ${mediaErrorRecoveryCount})`);
          hlsPlayer.recoverMediaError();
          return;
        }
        showOffline(video, offline);
        hlsPlayer.destroy();
        hlsPlayer = null;
        mediaErrorRecoveryCount = 0;
        scheduleStreamRetry();
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS path (Safari). Guard against repeated initPlayer() calls
    // stacking handlers while a native session is already active.
    if (nativeHlsActive) return;
    nativeHlsActive = true;

    video.src = hlsUrl;

    function onLoaded() {
      tryPlay(video);
      showLive(video, offline);
      // Seek to live edge so the viewer isn't stuck on a stale frame
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = video.duration;
      }
    }

    function onError() {
      showOffline(video, offline);
      nativeHlsActive = false;
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    }

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });

    // Periodically seek to live edge to prevent freeze/drift
    const liveEdgeInterval = setInterval(() => {
      if (!nativeHlsActive) { clearInterval(liveEdgeInterval); return; }
      if (video.duration && isFinite(video.duration) && !video.paused) {
        const behindLive = video.duration - video.currentTime;
        if (behindLive > 5) video.currentTime = video.duration;
      }
    }, 4000);
  }
}

// Retry connecting to stream with exponential backoff (8s → 16s → 32s → 60s cap).
// Pauses when the tab is hidden to avoid background CPU/network churn.
const STREAM_RETRY_MIN = 8000;
const STREAM_RETRY_MAX = 60000;
let streamRetryDelay = STREAM_RETRY_MIN;
let streamRetryTimer = null;

function scheduleStreamRetry() {
  clearTimeout(streamRetryTimer);
  if (document.hidden) return; // will resume on visibilitychange
  streamRetryTimer = setTimeout(attemptStreamRetry, streamRetryDelay);
  streamRetryDelay = Math.min(streamRetryDelay * 2, STREAM_RETRY_MAX);
}

function attemptStreamRetry() {
  if (hlsPlayer || nativeHlsActive) return;
  const offline = document.getElementById('playerOffline');
  const offlineText = document.getElementById('offlineText');
  if (!offline || !offlineText) return;

  offline.classList.add('checking');
  const originalText = 'Signal offline';
  offlineText.textContent = 'Reconnecting\u2026';
  setTimeout(() => {
    offline.classList.remove('checking');
    if (offlineText.textContent === 'Reconnecting\u2026') {
      offlineText.textContent = originalText;
    }
  }, 1600);

  initPlayer();
  // If initPlayer didn't connect (hlsPlayer still null), schedule next retry
  // The HLS error handler also calls scheduleStreamRetry on fatal errors
  if (!hlsPlayer && !nativeHlsActive) {
    scheduleStreamRetry();
  }
}

// Pause retries when tab is hidden, resume immediately when visible
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(streamRetryTimer);
  } else if (!hlsPlayer && !nativeHlsActive) {
    streamRetryDelay = STREAM_RETRY_MIN; // reset backoff on user return
    attemptStreamRetry();
  }
});

// Start the first retry cycle
scheduleStreamRetry();

// --- Player Controls ---

document.getElementById('playPauseBtn').addEventListener('click', () => {
  const video = document.getElementById('videoPlayer');
  if (video.paused) { video.play(); } else { video.pause(); }
});

document.getElementById('muteBtn').addEventListener('click', () => {
  const video = document.getElementById('videoPlayer');
  video.muted = !video.muted;
  document.getElementById('muteBtn').textContent = video.muted ? '\u{1F507}' : '\u{1F50A}';
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
  const video = document.getElementById('videoPlayer');
  video.volume = e.target.value / 100;
  video.muted = false;
  document.getElementById('muteBtn').textContent = video.volume === 0 ? '\u{1F507}' : '\u{1F50A}';
});

document.getElementById('theaterBtn').addEventListener('click', () => {
  isTheater = !isTheater;
  document.getElementById('watchLayout').classList.toggle('theater', isTheater);
});

document.getElementById('fullscreenBtn').addEventListener('click', () => {
  const wrap = document.getElementById('playerWrap');
  const video = document.getElementById('videoPlayer');

  const fsElement = document.fullscreenElement
    || document.webkitFullscreenElement;

  if (fsElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } else if (wrap.requestFullscreen) {
    wrap.requestFullscreen().catch(() => {});
  } else if (wrap.webkitRequestFullscreen) {
    wrap.webkitRequestFullscreen();
  } else if (video.webkitEnterFullscreen) {
    // iOS Safari — only supports fullscreen on the <video> element itself
    video.webkitEnterFullscreen();
  }
});

// --- Touch Controls (mobile) ---
// Toggle control visibility on tap since :hover doesn't work on touch devices.
(function setupTouchControls() {
  const wrap = document.getElementById('playerWrap');
  const controls = document.getElementById('playerControls');
  let hideTimer = null;

  function showControls() {
    controls.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { controls.style.opacity = ''; }, 3000);
  }

  wrap.addEventListener('touchstart', (e) => {
    // Don't toggle when tapping on controls themselves
    if (controls.contains(e.target)) return;
    if (controls.style.opacity === '1') {
      controls.style.opacity = '';
      clearTimeout(hideTimer);
    } else {
      showControls();
    }
  }, { passive: true });

  // Keep controls visible while interacting with them
  controls.addEventListener('touchstart', () => {
    clearTimeout(hideTimer);
    controls.style.opacity = '1';
    hideTimer = setTimeout(() => { controls.style.opacity = ''; }, 3000);
  }, { passive: true });
})();

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

async function fetchChatHistory() {
  try {
    const resp = await fetch(`/api/v1/streams/${STREAM_KEY}/chat?limit=200`);
    if (!resp.ok) return;
    const json = await resp.json();
    const messages = json.data;
    if (!Array.isArray(messages)) return;

    for (const m of messages) {
      // Skip messages we already rendered (reconnect dedup)
      if (m.timestamp <= lastChatTimestamp) continue;
      addChatMessage({ type: 'chat', username: m.username, message: m.message });
      if (m.timestamp > lastChatTimestamp) lastChatTimestamp = m.timestamp;
    }

    // Scroll to bottom after loading history
    const container = document.getElementById('chatMessages');
    if (container) container.scrollTop = container.scrollHeight;
  } catch {
    // Fetch failed — skip silently, don't block chat
  }
}

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
        const isReconnect = !!wsReconnectTimer;
        if (isReconnect) wsReconnectTimer = null;

        // Fetch persisted chat history, then show the connection notice
        fetchChatHistory().then(() => {
          addChatMessage({
            type: 'system',
            message: isReconnect ? 'Chat reconnected' : 'Connected to chat',
          });
        });
        return;
      }
      if (msg.type === 'chat' || msg.type === 'tip' || msg.type === 'system') {
        addChatMessage(msg);
        if (msg.timestamp && msg.timestamp > lastChatTimestamp) {
          lastChatTimestamp = msg.timestamp;
        }
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

// --- Diagnostic Overlay (toggle with 'D' key) ---

let diagVisible = false;
let diagInterval = null;

document.addEventListener('keydown', (e) => {
  if (e.key === 'D' || e.key === 'd') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    diagVisible = !diagVisible;
    const el = document.getElementById('diagOverlay');
    if (!el) return;
    el.style.display = diagVisible ? 'block' : 'none';
    if (diagVisible && !diagInterval) {
      diagInterval = setInterval(updateDiag, 1000);
      updateDiag();
    } else if (!diagVisible && diagInterval) {
      clearInterval(diagInterval);
      diagInterval = null;
    }
  }
});

function updateDiag() {
  const el = document.getElementById('diagOverlay');
  if (!el || !diagVisible) return;
  const video = document.getElementById('videoPlayer');
  const lines = [];

  if (hlsPlayer) {
    const buffered = video.buffered;
    let bufLen = 0;
    if (buffered.length > 0) {
      bufLen = (buffered.end(buffered.length - 1) - video.currentTime).toFixed(1);
    }
    lines.push(`Buffer: ${bufLen}s`);
    lines.push(`BW est: ${hlsPlayer.bandwidthEstimate ? (hlsPlayer.bandwidthEstimate / 1000).toFixed(0) + ' kbps' : 'n/a'}`);
    const level = hlsPlayer.currentLevel >= 0 ? hlsPlayer.levels[hlsPlayer.currentLevel] : null;
    if (level) {
      lines.push(`Level: ${level.width}x${level.height}`);
    }
    lines.push(`Latency: ${hlsPlayer.latency ? hlsPlayer.latency.toFixed(1) + 's' : 'n/a'}`);
  }

  if (video.getVideoPlaybackQuality) {
    const q = video.getVideoPlaybackQuality();
    lines.push(`Dropped: ${q.droppedVideoFrames}/${q.totalVideoFrames}`);
  }

  el.textContent = lines.join('\n');
}

// --- Init ---

loadStreamerInfo();
connectWS();
