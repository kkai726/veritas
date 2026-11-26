import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { Stage } from '../lib/pipeline';

interface Props {
  stage: Stage;
  isUrl: boolean;
  onCancel: () => void;
  providerLabel: string;
  model: string;
}

const ORDER: Stage[] = ['verify', 'extract', 'research', 'analyze', 'compose'];

const LABEL: Record<Stage, string> = {
  verify: '验证模型可用',
  extract: '读取链接正文',
  research: '检索公开来源',
  analyze: '逐段比对证据',
  compose: '编排核查报告',
};

export function Processing({ stage, isUrl, onCancel, providerLabel, model }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(timer);
  }, []);

  const stages = ORDER.filter((s) => (s === 'extract' ? isUrl : true));
  const currentIndex = stages.indexOf(stage);

  return (
    <section className="processing" aria-live="polite">
      <div className="proc-head">
        <div>
          <p className="eyebrow">Working</p>
          <h2 className="proc-title">正在核查</h2>
          <p className="proc-sub">
            {providerLabel} · {model} · {(elapsed / 1000).toFixed(1)}s
          </p>
        </div>
        <button className="ghost-btn" onClick={onCancel} type="button">
          <X size={14} />
          取消
        </button>
      </div>

      <ol className="steps">
        {stages.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={s} className={`step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
              <span className="step-mark">
                {done ? <Check size={12} strokeWidth={3} /> : active ? <Loader2 size={12} className="spin" /> : null}
              </span>
              <span className="step-label">{LABEL[s]}</span>
              {active && <span className="step-bar" />}
            </li>
          );
        })}
      </ol>

      <p className="proc-note">
        检索在应用内完成，抓到的证据只以摘要形式交给模型，比模型自己联网更省额度。通常需要 20–90 秒。
      </p>
    </section>
  );
}
