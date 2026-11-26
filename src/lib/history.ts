/**
 * 本地核查历史。
 *
 * 存在 localStorage：报告里的 raw 字段（模型原始输出）体积大且只在解析时有用，
 * 存档前会被丢掉，其余字段（段落、来源、Markdown）完整保留，打开即可回到报告页。
 *
 * 容量策略：最多 40 条，总字节控制在 3 MB 内，超出时从最旧的开始丢。
 */

import type { Report } from './types';

const KEY = 'veritas.history.v1';
const LIMIT = 40;
const MAX_BYTES = 3_000_000;

export interface HistoryEntry {
  id: string;
  createdAt: string;
  title: string;
  score: number;
  providerName: string;
  model: string;
  inputType: 'text' | 'url';
  sourceUrl?: string;
  chars: number;
  excerpt: string;
  evidence?: number;
  report: Report;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function onHistoryChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个订阅出错不影响其他 */
    }
  });
}

function readRaw(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === 'string' && e.report);
  } catch {
    return [];
  }
}

function write(entries: HistoryEntry[]) {
  let list = entries.slice(0, LIMIT);
  while (list.length && JSON.stringify(list).length > MAX_BYTES) {
    list = list.slice(0, -1);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 配额不足时逐条收缩再试一次
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))));
    } catch {
      /* 实在写不进就放弃，不阻塞核查 */
    }
  }
  emit();
}

export function listHistory(): HistoryEntry[] {
  return readRaw().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function historyCount(): number {
  return readRaw().length;
}

export function saveHistory(report: Report): HistoryEntry {
  const entry: HistoryEntry = {
    id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: report.meta.createdAt,
    title: report.title,
    score: report.overallScore,
    providerName: report.meta.providerName,
    model: report.meta.model,
    inputType: report.meta.inputType,
    sourceUrl: report.meta.sourceUrl,
    chars: report.meta.chars,
    excerpt: (report.tldr || report.paragraphs[0]?.summary || '').slice(0, 120),
    evidence: report.meta.evidence?.hits,
    report: { ...report, raw: '' },
  };

  const existing = readRaw().filter((e) => e.id !== entry.id);
  write([entry, ...existing]);
  return entry;
}

export function deleteHistory(id: string) {
  write(readRaw().filter((e) => e.id !== id));
}

export function clearHistory() {
  write([]);
}
