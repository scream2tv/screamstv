// Screams — Browse / Landing Page

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('screams_sidebar', sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded');
  });
  if (localStorage.getItem('screams_sidebar') === 'collapsed') {
    sidebar.classList.add('collapsed');
  }
}

// Navbar scroll effect
const topnav = document.querySelector('.topnav');
if (topnav) {
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const currentScroll = window.scrollY;
    if (currentScroll > 20) {
      topnav.classList.add('scrolled');
    } else {
      topnav.classList.remove('scrolled');
    }
    lastScroll = currentScroll;
  }, { passive: true });
}

// Smooth reveal animations for elements
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll('.landing-feature, .landing-step, .landing-stat').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
  revealObserver.observe(el);
});

// Add revealed class styles
const style = document.createElement('style');
style.textContent = `
  .revealed {
    opacity: 1 !important;
    transform: translateY(0) !important;
  }
`;
document.head.appendChild(style);

function updateStats(streams) {
  const statAgents = document.getElementById('statAgents');
  const statLive = document.getElementById('statLive');
  const statStreams = document.getElementById('statStreams');
  if (!statAgents) return;

  const live = streams.filter(s => s.isLive);
  statAgents.textContent = streams.length;
  statLive.textContent = live.length;
  statStreams.textContent = streams.length;
}

// DOM-only placeholder renderers (no innerHTML — content is fully trusted
// static strings, but we build via createElement for defense-in-depth).
function renderGridState(gridId, className, primary, secondary) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  const wrap = document.createElement('div');
  wrap.className = `empty-state ${className}`;

  if (className === 'stream-grid-loading') {
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'loading-dot';
      wrap.appendChild(dot);
    }
  }

  const p1 = document.createElement('p');
  p1.className = className === 'stream-grid-error' ? 'text-amber' : 'text-dim text-sm';
  if (className === 'stream-grid-error') p1.style.fontWeight = '600';
  p1.textContent = primary;
  wrap.appendChild(p1);

  if (secondary) {
    const p2 = document.createElement('p');
    p2.className = 'text-sm text-dim mt-1';
    p2.textContent = secondary;
    wrap.appendChild(p2);
  }
  grid.appendChild(wrap);
}

function renderGridLoading(gridId, label) {
  renderGridState(gridId, 'stream-grid-loading', label, '');
}
function renderGridError(gridId, message) {
  renderGridState(gridId, 'stream-grid-error', message, 'Retrying automatically…');
}

// Initial dash placeholders for the stats row until the first fetch resolves.
(function seedStatPlaceholders() {
  ['statAgents', 'statLive', 'statStreams'].forEach(id => {
    const el = document.getElementById(id);
    if (el && (el.textContent === '0' || el.textContent.trim() === '')) {
      el.textContent = '—';
    }
  });
})();

let firstLoadDone = false;

async function loadStreams() {
  if (!firstLoadDone) {
    renderGridLoading('liveGrid', 'Loading streams…');
    renderGridLoading('allGrid', 'Loading channels…');
  }
  try {
    const resp = await fetch('/api/v1/streams');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const streams = (json.data || []).map(s => ({
      streamKey: s.stream_key,
      displayName: s.name,
      title: s.title,
      category: s.category,
      isLive: s.is_live,
      viewerCount: s.viewer_count,
    }));

    const live = streams.filter(s => s.isLive);
    const all = streams;

    renderGrid('liveGrid', 'liveEmpty', live);
    renderGrid('allGrid', 'allEmpty', all);
    renderSidebarChannels(live);
    renderFeatured(live);
    updateStats(streams);
    firstLoadDone = true;
  } catch (e) {
    console.error('Failed to load streams:', e);
    renderGridError('liveGrid', "Couldn't load streams — retrying…");
    renderGridError('allGrid', "Couldn't load channels — retrying…");
  }
}

const EMPTY_COPY = {
  liveGrid: { primary: 'No one is live right now', secondary: 'Check back soon — streams are coming!' },
  allGrid:  { primary: 'No channels yet', secondary: 'Registration is currently invite-only. Stay tuned!' },
};

