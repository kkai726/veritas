/**
 * 核查任务调度。
 *
 * 为什么要有这一层：
 *  - 一次核查要几十秒，用户不该被锁在一个页面里；任务跑在模块级，
 *    收起界面、去看历史、甚至再开一个核查都不影响它继续走。
 *  - 暂停不是「假装停住」：每个网络请求之前都会过一次 gate，暂停后
 *    不再发出任何新请求（也就不会再花钱）；正在飞的那个请求会跑完，
 *    所以界面区分「正在暂停」与「已暂停」。
 *  - 并行上限 2 个：再多搜索引擎那边会限流，反而更慢。
 */

import { useSyncExternalStore } from 'react';
import { factCheck, type Stage } from './pipeline';
import { testConnection } from './providers';
import { saveHistory } from './history';
import { configOf, isVerified, markVerified, presetOf } from './settings';
import type { Report, Settings } from './types';
import { countChars } from './utils';

export type TaskStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'done' | 'error' | 'cancelled';

export interface TaskProgress {
  label: string;
  done?: number;
  total?: number;
}

export interface RunTask {
  id: string;
  createdAt: string;
  title: string;
  input: string;
  mode: 'auto' | 'text' | 'url';
  depth: Settings['depth'];
  status: TaskStatus;
  stage: Stage;
  providerName: string;
  model: string;
  /** 已经计时的毫秒数（不含当前正在跑的这一段） */
  elapsedMs: number;
  /** 当前这段开始跑的墙钟时间；不在跑时为 0 */
  activeSince: number;
  progress?: TaskProgress;
  report?: Report;
  error?: { message: string; hint?: string };
  /** 是否已经写入本地历史，避免重复存档 */
  saved: boolean;
}

const MAX_ACTIVE = 2;
const MAX_TASKS = 12;

let tasks: RunTask[] = [];
let snapshot: RunTask[] = [];
const listeners = new Set<() => void>();

function commit() {
  snapshot = tasks.map((t) => ({ ...t }));
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个订阅出错不影响其他 */
    }
  });
}

export function subscribeTasks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getTasks(): RunTask[] {
  return snapshot;
}

export function useTasks(): RunTask[] {
  return useSyncExternalStore(subscribeTasks, getTasks, getTasks);
}

export function getTask(id: string | null): RunTask | undefined {
  if (!id) return undefined;
  return snapshot.find((t) => t.id === id);
}

export function elapsedOf(task: RunTask, now = Date.now()): number {
  const live = task.activeSince ? Math.max(0, now - task.activeSince) : 0;
  return task.elapsedMs + live;
}

/** 只有真正在跑的任务占名额；暂停的不占，否则排在后面的任务会一直被挡住 */
export function activeTaskCount(list = tasks): number {
  return list.filter((t) => t.status === 'running' || t.status === 'pausing').length;
}

/* ------------------------------------------------------------------ 控制器 */

interface Control {
  abort: AbortController;
  paused: boolean;
  resume?: () => void;
}

const controls = new Map<string, Control>();
/** 任务的启动参数留着，「重跑」与排队出队都要用；任务被移除时一起删 */
const jobs = new Map<string, { settings: Settings; input: string; mode: 'auto' | 'text' | 'url' }>();

/** App 注册这个，把「验证通过」写回本地设置 */
let settingsSink: ((next: Settings) => void) | null = null;
export function onSettingsPatched(fn: ((next: Settings) => void) | null) {
  settingsSink = fn;
}

function patch(id: string, next: Partial<RunTask>) {
  let hit = false;
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    hit = true;
    return { ...t, ...next };
  });
  if (hit) commit();
}

function abortError(): DOMException {
  return new DOMException('已取消', 'AbortError');
}

