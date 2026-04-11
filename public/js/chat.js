// Screams — Chat System

const EMOJIS = [
  '😀','😂','🤣','😍','🥰','😎','🤩','🥳','😭','😱',
  '🔥','❤️','💯','👏','🙌','💪','🎉','🎊','✨','⭐',
  '👀','💀','🤡','👑','💎','🚀','🐟','🎣','🌊','🦈',
  '💰','💵','💸','🎁','🏆','⚡','💜','💙','💚','💛',
];

function getOrCreateUsername() {
  let name = localStorage.getItem('lump_username');
  if (!name) {
    const num = Math.floor(Math.random() * 9000) + 1000;
    name = `Viewer_${num}`;
    localStorage.setItem('lump_username', name);
  }
  return name;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Emoji Picker ---

function initEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  const toggle = document.getElementById('emojiToggle');

  EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const input = document.getElementById('chatInput');
      input.value += emoji;
      input.focus();
    });
    picker.appendChild(btn);
  });

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    picker.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== toggle) {
      picker.classList.add('hidden');
    }
  });
}

// --- Chat Message Rendering ---

function addChatMessage(msg) {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');

  if (msg.type === 'chat') {
    el.className = 'chat-msg';
    el.innerHTML = `<span class="chat-user">${escapeHtml(msg.username)}</span><span class="chat-text">${escapeHtml(msg.message)}</span>`;
  } else if (msg.type === 'tip') {
    el.className = 'chat-msg chat-tip-msg';
    el.innerHTML = `<span class="chat-tip-badge">${msg.amount} tNIGHT</span> <span class="chat-user">${escapeHtml(msg.username)}</span>${msg.message ? `<span class="chat-text">${escapeHtml(msg.message)}</span>` : ''}`;
  } else if (msg.type === 'system') {
    el.className = 'chat-msg chat-system-msg';
    el.innerHTML = `<span class="chat-system-text">${escapeHtml(msg.message)}</span>`;
  } else {
    return;
  }

  container.appendChild(el);

  while (container.children.length > 200) {
    container.removeChild(container.firstChild);
  }

  container.scrollTop = container.scrollHeight;
}

function updateViewerCounts(count) {
  const el1 = document.getElementById('viewerCount');
  const el2 = document.getElementById('chatViewerCount');
  if (el1) el1.textContent = formatCount(count);
  if (el2) el2.textContent = formatCount(count);
}

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

initEmojiPicker();