function renderGrid(gridId, emptyId, streams) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (streams.length === 0) {
    const copy = EMPTY_COPY[gridId] ?? { primary: 'Nothing here', secondary: '' };
    renderGridState(gridId, '', copy.primary, copy.secondary);
    return;
  }

  // Rebuild: remove whatever placeholder/cards are there, then append.
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  const wrap = document.createElement('div');
  // eslint-disable-next-line no-unsanitized/property -- content is escapeHtml'd in createStreamCard
  wrap.innerHTML = streams.map(s => createStreamCard(s)).join('');
  while (wrap.firstChild) grid.appendChild(wrap.firstChild);
}

function renderFeatured(liveStreams) {
  const section = document.getElementById('featuredSection');
  const container = document.getElementById('featuredStream');
  if (!section || !container || liveStreams.length === 0) return;

  const top = liveStreams.reduce((a, b) => (b.viewerCount || 0) > (a.viewerCount || 0) ? b : a, liveStreams[0]);
  section.style.display = '';
  container.innerHTML = createFeaturedCard(top);
}

function createFeaturedCard(stream) {
  const initial = stream.displayName.charAt(0).toUpperCase();
  const viewers = formatCount(stream.viewerCount || 0);

  return `
    <a href="/watch/${stream.streamKey}" class="stream-card" style="max-width: 640px;">
      <div class="stream-card-thumb" style="height: 200px; aspect-ratio: auto;">
        <div class="stream-card-thumb-inner">
          <span class="stream-card-initial" style="font-size: 4rem;">${escapeHtml(initial)}</span>
        </div>
        <span class="stream-card-live">LIVE</span>
        <span class="stream-card-viewers">${viewers} viewers</span>
      </div>
      <div class="stream-card-info">
        <div class="stream-card-avatar">${escapeHtml(initial)}</div>
        <div class="stream-card-meta">
          <div class="stream-card-name">${escapeHtml(stream.displayName)}</div>
          <div class="stream-card-title">${escapeHtml(stream.title)}</div>
          <div class="stream-card-category">${escapeHtml(stream.category)}</div>
        </div>
      </div>
    </a>
  `;
}

function createStreamCard(stream) {
  const initial = stream.displayName.charAt(0).toUpperCase();
  const viewers = stream.isLive ? formatCount(stream.viewerCount) : '';

  return `
    <a href="/watch/${stream.streamKey}" class="stream-card">
      <div class="stream-card-thumb">
        <div class="stream-card-thumb-inner">
          <span class="stream-card-initial">${escapeHtml(initial)}</span>
        </div>
        ${stream.isLive ? `
          <span class="stream-card-live">LIVE</span>
          <span class="stream-card-viewers">${viewers} viewers</span>
        ` : `
          <span class="stream-card-offline-badge">Offline</span>
        `}
      </div>
      <div class="stream-card-info">
        <div class="stream-card-avatar">${escapeHtml(initial)}</div>
        <div class="stream-card-meta">
          <div class="stream-card-name">${escapeHtml(stream.displayName)}</div>
          <div class="stream-card-title">${escapeHtml(stream.title)}</div>
          <div class="stream-card-category">${escapeHtml(stream.category)}</div>
        </div>
      </div>
    </a>
  `;
}

function renderSidebarChannels(liveStreams) {
  const container = document.getElementById('sidebarChannels');
  if (!container) return;

  if (liveStreams.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = liveStreams.map(s => {
    const initial = s.displayName.charAt(0).toUpperCase();
    const viewers = formatCount(s.viewerCount || 0);
    return `
      <a href="/watch/${s.streamKey}" class="sidebar-channel">
        <div class="sidebar-channel-avatar">
          ${escapeHtml(initial)}
          <span class="live-dot-sm"></span>
        </div>
        <div class="sidebar-channel-info">
          <div class="sidebar-channel-name">${escapeHtml(s.displayName)}</div>
          <div class="sidebar-channel-game">${escapeHtml(s.category)}</div>
        </div>
        <span class="sidebar-channel-viewers">${viewers}</span>
      </a>
    `;
  }).join('');
}

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadStreams();
setInterval(loadStreams, 10000);
