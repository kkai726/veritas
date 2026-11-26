import { useEffect, useState } from 'react';
import { Check, Loader2, Pause, Play, X } from 'lucide-react';
import { STAGE_TEXT, type Stage } from '../lib/pipeline';
import { elapsedOf, type RunTask } from '../lib/task';
import { formatElapsed } from '../lib/utils';

interface Props {
  task: RunTask;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onCollapse: () => void;
}

const ORDER: Stage[] = ['verify', 'extract', 'research', 'analyze', 'compose'];

export function Processing({ task, onPause, onResume, onCancel, onCollapse }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const isUrl = task.mode === 'url' || /^https?:\/\//i.test(task.input.trim());
  const stages = ORDER.filter((s) => (s === 'extract' ? isUrl : true));
  const currentIndex = Math.max(0, stages.indexOf(task.stage));
  const elapsed = elapsedOf(task, now);

  const paused = task.status === 'paused' || task.status === 'pausing';
  const queued = task.status === 'queued';
  const label =
    task.status === 'pausing'
      ? '正在暂停，等当前请求返回'
      : task.status === 'paused'
        ? '已暂停 · 不会再发出新请求'
        : queued
          ? '排队中'
          : task.progress?.label || '处理中…';

  const total = task.progress?.total;
  const done = task.progress?.done;
  const pct = total && done != null ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <section className="processing" aria-live="polite">
      <div className="proc-head">
        <div className="proc-head-main">
          <p className="eyebrow">{paused ? 'Paused' : queued ? 'Queued' : 'Working'}</p>
          <h2 className="proc-title">{paused ? '核查已暂停' : queued ? '排队等待' : '正在核查'}</h2>
          <p className="proc-sub">
            {task.providerName} · {task.model} · {formatElapsed(elapsed)}
          </p>
        </div>
        <div className="proc-actions">
          {paused ? (
            <button className="ghost-btn" onClick={onResume} type="button">
              <Play size={13} />
              继续
            </button>
          ) : (
            <button className="ghost-btn" onClick={onPause} type="button" disabled={queued}>
              <Pause size={13} />
              暂停
            </button>
          )}
          <button className="ghost-btn" onClick={onCollapse} type="button" title="收起后任务继续在后台运行">
            收起
          </button>
          <button className="ghost-btn ghost-btn--danger" onClick={onCancel} type="button">
            <X size={14} />
            取消
          </button>
        </div>
      </div>

      <p className="proc-task-title">{task.title}</p>

      <div className={`proc-progress ${pct === null ? 'is-indeterminate' : ''}`}>
        <span className="proc-bar" style={pct === null ? undefined : { width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className="proc-status">
        {!paused && !queued && <Loader2 size={12} className="spin" />}
        <span>{label}</span>
        {task.progress?.done != null && task.progress?.total ? (
          <span className="proc-count">
            {task.progress.done}/{task.progress.total}
          </span>
        ) : null}
      </p>

      <ol className="steps">
        {stages.map((s, i) => {
          const doneStep = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li
              key={s}
              className={`step ${doneStep ? 'is-done' : ''} ${active ? 'is-active' : ''} ${
                active && paused ? 'is-paused' : ''
              }`}
            >
              <span className="step-mark">
                {doneStep ? (
                  <Check size={12} strokeWidth={3} />
                ) : active && !paused ? (
                  <Loader2 size={12} className="spin" />
                ) : active && paused ? (
                  <Pause size={10} />
                ) : null}
              </span>
              <span className="step-label">{STAGE_TEXT[s]}</span>
              {active && !paused && <span className="step-bar" />}
            </li>
          );
        })}
      </ol>

      <p className="proc-note">
        收起后任务继续在后台跑，右下角的任务卡可以随时打开；暂停期间不会发出任何请求，所以也不会产生费用。
      </p>
    </section>
  );
}
