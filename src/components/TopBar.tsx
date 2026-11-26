import { Github, History, Settings2 } from 'lucide-react';
import { configOf, isConfigured, isVerified, presetOf } from '../lib/settings';
import type { Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  historyCount: number;
}

export function TopBar({ settings, onOpenSettings, onOpenHistory, historyCount }: Props) {
  const preset = presetOf(settings.activeId);
  const config = configOf(settings);
  const ready = isConfigured(settings);
  const verified = isVerified(settings);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="./" aria-label="Veritas 首页">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M12 2.6 21.4 12 12 21.4 2.6 12Z" stroke="currentColor" strokeWidth="1.4" />
              <path d="M12 7.2 16.8 12 12 16.8 7.2 12Z" fill="currentColor" opacity=".9" />
            </svg>
          </span>
          <span className="brand-text">
            <span className="brand-name">veritas</span>
            <span className="brand-tag">事实核查台</span>
          </span>
        </a>

        <div className="topbar-right">
          <button className="history-btn" onClick={onOpenHistory} type="button" title="查看核查历史">
            <History size={14} strokeWidth={1.9} />
            <span>历史</span>
            {historyCount > 0 && <span className="history-count">{historyCount > 99 ? '99+' : historyCount}</span>}
          </button>

          <button className="model-chip" onClick={onOpenSettings} type="button">
            <span className={`dot ${verified ? 'dot--on' : ready ? 'dot--warn' : 'dot--off'}`} />
            <span className="model-chip-name">{preset.name}</span>
            <span className="model-chip-model">{ready ? config.model : '未配置模型'}</span>
            <Settings2 size={13} strokeWidth={1.8} />
          </button>

          <a
            className="icon-btn"
            href="https://github.com/kkai726/veritas"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub"
          >
            <Github size={16} strokeWidth={1.8} />
          </a>
        </div>
      </div>
    </header>
  );
}
