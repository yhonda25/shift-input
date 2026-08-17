/** 共通ユーティリティ */

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatDateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function slotKey(start, end) {
  return `${start}-${end}`;
}

export function parseSlotKey(key) {
  const idx = key.indexOf('-');
  if (idx === -1) return { start: key, end: key };
  return { start: key.slice(0, idx), end: key.slice(idx + 1) };
}

export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function getWeekday(year, month, day) {
  return new Date(year, month - 1, day).getDay();
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadHTML(filename, html) {
  downloadFile(filename, html, 'text/html;charset=utf-8');
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${pad(h)}:${pad(min)}`;
}

export function durationMinutes(start, end) {
  return timeToMinutes(end) - timeToMinutes(start);
}

export function snapToHalfHour(minutes) {
  return Math.round(minutes / 30) * 30;
}

/** つながった管理枠を入力用ウィンドウにまとめる */
export function mergeContiguousSlots(slots) {
  if (!slots || slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const windows = [];
  let current = {
    start: sorted[0].start,
    end: sorted[0].end,
    slots: [sorted[0]],
  };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.start === current.end) {
      current.end = s.end;
      current.slots.push(s);
    } else {
      windows.push(current);
      current = { start: s.start, end: s.end, slots: [s] };
    }
  }
  windows.push(current);
  return windows.map((w) => ({
    ...w,
    key: slotKey(w.start, w.end),
  }));
}

export function getOverlappingSlotKeys(range, adminSlots) {
  return adminSlots
    .filter((s) => requestOverlapsAdminSlot(range, s))
    .map((s) => slotKey(s.start, s.end));
}

export function requestOverlapsAdminSlot(request, adminSlot) {
  const r = normalizeRequest(request);
  const overlapStart = Math.max(timeToMinutes(r.start), timeToMinutes(adminSlot.start));
  const overlapEnd = Math.min(timeToMinutes(r.end), timeToMinutes(adminSlot.end));
  return overlapStart < overlapEnd;
}

export function buildTimeSteps(windowStart, windowEnd, stepMin = 30) {
  const steps = [];
  let m = timeToMinutes(windowStart);
  const end = timeToMinutes(windowEnd);
  while (m <= end) {
    steps.push(minutesToTime(m));
    m += stepMin;
  }
  return steps;
}

/** 割当エントリの正規化 */
export function normalizeAssignee(entry) {
  if (typeof entry === 'string') {
    return { name: entry, assignedStart: null, assignedEnd: null };
  }
  return {
    name: entry.name,
    assignedStart: entry.assignedStart ?? entry.start ?? null,
    assignedEnd: entry.assignedEnd ?? entry.end ?? null,
  };
}

export function getAssigneeName(entry) {
  return normalizeAssignee(entry).name;
}

export function isPersonAssigned(list, name) {
  return (list || []).some((a) => getAssigneeName(a) === name);
}

export function getAssignedDisplayRange(assignee, fallbackSlot) {
  const a = normalizeAssignee(assignee);
  if (a.assignedStart && a.assignedEnd) {
    return { start: a.assignedStart, end: a.assignedEnd };
  }
  return { start: fallbackSlot.start, end: fallbackSlot.end };
}

const MIN_ASSIGN_MINUTES = 120;
const LONG_REQUEST_MINUTES = 180;

/** 希望に対する確定シフト時間を算出（一部割当・3時間以上は最低2時間） */
export function computeAssignedRange(request, adminSlot) {
  const r = normalizeRequest(request);
  const reqStart = timeToMinutes(r.start);
  const reqEnd = timeToMinutes(r.end);
  const slotStart = timeToMinutes(adminSlot.start);
  const slotEnd = timeToMinutes(adminSlot.end);

  let start = Math.max(reqStart, slotStart);
  let end = Math.min(reqEnd, slotEnd);
  if (start >= end) return null;

  const reqDuration = reqEnd - reqStart;
  let duration = end - start;

  if (reqDuration >= LONG_REQUEST_MINUTES) {
    const target = Math.max(MIN_ASSIGN_MINUTES, duration);
    const maxEnd = Math.min(reqEnd, slotEnd);
    if (maxEnd - start >= MIN_ASSIGN_MINUTES) {
      end = Math.min(start + target, maxEnd);
      duration = end - start;
    }
    if (duration < MIN_ASSIGN_MINUTES && maxEnd - start >= MIN_ASSIGN_MINUTES) {
      end = start + MIN_ASSIGN_MINUTES;
    }
  }

  start = snapToHalfHour(start);
  end = snapToHalfHour(end);
  if (start >= end) return null;

  return { assignedStart: minutesToTime(start), assignedEnd: minutesToTime(end) };
}

export function slotsOverlap(a, b) {
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
}

export function fulfillmentRate(requested, assigned) {
  if (requested === 0) return 1;
  return assigned / requested;
}

export function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

/** 希望シフトエントリの正規化（旧: 文字列 / 新: オブジェクト） */
export function normalizeRequest(entry) {
  if (typeof entry === 'string') {
    const { start, end } = parseSlotKey(entry);
    return { slot: entry, start, end };
  }
  return {
    slot: entry.slot,
    start: entry.start,
    end: entry.end,
  };
}

export function getRequestSlotKey(entry) {
  return normalizeRequest(entry).slot;
}

export function getRequestTimeRange(entry) {
  const r = normalizeRequest(entry);
  return { start: r.start, end: r.end };
}

export function formatRequestLabel(entry) {
  const r = normalizeRequest(entry);
  const base = parseSlotKey(r.slot);
  if (r.start === base.start && r.end === base.end) {
    return `${r.start}〜${r.end}`;
  }
  return `${r.start}〜${r.end}（枠 ${base.start}〜${base.end}）`;
}

export function personRequestedSlot(requests, dateKey, slotKeyStr) {
  return (requests[dateKey] || []).some((e) => getRequestSlotKey(e) === slotKeyStr);
}

export function clipRangeToSlot(range, adminSlot) {
  const start = minutesToTime(Math.max(timeToMinutes(range.start), timeToMinutes(adminSlot.start)));
  const end = minutesToTime(Math.min(timeToMinutes(range.end), timeToMinutes(adminSlot.end)));
  if (timeToMinutes(start) >= timeToMinutes(end)) return null;
  return { start, end };
}

function entryAppliesToAdminSlot(entry, adminSlot) {
  const sk = slotKey(adminSlot.start, adminSlot.end);
  if (!entry.slots?.length) return true;
  if (entry.slots.includes(sk)) return true;
  return requestOverlapsAdminSlot(entry, adminSlot);
}

/** 管理側の枠に対応する希望を検索（キー不一致時も時間範囲で照合） */
export function findRequestForAdminSlot(requests, dateKey, adminSlot) {
  const sk = slotKey(adminSlot.start, adminSlot.end);
  const entries = requests[dateKey] || [];

  const clip = (r) => {
    const clipped = clipRangeToSlot(r, adminSlot);
    if (!clipped) return null;
    return { ...r, ...clipped, slot: sk };
  };

  for (const entry of entries) {
    if (!entryAppliesToAdminSlot(entry, adminSlot)) continue;
    const r = normalizeRequest(entry);
    if (r.slot === sk) {
      const matched = clip(r);
      if (matched) return matched;
    }
  }

  for (const entry of entries) {
    if (!entryAppliesToAdminSlot(entry, adminSlot)) continue;
    const r = normalizeRequest(entry);
    const base = parseSlotKey(r.slot);
    if (base.start === adminSlot.start && base.end === adminSlot.end) {
      const matched = clip(r);
      if (matched) return matched;
    }
  }

  for (const entry of entries) {
    if (!entryAppliesToAdminSlot(entry, adminSlot)) continue;
    if (!requestOverlapsAdminSlot(entry, adminSlot)) continue;
    const matched = clip(normalizeRequest(entry));
    if (matched) return matched;
  }

  return null;
}

export function personRequestedAdminSlot(requests, dateKey, adminSlot) {
  return findRequestForAdminSlot(requests, dateKey, adminSlot) !== null;
}

export function getPersonRequestForSlot(sub, dateKey, slotKeyStr) {
  const entry = (sub.requests[dateKey] || []).find((e) => getRequestSlotKey(e) === slotKeyStr);
  return entry ? normalizeRequest(entry) : null;
}

/** 管理側の枠キーに対応する希望を取得 */
export function getPersonRequestForAdminSlot(sub, dateKey, adminSlot) {
  return findRequestForAdminSlot(sub.requests, dateKey, adminSlot);
}

export function isTimeWithinSlot(time, slotStart, slotEnd) {
  const t = timeToMinutes(time);
  return t >= timeToMinutes(slotStart) && t <= timeToMinutes(slotEnd);
}

export function isValidPreferredRange(start, end, slotStart, slotEnd) {
  if (!start || !end) return false;
  if (timeToMinutes(start) >= timeToMinutes(end)) return false;
  return (
    isTimeWithinSlot(start, slotStart, slotEnd) &&
    isTimeWithinSlot(end, slotStart, slotEnd)
  );
}