/** 每个请求之前都过一遍：暂停时挂起，取消时抛 AbortError */
async function checkpoint(id: string): Promise<void> {
  const ctl = controls.get(id);
  if (!ctl) return;
  if (ctl.abort.signal.aborted) throw abortError();
  if (!ctl.paused) return;

  const task = tasks.find((t) => t.id === id);
  const startedAt = task?.activeSince ?? 0;
  patch(id, {
    status: 'paused',
    activeSince: 0,
    elapsedMs: (task?.elapsedMs ?? 0) + (startedAt ? Date.now() - startedAt : 0),
    progress: { label: '已暂停 · 不再发出请求', done: task?.progress?.done, total: task?.progress?.total },
  });

  await new Promise<void>((resolve, reject) => {
    const signal = ctl.abort.signal;
    const onAbort = () => {
      ctl.resume = undefined;
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    ctl.resume = () => {
      signal.removeEventListener('abort', onAbort);
      ctl.resume = undefined;
      resolve();
    };
  });

  patch(id, {
    status: 'running',
    activeSince: Date.now(),
    error: undefined,
    progress: { label: '继续核查…', done: task?.progress?.done, total: task?.progress?.total },
  });
}

/* ------------------------------------------------------------------ 对外 API */

function makeId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function titleOf(input: string): string {
  const line = input
    .trim()
    .split(/\n+/)
    .map((s) => s.trim())
    .find(Boolean) ?? '未命名核查';
  const clean = line.replace(/^https?:\/\//, '');
  return countChars(clean) > 34 ? `${clean.slice(0, 34)}…` : clean || '未命名核查';
}

export interface StartOptions {
  settings: Settings;
  input: string;
  mode: 'auto' | 'text' | 'url';
}

export function startTask({ settings, input, mode }: StartOptions): string {
  const id = makeId();
  const preset = presetOf(settings.activeId);
  const config = configOf(settings);
  const running = activeTaskCount();
  const queued = running >= MAX_ACTIVE;

  const task: RunTask = {
    id,
    createdAt: new Date().toISOString(),
    title: titleOf(input),
    input,
    mode,
    depth: settings.depth,
    status: queued ? 'queued' : 'running',
    stage: 'research',
    providerName: preset.name,
    model: config.model,
    elapsedMs: 0,
    activeSince: 0,
    progress: { label: queued ? `排队中 · 前面还有 ${running - MAX_ACTIVE + 1} 个` : '准备中…' },
    saved: false,
  };

  tasks = [task, ...tasks].slice(0, MAX_TASKS);
  jobs.set(id, { settings, input, mode });
  commit();

  if (!queued) void run(id);
  return id;
}

async function run(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  const ctl: Control = { abort: new AbortController(), paused: false };
  controls.set(id, ctl);
  patch(id, { status: 'running', activeSince: Date.now(), progress: { label: '准备中…' } });

  const { signal } = ctl.abort;

  try {
    let active = job.settings;

    // 没测通过就先验证一次，避免跑到一半才发现 Key 不对
    if (!isVerified(active)) {
      patch(id, { stage: 'verify', progress: { label: '验证模型可用…' } });
      await checkpoint(id);
      await testConnection(active.activeId, configOf(active));
      active = markVerified(active, active.activeId, configOf(active).model);
      settingsSink?.(active);
    }

    const report = await factCheck({
      settings: active,
      input: job.input,
      mode: job.mode,
      signal,
      checkpoint: () => checkpoint(id),
      onStage: (stage, label, done, total) =>
        patch(id, { stage, progress: label ? { label, done, total } : undefined }),
    });

    const task = tasks.find((t) => t.id === id);
    const elapsedMs = (task?.elapsedMs ?? 0) + (task?.activeSince ? Date.now() - task.activeSince : 0);

    saveHistory(report);
    patch(id, {
      status: 'done',
      stage: 'compose',
      report,
      saved: true,
      activeSince: 0,
      elapsedMs,
      progress: undefined,
    });
  } catch (err) {
    const task = tasks.find((t) => t.id === id);
    const elapsedMs = (task?.elapsedMs ?? 0) + (task?.activeSince ? Date.now() - task.activeSince : 0);
    const aborted = signal.aborted;

    if (aborted) {
      patch(id, { status: 'cancelled', activeSince: 0, elapsedMs, progress: undefined });
    } else {
      const detail = err as { message?: string; hint?: string };
      patch(id, {
        status: 'error',
        activeSince: 0,
        elapsedMs,
        progress: undefined,
        error: { message: detail?.message || String(err), hint: detail?.hint },
      });
    }
  } finally {
    controls.delete(id);
    pump();
  }
}

function pump() {
  if (activeTaskCount() >= MAX_ACTIVE) return;
  const next = [...tasks].reverse().find((t) => t.status === 'queued');
  if (next) void run(next.id);
}

export function pauseTask(id: string) {
  const ctl = controls.get(id);
  if (!ctl || ctl.paused) return;
  ctl.paused = true;
  patch(id, { status: 'pausing', progress: { label: '正在暂停 · 等待当前请求返回…' } });
}

export function resumeTask(id: string) {
  const ctl = controls.get(id);
  if (!ctl) return;
  ctl.paused = false;
  const task = tasks.find((t) => t.id === id);
  if (task?.status === 'paused' || task?.status === 'pausing') {
    patch(id, { status: 'running', activeSince: task.activeSince || Date.now() });
  }
  ctl.resume?.();
}

export function cancelTask(id: string) {
  const ctl = controls.get(id);
  if (ctl) {
    ctl.paused = false;
    ctl.abort.abort();
    ctl.resume?.();
  }
  const task = tasks.find((t) => t.id === id);
  if (task && (task.status === 'queued' || task.status === 'running' || task.status === 'paused' || task.status === 'pausing')) {
    patch(id, { status: 'cancelled', activeSince: 0, progress: undefined });
    pump();
  } else if (task) {
    patch(id, { status: 'cancelled', activeSince: 0, progress: undefined });
  }
}

export function dismissTask(id: string) {
  controls.get(id)?.abort.abort();
  controls.delete(id);
  jobs.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  commit();
}

export function clearFinishedTasks() {
  tasks = tasks.filter((t) => t.status === 'running' || t.status === 'pausing' || t.status === 'paused' || t.status === 'queued');
  commit();
}

export function retryTask(id: string): string | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const job = jobs.get(id);
  const settings = job?.settings;
  if (!settings) return null;
  return startTask({ settings, input: task.input, mode: task.mode });
}
