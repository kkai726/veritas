import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Pause,
  Play,
  X,
} from 'lucide-react';
import { activeTaskCount, elapsedOf, type RunTask } from '../lib/task';
import { STAGE_TEXT } from '../lib/pipeline';
import { formatElapsed } from '../lib/utils';

interface Props {
  tasks: RunTask[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
}

function stateText(task: RunTask): string {
  switch (task.status) {
    case 'queued':
      return '排队中';
    case 'running':
      return STAGE_TEXT[task.stage];
    case 'pausing':
      return '正在暂停';
    case 'paused':
      return '已暂停';
    case 'done':
      return `已完成 · ${task.report?.overallScore ?? 0} 分`;
    case 'error':
      return '出错';
    default:
      return '已取消';
  }
}

export function TaskDock({
  tasks,
  activeId,
  onOpen,
  onPause,
  onResume,
  onCancel,
  onDismiss,
  onClearFinished,
}: Props) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const errorSeen = useRef(0);

  const errors = tasks.filter((t) => t.status === 'error').length;

  useEffect(() => {
    if (tasks.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [tasks.length]);

  useEffect(() => {
    if (errors > errorSeen.current) setOpen(true);
    errorSeen.current = errors;
  }, [errors]);

  if (tasks.length === 0) return null;

  const running = activeTaskCount(tasks);
  const finished = tasks.filter((t) => t.status === 'done' || t.status === 'error' || t.status === 'cancelled');
  const errorsCount = tasks.filter((t) => t.status === 'error').length;
  const pillText = running
    ? `${running} 个任务进行中`
    : errorsCount
      ? `${errorsCount} 个任务出错`
      : `${tasks.length} 个任务已完成`;

  if (!open) {
    return (
      <button type="button" className="dock-pill" onClick={() => setOpen(true)} aria-label="打开任务列表">
        <span className={`dock-pill-icon ${running ? 'is-live' : ''}`}>
          {running ? <Loader2 size={14} className="spin" /> : <Layers size={14} />}
        </span>
        <span className="dock-pill-text">{pillText}</span>
        <ChevronUp size={13} />
      </button>
    );
  }

  return (
    <aside className="dock" aria-label="核查任务">
      <div className="dock-head">
        <span className="dock-title">
          核查任务
          <span className="dock-badge">{running ? `${running} 进行中` : `${tasks.length} 个`}</span>
        </span>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => setOpen(false)} aria-label="收起">
          <ChevronDown size={15} />
        </button>
      </div>

      <ul className="dock-list">
        {tasks.map((task) => {
          const busy = task.status === 'running' || task.status === 'pausing';
          const isPaused = task.status === 'paused' || task.status === 'pausing';
          return (
            <li key={task.id} className={`dock-item ${task.id === activeId ? 'is-active' : ''}`}>
              <button type="button" className="dock-item-main" onClick={() => onOpen(task.id)}>
                <span className={`dock-state dock-state--${task.status}`}>
                  {task.status === 'running' ? (
                    <Loader2 size={12} className="spin" />
                  ) : task.status === 'done' ? (
                    <CheckCircle2 size={12} />
                  ) : task.status === 'error' ? (
                    <AlertCircle size={12} />
                  ) : task.status === 'paused' || task.status === 'pausing' ? (
                    <Pause size={11} />
                  ) : (
                    <span className="dock-dot" />
                  )}
                </span>
                <span className="dock-item-text">
                  <span className="dock-item-title">{task.title}</span>
                  <span className="dock-item-meta">
                    {stateText(task)}
                    {task.status !== 'queued' && task.status !== 'cancelled'
                      ? ` · ${formatElapsed(elapsedOf(task, now))}`
                      : ''}
                  </span>
                  {task.status === 'running' && task.progress?.total ? (
                    <span className="dock-mini-bar">
                      <span
                        style={{
                          width: `${Math.min(100, Math.round(((task.progress.done ?? 0) / task.progress.total) * 100))}%`,
                        }}
                      />
                    </span>
                  ) : null}
                </span>
              </button>

              <span className="dock-item-actions">
                {busy && (
                  <button type="button" className="dock-act" title="暂停" onClick={() => onPause(task.id)}>
                    <Pause size={12} />
                  </button>
                )}
                {isPaused && (
                  <button type="button" className="dock-act" title="继续" onClick={() => onResume(task.id)}>
                    <Play size={12} />
                  </button>
                )}
                {(busy || isPaused || task.status === 'queued') && (
                  <button type="button" className="dock-act" title="取消" onClick={() => onCancel(task.id)}>
                    <X size={12} />
                  </button>
                )}
                {(task.status === 'done' || task.status === 'error' || task.status === 'cancelled') && (
                  <button type="button" className="dock-act" title="移除" onClick={() => onDismiss(task.id)}>
                    <X size={12} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="dock-foot">
        <span>同时最多 2 个 · 收起不影响运行</span>
        {finished.length > 0 && (
          <button type="button" className="text-link" onClick={onClearFinished}>
            清理已完成
          </button>
        )}
      </div>
    </aside>
  );
}
