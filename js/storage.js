import { formatDateKey, getDaysInMonth } from './utils.js';

/** 入力アプリ用ローカルストレージ（月シフト指定） */

const STORAGE_KEY = 'shift-input-app-data';

export function createEmptyMonthConfig() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    days: {},
  };
}

export function loadState(seedMonthConfig) {
  const fallback = seedMonthConfig || createEmptyMonthConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { monthConfig: fallback };
    const data = JSON.parse(raw);
    return {
      monthConfig: data.monthConfig || fallback,
    };
  } catch {
    return { monthConfig: fallback };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ monthConfig: state.monthConfig }));
}

export function getAllDateKeys(state) {
  const { year, month } = state.monthConfig;
  const days = getDaysInMonth(year, month);
  const keys = [];
  for (let d = 1; d <= days; d++) {
    keys.push(formatDateKey(year, month, d));
  }
  return keys;
}
