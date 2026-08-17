import {
  formatDateKey,
  getDaysInMonth,
  getWeekday,
  WEEKDAYS,
  downloadFile,
} from './utils.js';
import { getAllDateKeys } from './storage.js';

/** 月シフト指定タブ（親アプリの設計を入力アプリ内に移植） */

export function renderMonthSpec(container, state, { onChange, onApplyToInput, saveToServer, inputUrl }) {
  const { year, month } = state.monthConfig;

  container.innerHTML = `
    <div class="spec-view">
      <div class="panel-header">
        <h2>月シフト指定</h2>
        <p class="hint">各日のシフト時間帯と必要人数を設定します。設定後「入力画面に反映」で、別ポートの希望入力画面を開きます。</p>
      </div>
      <div class="controls-row">
        <label>対象年月
          <input type="number" id="spec-year" value="${year}" min="2020" max="2099" />
          年
          <input type="number" id="spec-month" value="${month}" min="1" max="12" />
          月
        </label>
        <button type="button" class="btn btn-primary" id="btn-apply-month">月を適用</button>
        <button type="button" class="btn btn-secondary" id="btn-copy-prev">1日目の設定を全日にコピー</button>
        <button type="button" class="btn btn-success" id="btn-apply-input">入力画面に反映</button>
        <button type="button" class="btn btn-secondary" id="btn-save-server">設定をサーバーに保存</button>
        <button type="button" class="btn btn-secondary" id="btn-export-config">設定をJSONでダウンロード</button>
      </div>
      <div id="month-calendar" class="month-calendar"></div>
      <div id="day-editor" class="day-editor hidden">
        <h3 id="day-editor-title"></h3>
        <div id="slot-list"></div>
        <button type="button" class="btn btn-secondary" id="btn-add-slot">時間帯を追加</button>
        <div class="editor-actions">
          <button type="button" class="btn btn-primary" id="btn-save-day">この日の設定を保存</button>
          <button type="button" class="btn btn-secondary" id="btn-copy-weekday">この曜日を全ての同じ曜日にコピー</button>
          <button type="button" class="btn btn-ghost" id="btn-close-editor">閉じる</button>
        </div>
      </div>
      <div id="export-status" class="status-msg"></div>
    </div>
  `;

  let selectedDateKey = null;
  let editingSlots = [];

  function renderCalendar() {
    const cal = container.querySelector('#month-calendar');
    const y = state.monthConfig.year;
    const m = state.monthConfig.month;
    const days = getDaysInMonth(y, m);
    const firstWd = getWeekday(y, m, 1);

    let html = '<div class="cal-header">';
    for (const wd of WEEKDAYS) {
      html += `<div class="cal-wd">${wd}</div>`;
    }
    html += '</div><div class="cal-grid">';

    for (let i = 0; i < firstWd; i++) {
      html += '<div class="cal-cell empty"></div>';
    }

    for (let d = 1; d <= days; d++) {
      const dk = formatDateKey(y, m, d);
      const slots = state.monthConfig.days[dk] || [];
      const wd = getWeekday(y, m, d);
      const isSun = wd === 0;
      const isSat = wd === 6;
      const slotSummary = slots.length
        ? slots.map((s) => `${s.start}-${s.end}(${s.required}名)`).join('<br>')
        : '<span class="muted">未設定</span>';

      html += `
        <div class="cal-cell ${isSun ? 'sun' : ''} ${isSat ? 'sat' : ''} ${dk === selectedDateKey ? 'selected' : ''}"
             data-date="${dk}">
          <div class="cal-day-num">${d}</div>
          <div class="cal-slots">${slotSummary}</div>
        </div>`;
    }

    html += '</div>';
    cal.innerHTML = html;

    cal.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => openDayEditor(cell.dataset.date));
    });
  }

  function openDayEditor(dateKey) {
    selectedDateKey = dateKey;
    editingSlots = JSON.parse(JSON.stringify(state.monthConfig.days[dateKey] || []));
    if (editingSlots.length === 0) {
      editingSlots.push({ start: '09:00', end: '12:00', required: 1 });
    }

    const [y, m, d] = dateKey.split('-');
    const wd = WEEKDAYS[getWeekday(Number(y), Number(m), Number(d))];
    container.querySelector('#day-editor-title').textContent =
      `${y}年${Number(m)}月${Number(d)}日（${wd}）のシフト設定`;
    container.querySelector('#day-editor').classList.remove('hidden');
    renderSlotList();
    renderCalendar();
  }

  function syncSlotsFromDOM() {
    const rows = container.querySelectorAll('.slot-row');
    if (rows.length === 0) return;
    editingSlots = Array.from(rows).map((row) => ({
      start: row.querySelector('.slot-start').value,
      end: row.querySelector('.slot-end').value,
      required: Number(row.querySelector('.slot-required').value) || 1,
    }));
  }

  function renderSlotList() {
    const list = container.querySelector('#slot-list');
    list.innerHTML = editingSlots
      .map(
        (s, i) => `
      <div class="slot-row" data-idx="${i}">
        <input type="time" class="slot-start" value="${s.start}" />
        〜
        <input type="time" class="slot-end" value="${s.end}" />
        必要人数
        <input type="number" class="slot-required" value="${s.required}" min="1" max="20" />
        <button type="button" class="btn btn-danger btn-sm slot-remove">削除</button>
      </div>`
      )
      .join('');

    list.querySelectorAll('.slot-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncSlotsFromDOM();
        const idx = Number(btn.closest('.slot-row').dataset.idx);
        editingSlots.splice(idx, 1);
        renderSlotList();
      });
    });
  }

  container.querySelector('#btn-add-slot').addEventListener('click', () => {
    syncSlotsFromDOM();
    editingSlots.push({ start: '13:00', end: '17:00', required: 1 });
    renderSlotList();
  });

  container.querySelector('#btn-save-day').addEventListener('click', () => {
    if (!selectedDateKey) return;
    syncSlotsFromDOM();
    state.monthConfig.days[selectedDateKey] = editingSlots;
    onChange();
    renderCalendar();
    showStatus('保存しました');
  });

  container.querySelector('#btn-copy-weekday').addEventListener('click', () => {
    if (!selectedDateKey) return;
    syncSlotsFromDOM();
    const [sy, sm, sd] = selectedDateKey.split('-').map(Number);
    const targetWd = getWeekday(sy, sm, sd);
    const template = JSON.parse(JSON.stringify(editingSlots));
    const keys = getAllDateKeys(state);
    let count = 0;
    for (const dk of keys) {
      const [yy, mm, dd] = dk.split('-').map(Number);
      if (getWeekday(yy, mm, dd) === targetWd) {
        state.monthConfig.days[dk] = JSON.parse(JSON.stringify(template));
        count++;
      }
    }
    onChange();
    renderCalendar();
    showStatus(`${WEEKDAYS[targetWd]}曜日の設定を ${count} 日分にコピーしました`);
  });

  container.querySelector('#btn-close-editor').addEventListener('click', () => {
    selectedDateKey = null;
    container.querySelector('#day-editor').classList.add('hidden');
    renderCalendar();
  });

  container.querySelector('#btn-apply-month').addEventListener('click', () => {
    state.monthConfig.year = Number(container.querySelector('#spec-year').value);
    state.monthConfig.month = Number(container.querySelector('#spec-month').value);
    onChange();
    renderCalendar();
    showStatus('対象月を変更しました');
  });

  container.querySelector('#btn-copy-prev').addEventListener('click', () => {
    const keys = getAllDateKeys(state);
    const template = state.monthConfig.days[keys[0]] || [
      { start: '09:00', end: '12:00', required: 1 },
      { start: '13:00', end: '17:00', required: 1 },
    ];
    for (const dk of keys) {
      state.monthConfig.days[dk] = JSON.parse(JSON.stringify(template));
    }
    onChange();
    renderCalendar();
    showStatus('1日目の設定を全ての日にコピーしました');
  });

  container.querySelector('#btn-apply-input').addEventListener('click', async () => {
    onChange();
    const btn = container.querySelector('#btn-apply-input');
    btn.disabled = true;
    showStatus('入力画面に反映中…');
    try {
      let url = inputUrl;
      if (onApplyToInput) url = (await onApplyToInput()) || inputUrl;
      showStatus(`入力画面に反映しました。 ${url} を開いてください。`);
    } catch (err) {
      showStatus(err.message || '入力画面への反映に失敗しました');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#btn-save-server').addEventListener('click', async () => {
    onChange();
    const btn = container.querySelector('#btn-save-server');
    btn.disabled = true;
    showStatus('サーバーに保存中…');
    try {
      if (saveToServer) {
        await saveToServer();
      } else {
        const res = await fetch('/api/month-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthConfig: state.monthConfig }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'サーバーへの保存に失敗しました');
      }
      const hint = inputUrl ? ` 入力画面: ${inputUrl}` : '';
      showStatus(`月設定を保存しました。入力画面を開き直すと反映されます。${hint}`);
    } catch (err) {
      showStatus(err.message || 'サーバーに接続できません。このフォルダで python3 serve.py を起動してください。');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#btn-export-config').addEventListener('click', () => {
    const { year, month } = state.monthConfig;
    downloadFile(
      `month-config-${year}-${String(month).padStart(2, '0')}.json`,
      JSON.stringify(state.monthConfig, null, 2)
    );
    showStatus('月設定のJSONをダウンロードしました');
  });

  function showStatus(msg) {
    container.querySelector('#export-status').textContent = msg;
  }

  renderCalendar();
}
