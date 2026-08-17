import {
  formatDateKey,
  getDaysInMonth,
  getWeekday,
  WEEKDAYS,
  slotKey,
  downloadFile,
  isValidPreferredRange,
  mergeContiguousSlots,
  getOverlappingSlotKeys,
  buildTimeSteps,
  timeToMinutes,
  minutesToTime,
  snapToHalfHour,
} from './utils.js';

/** @type {{year:number, month:number, days: Record<string, Array<{start:string,end:string,required:number}>>}} */
let monthConfig;
/** @type {HTMLElement} */
let app;

let userName = '';
/** @type {Record<string, Array<{id: string, windowKey: string, start: string, end: string}>>} */
let requests = {};
let step = 'name';
let selectedDateKey = null;

export function mountInputApp(container, config) {
  app = container;
  monthConfig = config;
  userName = '';
  requests = {};
  step = 'name';
  selectedDateKey = null;
  render();
}

function render() {
  if (step === 'name') renderNameStep();
  else renderInputStep();
}

function renderNameStep() {
  const { year, month } = monthConfig;
  const hasSlots = findFirstAvailableDay() !== null;
  app.innerHTML = `
    <div class="input-container">
      <header class="input-header">
        <h1>シフト希望入力</h1>
        <p class="period">${year}年${month}月</p>
      </header>
      <div class="name-form card">
        <label for="user-name">お名前を入力してください</label>
        <input type="text" id="user-name" placeholder="例：山田 花子" maxlength="50" autocomplete="name" autofocus />
        <button type="button" class="btn btn-primary" id="btn-start">シフト入力を開始</button>
      </div>
      ${hasSlots
        ? '<p class="note">※ 日付を選び、表示された時間帯の中からご自身の希望時間を指定してください</p>'
        : '<p class="note">この月のシフト枠がまだ設定されていません。管理画面（月シフト指定）で時間帯を設定してください。</p>'}
    </div>
  `;
  const input = document.getElementById('user-name');
  const start = () => {
    const name = input.value.trim();
    if (!name) { alert('お名前を入力してください'); return; }
    userName = name;
    step = 'calendar';
    selectedDateKey = findFirstAvailableDay();
    render();
  };
  document.getElementById('btn-start').addEventListener('click', start);

  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (composing || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    start();
  });
}

function findFirstAvailableDay() {
  const { year, month } = monthConfig;
  const days = getDaysInMonth(year, month);
  for (let d = 1; d <= days; d++) {
    const dk = formatDateKey(year, month, d);
    if ((monthConfig.days[dk] || []).length > 0) return dk;
  }
  return null;
}

function getWindowsForDay(dateKey) {
  return mergeContiguousSlots(monthConfig.days[dateKey] || []);
}

function getRangesForWindow(dateKey, windowKey) {
  return (requests[dateKey] || []).filter((r) => r.windowKey === windowKey);
}

