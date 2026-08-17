import { mountInputApp } from './input.js';

function readSeedConfig() {
  const el = document.getElementById('month-config');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/month-config');
    if (res.ok) {
      const data = await res.json();
      if (data.monthConfig && data.monthConfig.year && data.monthConfig.month) {
        return data.monthConfig;
      }
    }
  } catch {
    // オフライン時は HTML 埋め込み設定を使う
  }
  return readSeedConfig();
}

async function init() {
  const config = await loadConfig();
  const app = document.getElementById('app');
  if (!config) {
    app.innerHTML = '<p class="note">月シフトが読み込めません。管理画面で設定を保存してください。</p>';
    return;
  }
  mountInputApp(app, config);
}

init();
