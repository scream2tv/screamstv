// Screams — Viewer Tip Page

const form = document.getElementById('tipForm');
const submitBtn = document.getElementById('submitBtn');
const resultBox = document.getElementById('result');
const generateBtn = document.getElementById('generateSeed');

generateBtn.addEventListener('click', () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  document.getElementById('viewerSeed').value = hex;
  document.getElementById('viewerSeed').type = 'text';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const streamerAddress = document.getElementById('streamerAddress').value.trim();
  const amount = document.getElementById('tipAmount').value;
  const message = document.getElementById('tipMessage').value.trim();
  const viewerSeed = document.getElementById('viewerSeed').value.trim();

  if (!/^[0-9a-fA-F]{64}$/.test(viewerSeed)) {
    showResult('error', 'Wallet seed must be a 64-character hex string.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Submitting shielded transfer…';
  hideResult();

  try {
    const resp = await fetch('/api/tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewerSeed, streamerAddress, amount: Number(amount), message }),
    });

    const data = await resp.json();

    if (data.success) {
      let html = `<strong style="color: var(--green);">Tip sent!</strong>`;
      html += `<br><span class="text-dim">Amount:</span> <span class="amount">${amount} <span class="currency">$NIGHT</span></span>`;
      if (data.txHash) {
        html += `<br><span class="text-dim">Tx:</span> <span class="mono text-sm">${data.txHash.slice(0, 16)}…</span>`;
      }
      if (data.explorerUrl) {
        html += `<br><a href="${data.explorerUrl}" target="_blank" rel="noopener">View on Explorer &rarr;</a>`;
      }
      showResult('success', html);
    } else {
      showResult('error', `Transfer failed: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    showResult('error', `Network error: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Shielded Tip';
  }
});

function showResult(type, html) {
  resultBox.className = `result-box visible ${type}`;
  resultBox.innerHTML = html;
}

function hideResult() {
  resultBox.className = 'result-box';
  resultBox.innerHTML = '';
}
