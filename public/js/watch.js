// Screams — Watch Page

const pathParts = location.pathname.split('/');
const STREAM_KEY = pathParts[pathParts.length - 1];
const USERNAME = getOrCreateUsername();

document.getElementById('navUsername').textContent = USERNAME;

let ws = null;
let hlsPlayer = null;
let isTheater = false;
let isFollowing = false;

// --- Load Streamer Info ---

async function loadStreamerInfo() {
  try {
    const resp = await fetch(`/api/v1/streams/${STREAM_KEY}`);
    const json = await resp.json();
    if (!resp.ok) {
      document.getElementById('offlineText').textContent = 'Channel not found';
      return;
    }
    const data = json.data;

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

// Retry connecting to stream periodically
setInterval(() => {
  if (!hlsPlayer) initPlayer();
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

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?stream=${encodeURIComponent(STREAM_KEY)}&username=${encodeURIComponent(USERNAME)}&role=viewer`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    addChatMessage({ type: 'system', message: 'Connected to chat' });
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'chat' || msg.type === 'tip' || msg.type === 'system') {
        addChatMessage(msg);
      }
      if (msg.type === 'viewer_count') {
        updateViewerCounts(msg.count);
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener('error', () => {
    ws.close();
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

// --- Midnight Wallet Detection ---

const MIDNIGHT_NETWORK = 'preprod';
const NATIVE_TOKEN = '0000000000000000000000000000000000000000000000000000000000000000';

let streamerShieldedAddress = null;
let detectedWallets = [];

const KNOWN_WALLETS = [
  { id: 'mnLace', name: 'Lace', icon: null },
  { id: '1am',   name: '1AM',  icon: null },
];

function detectWallets() {
  return new Promise((resolve) => {
    const found = [];
    let attempts = 0;

    function check() {
      if (!window.midnight) {
        if (++attempts < 30) { setTimeout(check, 100); return; }
        resolve(found);
        return;
      }

      for (const w of KNOWN_WALLETS) {
        const api = window.midnight[w.id];
        if (api && !found.some(f => f.id === w.id)) {
          found.push({ id: w.id, name: api.name || w.name, api });
        }
      }

      // Also pick up any unknown wallets injected under window.midnight
      for (const [key, api] of Object.entries(window.midnight)) {
        if (api && typeof api.connect === 'function' && !found.some(f => f.id === key)) {
          found.push({ id: key, name: api.name || key, api });
        }
      }

      if (found.length === 0 && ++attempts < 30) {
        setTimeout(check, 100);
        return;
      }

      resolve(found);
    }

    check();
  });
}

// --- Tip Modal ---

function showTipStep(step) {
  document.getElementById('tipStepAmount').classList.toggle('hidden', step !== 'amount');
  document.getElementById('tipStepSending').classList.toggle('hidden', step !== 'sending');
}

function renderWalletButtons() {
  const container = document.getElementById('tipWalletButtons');
  container.innerHTML = '';

  if (detectedWallets.length === 0) {
    document.getElementById('tipNoWallet').classList.remove('hidden');
    return;
  }

  document.getElementById('tipNoWallet').classList.add('hidden');

  for (const wallet of detectedWallets) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-amber btn-full';
    if (detectedWallets.length > 1) btn.style.marginBottom = '8px';
    btn.textContent = detectedWallets.length === 1
      ? 'Connect Wallet & Send'
      : `Send with ${wallet.name}`;
    btn.addEventListener('click', () => sendTipWithWallet(wallet));
    container.appendChild(btn);
  }
}

function openTipModal() {
  document.getElementById('tipModal').classList.remove('hidden');
  document.getElementById('tipAmountInput').value = '';
  document.getElementById('tipMessageInput').value = '';
  document.getElementById('tipResult').textContent = '';
  document.getElementById('tipNoWallet').classList.add('hidden');
  document.querySelectorAll('.tip-preset').forEach(b => b.classList.remove('active'));

  renderWalletButtons();
  showTipStep('amount');
}

function closeTipModal() {
  document.getElementById('tipModal').classList.add('hidden');
  showTipStep('amount');
}

document.getElementById('tipBtnBar').addEventListener('click', openTipModal);
document.getElementById('tipBtnChat').addEventListener('click', openTipModal);
document.getElementById('tipModalClose').addEventListener('click', closeTipModal);
document.getElementById('tipModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('tipModal')) closeTipModal();
});

document.querySelectorAll('.tip-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tip-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tipAmountInput').value = btn.dataset.amount;
  });
});

async function sendTipWithWallet(wallet) {
  const amount = parseFloat(document.getElementById('tipAmountInput').value);
  const message = document.getElementById('tipMessageInput').value.trim();
  const resultEl = document.getElementById('tipResult');

  if (!amount || amount <= 0) {
    resultEl.textContent = 'Enter an amount';
    resultEl.style.color = 'var(--red)';
    return;
  }

  if (!streamerShieldedAddress) {
    resultEl.textContent = 'Streamer address not loaded yet';
    resultEl.style.color = 'var(--red)';
    return;
  }

  resultEl.textContent = '';
  showTipStep('sending');
  document.getElementById('tipSendingText').textContent = `Connecting to ${wallet.name}…`;
  document.getElementById('tipSendingSub').textContent = 'Approve the connection in the wallet popup';

  try {
    const connectedApi = await wallet.api.connect(MIDNIGHT_NETWORK);

    document.getElementById('tipSendingText').textContent = 'Building transaction…';
    document.getElementById('tipSendingSub').textContent = 'Approve the transfer in your wallet';

    const amountStars = BigInt(Math.floor(amount * 1_000_000));

    const result = await connectedApi.makeTransfer([{
      kind: 'shielded',
      tokenType: NATIVE_TOKEN,
      value: amountStars,
      recipient: streamerShieldedAddress,
    }]);

    document.getElementById('tipSendingText').textContent = 'Submitting to network…';
    document.getElementById('tipSendingSub').textContent = 'Almost done';

    await connectedApi.submitTransaction(result.tx);

    try {
      const apiKey = localStorage.getItem('screams_api_key');
      if (apiKey) {
        await fetch(`/api/v1/streams/${STREAM_KEY}/tip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ amount: String(amount), message }),
        });
      } else {
        await fetch('/api/tip/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamKey: STREAM_KEY, amount: String(amount), message, username: USERNAME }),
        });
      }
    } catch {}

    showTipStep('amount');
    resultEl.textContent = 'Tip sent!';
    resultEl.style.color = 'var(--green)';
    setTimeout(closeTipModal, 2500);
  } catch (e) {
    console.error('Tip error:', e);
    showTipStep('amount');
    const msg = e?.message || String(e);
    if (msg.includes('User rejected') || msg.includes('denied') || msg.includes('cancel')) {
      resultEl.textContent = 'Transaction cancelled';
    } else {
      resultEl.textContent = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
    }
    resultEl.style.color = 'var(--red)';
  }
}

// --- Init ---

loadStreamerInfo();
connectWS();
detectWallets().then(wallets => { detectedWallets = wallets; });