function newRangeId() {
  return `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

/** 日付選択時、未設定のウィンドウには最大時間帯をデフォルトで入れる */
function ensureDefaultRangesForDay(dateKey) {
  const windows = getWindowsForDay(dateKey);
  if (windows.length === 0) return;
  if (!requests[dateKey]) requests[dateKey] = [];

  for (const window of windows) {
    if (getRangesForWindow(dateKey, window.key).length === 0) {
      requests[dateKey].push({
        id: newRangeId(),
        windowKey: window.key,
        start: window.start,
        end: window.end,
      });
    }
  }
}

function buildHourLabels(windowStart, windowEnd) {
  const winStart = timeToMinutes(windowStart);
  const winEnd = timeToMinutes(windowEnd);
  const labels = [];
  for (let m = 0; m < 24 * 60; m += 60) {
    if (m >= winStart && m <= winEnd) {
      labels.push({ minutes: m, label: `${Math.floor(m / 60)}時` });
    }
  }
  return labels;
}

function renderTimeBar(window, range, rangeId) {
  const steps = buildTimeSteps(window.start, window.end);
  const winStart = timeToMinutes(window.start);
  const winEnd = timeToMinutes(window.end);
  const total = winEnd - winStart || 1;

  let startIdx = steps.findIndex((t) => timeToMinutes(t) >= timeToMinutes(range.start));
  let endIdx = steps.findIndex((t) => timeToMinutes(t) >= timeToMinutes(range.end));
  if (startIdx < 0) startIdx = 0;
  if (endIdx < 0) endIdx = steps.length - 1;

  const selLeft = ((timeToMinutes(steps[startIdx]) - winStart) / total) * 100;
  const selWidth = ((timeToMinutes(steps[endIdx]) - winStart) / total) * 100 - selLeft;

  const ticks = buildHourLabels(window.start, window.end)
    .map(({ minutes, label }) => {
      const left = ((minutes - winStart) / total) * 100;
      return `<span class="time-tick" style="left:${left}%">${label}</span>`;
    })
    .join('');

  return `
    <div class="time-bar-wrap" data-range-id="${rangeId}">
      <div class="time-bar-labels">${ticks}</div>
      <div class="time-bar">
        <div class="time-bar-selection" style="left:${selLeft}%;width:${Math.max(selWidth, 2)}%"></div>
      </div>
      <div class="time-bar-controls">
        <label>開始
          <input type="range" class="bar-start" min="0" max="${steps.length - 1}" value="${startIdx}" data-steps='${JSON.stringify(steps)}' />
          <span class="bar-start-label">${range.start}</span>
        </label>
        <label>終了
          <input type="range" class="bar-end" min="0" max="${steps.length - 1}" value="${endIdx}" data-steps='${JSON.stringify(steps)}' />
          <span class="bar-end-label">${range.end}</span>
        </label>
      </div>
    </div>`;
}

function renderInputStep() {
  const { year, month } = monthConfig;
  const days = getDaysInMonth(year, month);
  const firstWd = getWeekday(year, month, 1);

  let calHtml = '<div class="cal-header">';
  for (const wd of WEEKDAYS) calHtml += `<div class="cal-wd">${wd}</div>`;
  calHtml += '</div><div class="cal-grid">';
  for (let i = 0; i < firstWd; i++) calHtml += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= days; d++) {
    const dk = formatDateKey(year, month, d);
    const wd = getWeekday(year, month, d);
    const hasSlots = (monthConfig.days[dk] || []).length > 0;
    const selectedCount = (requests[dk] || []).length;
    let statusHtml = !hasSlots
      ? '<span class="day-status none">募集なし</span>'
      : selectedCount > 0
        ? `<span class="day-status picked">${selectedCount}件選択</span>`
        : '<span class="day-status open">選択可</span>';

    const classes = ['cal-cell', wd === 0 ? 'sun' : '', wd === 6 ? 'sat' : '', hasSlots ? 'has-slots' : 'no-slots', dk === selectedDateKey ? 'active' : ''].filter(Boolean).join(' ');
    calHtml += `<button type="button" class="${classes}" data-date="${dk}" ${hasSlots ? '' : 'disabled'}><div class="cal-day-num">${d}</div>${statusHtml}</button>`;
  }
  calHtml += '</div>';

  if (selectedDateKey) ensureDefaultRangesForDay(selectedDateKey);

  app.innerHTML = `
    <div class="input-container">
      <header class="input-header">
        <h1>シフト希望入力</h1>
        <p class="period">${year}年${month}月 ／ ${escapeHtml(userName)} さん</p>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-back">名前を変更</button>
      </header>
      <div class="summary-bar">
        <span>選択中: <strong id="selected-count">${countSelected()}</strong> 件</span>
        <button type="button" class="btn btn-primary" id="btn-submit">希望を送信</button>
      </div>
      <div class="input-layout">
        <div class="calendar-wrap card"><h2 class="section-title">日付を選択</h2>${calHtml}</div>
        <div class="day-panel card" id="day-panel">${renderDayPanel()}</div>
      </div>
      <div class="selection-summary card" id="selection-summary">${renderSelectionSummary()}</div>
    </div>
  `;

  app.querySelectorAll('.cal-cell.has-slots').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDateKey = btn.dataset.date;
      ensureDefaultRangesForDay(selectedDateKey);
      renderInputStep();
    });
  });
  bindDayPanelEvents();
  document.getElementById('btn-back').addEventListener('click', () => { step = 'name'; selectedDateKey = null; render(); });
  document.getElementById('btn-submit').addEventListener('click', submitRequests);
}

function renderDayPanel() {
  if (!selectedDateKey) {
    return `<h2 class="section-title">時間帯を選択</h2><p class="muted panel-empty">カレンダーから日付を選ぶと、その日の時間枠が表示されます。</p>`;
  }

  const windows = getWindowsForDay(selectedDateKey);
  const [y, m, d] = selectedDateKey.split('-');
  const wd = WEEKDAYS[getWeekday(Number(y), Number(m), Number(d))];

  if (windows.length === 0) {
    return `<h2 class="section-title">${Number(m)}月${Number(d)}日（${wd}）</h2><p class="muted panel-empty">この日はシフトの募集がありません。</p>`;
  }

  const windowHtml = windows.map((window) => {
    const ranges = getRangesForWindow(selectedDateKey, window.key);
    const rangesHtml = ranges.length
      ? ranges.map((r) => `
          <div class="range-block" data-range-id="${r.id}">
            <div class="range-header">
              <span class="range-label">希望時間帯</span>
              <button type="button" class="btn btn-danger btn-sm btn-remove-range" data-id="${r.id}">削除</button>
            </div>
            ${renderTimeBar(window, r, r.id)}
          </div>`).join('')
      : '';

    return `
      <div class="window-block" data-window="${window.key}">
        <div class="window-header">
          <span class="window-time">${window.start} 〜 ${window.end}</span>
        </div>
        <div class="window-ranges" data-window="${window.key}">${rangesHtml}</div>
        <button type="button" class="btn btn-secondary btn-sm btn-add-range" data-window="${window.key}">時間帯を追加</button>
      </div>`;
  }).join('');

  return `
    <h2 class="section-title">${Number(m)}月${Number(d)}日（${wd}）</h2>
    <div class="day-panel-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-weekday">この曜日の設定を同じ曜日にコピー</button>
    </div>
    <p class="panel-hint">30分刻みのバーで希望時間を調整できます。飛び時間は「時間帯を追加」で入力してください。</p>
    <div class="window-list">${windowHtml}</div>`;
}

function copyWeekdayToSameDays(sourceDateKey) {
  const { year, month } = monthConfig;
  const [sy, sm, sd] = sourceDateKey.split('-').map(Number);
  const targetWd = getWeekday(sy, sm, sd);
  const sourceRanges = requests[sourceDateKey] || [];

  if (sourceRanges.length === 0) {
    alert('この日にはコピーする設定がありません。');
    return;
  }

  const days = getDaysInMonth(year, month);
  let count = 0;

  for (let d = 1; d <= days; d++) {
    const dk = formatDateKey(year, month, d);
    if (dk === sourceDateKey) continue;
    if (getWeekday(year, month, d) !== targetWd) continue;
    if ((monthConfig.days[dk] || []).length === 0) continue;

    const windowKeys = new Set(getWindowsForDay(dk).map((w) => w.key));
    const copied = sourceRanges
      .filter((r) => windowKeys.has(r.windowKey))
      .map((r) => ({
        id: newRangeId(),
        windowKey: r.windowKey,
        start: r.start,
        end: r.end,
      }));

    if (copied.length > 0) {
      requests[dk] = copied;
      count++;
    }
  }

  if (count === 0) {
    alert(`コピー先の${WEEKDAYS[targetWd]}曜日が見つかりませんでした。`);
    return;
  }

  alert(`${WEEKDAYS[targetWd]}曜日の設定を他 ${count} 日分にコピーしました。`);
  renderInputStep();
}

function bindDayPanelEvents() {
  const panel = app.querySelector('#day-panel');
  if (!panel) return;

  const copyBtn = panel.querySelector('#btn-copy-weekday');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyWeekdayToSameDays(selectedDateKey));
  }

  panel.querySelectorAll('.btn-add-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      const windowKey = btn.dataset.window;
      const window = getWindowsForDay(selectedDateKey).find((w) => w.key === windowKey);
      if (!window) return;
      if (!requests[selectedDateKey]) requests[selectedDateKey] = [];
      const existing = getRangesForWindow(selectedDateKey, windowKey);
      let start = window.start;
      let end = window.end;
      if (existing.length > 0) {
        const last = existing[existing.length - 1];
        const nextStart = snapToHalfHour(timeToMinutes(last.end));
        if (nextStart < timeToMinutes(window.end)) {
          start = minutesToTime(nextStart);
          end = window.end;
        } else {
          return;
        }
      }
      if (timeToMinutes(start) >= timeToMinutes(end)) return;
      requests[selectedDateKey].push({ id: newRangeId(), windowKey, start, end });
      refreshDayUI();
    });
  });

  panel.querySelectorAll('.btn-remove-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      requests[selectedDateKey] = (requests[selectedDateKey] || []).filter((r) => r.id !== id);
      if (requests[selectedDateKey].length === 0) delete requests[selectedDateKey];
      refreshDayUI();
    });
  });

  panel.querySelectorAll('.time-bar-wrap').forEach((wrap) => {
    const rangeId = wrap.dataset.rangeId;
    const range = (requests[selectedDateKey] || []).find((r) => r.id === rangeId);
    if (!range) return;
    const window = getWindowsForDay(selectedDateKey).find((w) => w.key === range.windowKey);
    if (!window) return;

    const startInput = wrap.querySelector('.bar-start');
    const endInput = wrap.querySelector('.bar-end');
    const steps = JSON.parse(startInput.dataset.steps);

    const updateFromSliders = () => {
      let si = Number(startInput.value);
      let ei = Number(endInput.value);
      if (si > ei) { const t = si; si = ei; ei = t; startInput.value = si; endInput.value = ei; }
      range.start = steps[si];
      range.end = steps[ei];
      wrap.querySelector('.bar-start-label').textContent = range.start;
      wrap.querySelector('.bar-end-label').textContent = range.end;
      updateBarVisual(wrap, window, range);
      refreshSummaryUI();
    };

    startInput.addEventListener('input', updateFromSliders);
    endInput.addEventListener('input', updateFromSliders);
  });
}

function updateBarVisual(wrap, window, range) {
  const winStart = timeToMinutes(window.start);
  const winEnd = timeToMinutes(window.end);
  const total = winEnd - winStart || 1;
  const sel = wrap.querySelector('.time-bar-selection');
  const rStart = timeToMinutes(range.start);
  const rEnd = timeToMinutes(range.end);
  const left = ((rStart - winStart) / total) * 100;
  const width = ((rEnd - winStart) / total) * 100 - left;
  sel.style.left = `${left}%`;
  sel.style.width = `${Math.max(width, 2)}%`;
}

function refreshDayUI() {
  app.querySelector('#day-panel').innerHTML = renderDayPanel();
  bindDayPanelEvents();
  refreshSummaryUI();
}

function refreshSummaryUI() {
  app.querySelector('#selected-count').textContent = countSelected();
  app.querySelector('#selection-summary').innerHTML = renderSelectionSummary();
  app.querySelectorAll('.cal-cell.has-slots').forEach((btn) => {
    const dk = btn.dataset.date;
    const n = (requests[dk] || []).length;
    const statusEl = btn.querySelector('.day-status');
    if (!statusEl) return;
    if (n > 0) { statusEl.className = 'day-status picked'; statusEl.textContent = `${n}件選択`; }
    else { statusEl.className = 'day-status open'; statusEl.textContent = '選択可'; }
  });
}

function renderSelectionSummary() {
  const entries = [];
  for (const dk of Object.keys(requests).sort()) {
    const [y, m, d] = dk.split('-');
    const wd = WEEKDAYS[getWeekday(Number(y), Number(m), Number(d))];
    for (const r of requests[dk]) {
      entries.push(`${Number(m)}/${Number(d)}（${wd}） ${r.start}〜${r.end}`);
    }
  }
  if (entries.length === 0) {
    return '<h2 class="section-title">選択した希望</h2><p class="muted">まだ選択されていません</p>';
  }
  return `<h2 class="section-title">選択した希望（${entries.length}件）</h2><ul class="summary-list">${entries.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
}

async function submitRequests() {
  const { year, month } = monthConfig;
  for (const [dk, dayReqs] of Object.entries(requests)) {
    const windows = getWindowsForDay(dk);
    for (const req of dayReqs) {
      const window = windows.find((w) => w.key === req.windowKey);
      if (!window) { alert('無効な希望が含まれています。'); return; }
      if (!isValidPreferredRange(req.start, req.end, window.start, window.end)) {
        alert(`${dk} の希望時間が範囲外です。`);
        selectedDateKey = dk;
        renderInputStep();
        return;
      }
    }
  }
  if (countSelected() === 0 && !confirm('希望シフトが1件も選択されていません。このまま送信しますか？')) return;

  const exportRequests = {};
  for (const [dk, dayReqs] of Object.entries(requests)) {
    exportRequests[dk] = dayReqs.map((r) => {
      const window = getWindowsForDay(dk).find((w) => w.key === r.windowKey);
      const slots = getOverlappingSlotKeys(r, window.slots);
      const primary = slots[0] || r.windowKey;
      return { slot: primary, windowKey: r.windowKey, start: r.start, end: r.end, slots };
    });
  }

  const payload = {
    name: userName,
    monthConfig: { year, month },
    requests: exportRequests,
    submittedAt: new Date().toLocaleString('ja-JP'),
  };

  const submitBtn = document.getElementById('btn-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中…';
  }

  try {
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const saved = data.path || (data.filename ? `data/submissions/${data.filename}` : 'data/submissions');
      const how = data.updated ? '同一名の最新版として上書きしました。' : '希望を保存しました。';
      alert(`${how}\n\n${saved}`);
      return;
    }
  } catch {
    // オフライン時はダウンロードにフォールバック
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '希望を送信';
    }
  }

  downloadFile(
    `shift-request-${userName.replace(/[/\\?%*:|"<>]/g, '_')}.json`,
    JSON.stringify(payload, null, 2)
  );
  alert('フォルダへの保存に失敗したため、JSONファイルをダウンロードしました。python3 serve.py 起動後、入力画面（ポート8081）から送信すると data/submissions に保存されます。');
}

function countSelected() {
  return Object.values(requests).reduce((sum, arr) => sum + arr.length, 0);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
