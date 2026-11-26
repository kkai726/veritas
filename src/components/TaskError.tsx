import { AlertCircle, RotateCcw, Settings2, XCircle } from 'lucide-react';
import type { RunTask } from '../lib/task';
import { formatElapsed } from '../lib/utils';

interface Props {
  task: RunTask;
  cancelled?: boolean;
  onRetry: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
}

export function TaskError({ task, cancelled = false, onRetry, onBack, onOpenSettings }: Props) {
  return (
    <section className="processing processing--error">
      <div className="proc-head">
        <div className="proc-head-main">
          <p className="eyebrow">{cancelled ? 'Cancelled' : 'Failed'}</p>
          <h2 className="proc-title">{cancelled ? '核查已取消' : '这次核查没有完成'}</h2>
          <p className="proc-sub">
            {task.providerName} · {task.model} · {formatElapsed(task.elapsedMs)}
          </p>
        </div>
      </div>

      <p className="proc-task-title">{task.title}</p>

      {cancelled ? (
        <p className="proc-error-msg">任务在完成前被取消，没有生成报告。输入内容还留着，可以重新跑一次。</p>
      ) : (
        <div className="proc-error-body">
          <p className="proc-error-msg">
            <XCircle size={15} />
            {task.error?.message || '未知错误'}
          </p>
          {task.error?.hint && (
            <p className="proc-error-hint">
              <AlertCircle size={13} />
              {task.error.hint}
            </p>
          )}
        </div>
      )}

      <div className="proc-error-actions">
        <button type="button" className="cta cta--sm" onClick={onRetry}>
          <RotateCcw size={13} />
          重新核查
        </button>
        <button type="button" className="ghost-btn" onClick={onOpenSettings}>
          <Settings2 size={13} />
          模型设置
        </button>
        <button type="button" className="ghost-btn" onClick={onBack}>
          返回首页
        </button>
      </div>

      <p className="proc-note">
        任务会保留在右下角的任务卡里，点开可以重试或移除；已完成的其他任务不受影响。
      </p>
    </section>
  );
}
