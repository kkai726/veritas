import { ArrowRight, FileText, Link2, Loader2 } from 'lucide-react';
import type { Settings } from '../lib/types';
import { countChars } from '../lib/utils';

interface Props {
  mode: 'text' | 'url';
  onModeChange: (mode: 'text' | 'url') => void;
  value: string;
  onValueChange: (value: string) => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onRun: () => void;
  busy: boolean;
  configured: boolean;
  onOpenSettings: () => void;
}

const DEPTHS: { id: Settings['depth']; label: string; hint: string }[] = [
  { id: 'quick', label: '快速', hint: '最多 6 段，抓关键主张' },
  { id: 'standard', label: '标准', hint: '最多 10 段，逐条核对' },
  { id: 'deep', label: '深度', hint: '最多 14 段，交叉验证' },
];

export function Composer({
  mode,
  onModeChange,
  value,
  onValueChange,
  settings,
  onSettingsChange,
  onRun,
  busy,
  configured,
  onOpenSettings,
}: Props) {
  const chars = countChars(value);
  const canRun = chars >= 20 && !busy;

  const submit = () => {
    if (!configured) {
      onOpenSettings();
      return;
    }
    if (canRun) onRun();
  };

  return (
    <section className="composer" aria-label="核查输入">
      <div className="composer-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'text'}
          className={`tab ${mode === 'text' ? 'is-active' : ''}`}
          onClick={() => onModeChange('text')}
          type="button"
        >
          <FileText size={14} strokeWidth={1.8} />
          粘贴文本
        </button>
        <button
          role="tab"
          aria-selected={mode === 'url'}
          className={`tab ${mode === 'url' ? 'is-active' : ''}`}
          onClick={() => onModeChange('url')}
          type="button"
        >
          <Link2 size={14} strokeWidth={1.8} />
          输入链接
        </button>
      </div>

      {mode === 'text' ? (
        <textarea
          className="composer-input"
          value={value}
          spellCheck={false}
          placeholder="把需要核查的段落粘贴进来——新闻稿、社交媒体长文、产品宣传、研究报告都可以。"
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      ) : (
        <input
          className="composer-input composer-input--url"
          value={value}
          spellCheck={false}
          placeholder="https://example.com/article"
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}

      <div className="composer-foot">
        <div className="composer-controls">
          <div className="depth" role="group" aria-label="核查深度">
            {DEPTHS.map((d) => (
              <button
                key={d.id}
                type="button"
                title={d.hint}
                className={`depth-opt ${settings.depth === d.id ? 'is-active' : ''}`}
                onClick={() => onSettingsChange({ depth: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`toggle ${settings.search ? 'is-on' : ''}`}
            onClick={() => onSettingsChange({ search: !settings.search })}
            aria-pressed={settings.search}
          >
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
            联网检索
          </button>
        </div>

        <div className="composer-submit">
          <span className="counter">{chars ? `${chars} 字` : '⌘ + Enter'}</span>
          <button className="cta" onClick={submit} disabled={busy || (configured && chars < 20)} type="button">
            {busy && <Loader2 className="spin" size={15} />}
            {busy ? '核查中' : configured ? '开始核查' : '配置模型'}
            {!busy && <ArrowRight size={15} strokeWidth={2} />}
          </button>
        </div>
      </div>
    </section>
  );
}
