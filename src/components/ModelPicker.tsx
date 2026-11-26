import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { MAIN_PROVIDERS, configOf, isConfigured, presetOf } from '../lib/settings';
import type { ProviderId, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onPick: (id: ProviderId) => void;
  onConfigure: (id: ProviderId) => void;
  disabled?: boolean;
}

export function ModelPicker({ settings, onPick, onConfigure, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const preset = presetOf(settings.activeId);
  const config = configOf(settings);
  const ready = isConfigured(settings);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: ProviderId) => {
    if (isConfigured(settings, id)) onPick(id);
    else onConfigure(id);
    setOpen(false);
  };

  return (
    <div className="model-pick" ref={ref}>
      <button
        type="button"
        className={`model-trigger ${ready ? '' : 'is-empty'}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={ready ? `${preset.name} · ${config.model}` : '还没有配置模型'}
      >
        <span className="model-trigger-text">
          <span className="model-trigger-name">{ready ? preset.name : '选择模型'}</span>
          <span className="model-trigger-sub">{ready ? config.model : '未配置'}</span>
        </span>
        <ChevronDown size={13} strokeWidth={2} className={open ? 'is-flip' : ''} />
      </button>

      {open && (
        <div className="model-menu" role="listbox" aria-label="选择模型">
          <p className="model-menu-label">模型</p>
          {MAIN_PROVIDERS.map((p) => {
            const ok = isConfigured(settings, p.id);
            const c = configOf(settings, p.id);
            const active = settings.activeId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`model-item ${active && ok ? 'is-active' : ''}`}
                onClick={() => choose(p.id)}
              >
                <span className="model-item-text">
                  <span className="model-item-name">{p.name}</span>
                  <span className="model-item-sub">{ok ? c.model : '未配置 Key'}</span>
                </span>
                {ok ? (
                  active ? (
                    <Check size={14} strokeWidth={2.4} className="model-item-check" />
                  ) : null
                ) : (
                  <span className="model-item-add">配置</span>
                )}
              </button>
            );
          })}

          <div className="model-menu-sep" />

          <button
            type="button"
            className="model-item model-item--ghost"
            onClick={() => {
              onConfigure('custom');
              setOpen(false);
            }}
          >
            <Plus size={13} strokeWidth={2} />
            <span className="model-item-text">
              <span className="model-item-name">配置自定义模型</span>
              <span className="model-item-sub">任何 OpenAI 兼容接口</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
