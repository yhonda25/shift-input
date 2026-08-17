import { loadState, saveState } from './storage.js';
import { renderMonthSpec } from './month-spec.js';

let info = { role: 'admin', adminPort: 8080, inputPort: 8081 };
let state = loadState();

function persist() {
  saveState(state);
}

function inputUrl() {
  return `${location.protocol}//${location.hostname}:${info.inputPort}/`;
}

function renderPortLinks() {
  const el = document.getElementById('port-links');
  if (!el) return;
  const url = inputUrl();
  el.innerHTML = `入力画面（別ポート）: <a href="${url}" target="shift-input" rel="noopener">${url}</a>`;
}

async function saveMonthConfigToServer() {
  const res = await fetch('/api/month-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthConfig: state.monthConfig }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'サーバーへの保存に失敗しました');
  }
  return data;
}

function renderPanel() {
  const panel = document.getElementById('tab-panel');
  renderMonthSpec(panel, state, {
    onChange: persist,
    inputUrl: inputUrl(),
    saveToServer: saveMonthConfigToServer,
    onApplyToInput: async () => {
      persist();
      await saveMonthConfigToServer();
      const url = inputUrl();
      window.open(url, 'shift-input');
      return url;
    },
  });
}

async function hydrateFromServer() {
  try {
    const res = await fetch('/api/month-config');
    if (!res.ok) return;
    const data = await res.json();
    if (data.monthConfig && data.monthConfig.year && data.monthConfig.month) {
      state.monthConfig = data.monthConfig;
      persist();
    }
  } catch {
    // オフライン時は localStorage を使う
  }
}

async function loadInfo() {
  try {
    const res = await fetch('/api/info');
    if (res.ok) info = await res.json();
  } catch {
    // デフォルトの 8080 / 8081 を使う
  }
}

async function renderSubmissions() {
  const panel = document.getElementById('submissions-panel');
  if (!panel) return;
  try {
    const res = await fetch('/api/submissions');
    const data = await res.json().catch(() => ({}));
    const files = data.files || [];
    if (!res.ok) {
      panel.innerHTML = `<div class="panel-header"><h2>送信結果</h2><p class="hint">data/submissions の読み込みに失敗しました。</p></div>`;
      return;
    }
    const rows = files.length
      ? `<ul class="submission-list">${files.map((f) => {
          const period = f.year && f.month ? `${f.year}年${f.month}月` : '';
          const when = f.submittedAt || f.savedAt || '';
          return `<li class="submission-card"><div class="submission-name">${escapeHtml(f.name || f.filename)}</div><div class="submission-meta">${escapeHtml([period, when, f.path].filter(Boolean).join(' ／ '))}</div></li>`;
        }).join('')}</ul>`
      : '<p class="hint">まだ送信結果はありません。入力画面から希望を送信すると、data/submissions に JSON が保存されます。同一名・同一月は最新版で上書きされます。</p>';
    panel.innerHTML = `
      <div class="panel-header">
        <h2>送信結果（JSON）</h2>
        <p class="hint">保存先: data/submissions（同一名・同一月は最新版を上書き）</p>
      </div>
      ${rows}
    `;
  } catch {
    panel.innerHTML = `<div class="panel-header"><h2>送信結果</h2><p class="hint">python3 serve.py 起動中は、送信 JSON が data/submissions に保存されます。</p></div>`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function init() {
  await loadInfo();
  await hydrateFromServer();
  renderPortLinks();
  renderPanel();
  await renderSubmissions();
}

init();
