import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  PlugZap,
  X,
} from 'lucide-react';
import { PROVIDERS, presetOf, resolveBaseUrl } from '../lib/settings';
import { testConnection } from '../lib/providers';
import type { ProviderId, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const preset = useMemo(() => presetOf(draft.provider), [draft.provider]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const patch = (next: Partial<Settings>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setTestResult(null);
  };

  const pickProvider = (id: ProviderId) => {
    const p = presetOf(id);
    patch({
      provider: id,
      model: p.defaultModel || '',
      baseUrl: id === 'custom' ? draft.baseUrl : '',
      search: p.supportsSearch,
    });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const message = await testConnection(draft);
      setTestResult({ ok: true, message });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const canSave = Boolean(draft.apiKey.trim() && draft.model.trim() && resolveBaseUrl(draft));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" ref={panelRef} role="dialog" aria-modal="true" aria-label="模型设置">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Bring your own key</p>
            <h2 className="dialog-title">模型与检索</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="field">
            <label className="field-label">服务商</label>
            <div className="provider-grid">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`provider ${draft.provider === p.id ? 'is-active' : ''}`}
                  onClick={() => pickProvider(p.id)}
                >
                  <span className="provider-top">
                    <span className="provider-name">{p.name}</span>
                    {draft.provider === p.id && <Check size={13} strokeWidth={2.4} />}
                  </span>
                  <span className="provider-blurb">{p.blurb}</span>
                  <span className={`provider-tag ${p.supportsSearch ? 'is-live' : ''}`}>
                    {p.supportsSearch ? '支持联网' : '无联网'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="model">
                模型
              </label>
              <input
                id="model"
                className="input"
                list="veritas-models"
                value={draft.model}
                placeholder={preset.defaultModel || '例如 gpt-4.1'}
                onChange={(e) => patch({ model: e.target.value })}
              />
              <datalist id="veritas-models">
                {preset.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="apikey">
                API Key
              </label>
              <div className="input-wrap">
                <input
                  id="apikey"
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  placeholder={preset.keyHint}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                />
                <button
                  type="button"
                  className="input-suffix"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {draft.provider === 'custom' && (
            <div className="field">
              <label className="field-label" htmlFor="baseurl">
                Base URL
              </label>
              <input
                id="baseurl"
                className="input"
                value={draft.baseUrl}
                placeholder="https://your-gateway.com/v1"
                spellCheck={false}
                onChange={(e) => patch({ baseUrl: e.target.value })}
              />
              <p className="field-hint">需兼容 OpenAI 的 /chat/completions 接口。</p>
            </div>
          )}

          <label className={`search-row ${preset.supportsSearch ? '' : 'is-disabled'}`}>
            <input
              type="checkbox"
              checked={draft.search && preset.supportsSearch}
              disabled={!preset.supportsSearch}
              onChange={(e) => patch({ search: e.target.checked })}
            />
            <span>
              <strong>启用联网检索</strong>
              <em>{preset.supportsSearch ? `通过${preset.searchLabel}获取实时来源` : '当前服务商没有联网能力，将仅依赖模型知识'}</em>
            </span>
          </label>

          <div className="dialog-actions">
            <button type="button" className="ghost-btn" onClick={runTest} disabled={testing || !draft.apiKey || !draft.model}>
              {testing ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
              测试连接
            </button>
            {preset.keyUrl && (
              <a className="text-link" href={preset.keyUrl} target="_blank" rel="noreferrer noopener">
                获取 Key
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {testResult && (
            <p className={`test-result ${testResult.ok ? 'is-ok' : 'is-bad'}`}>{testResult.message}</p>
          )}

          <p className="privacy">
            <Lock size={12} strokeWidth={2} />
            Key 仅保存在本机浏览器的 localStorage，请求由浏览器直接发往服务商，不经过任何中间服务器。
          </p>
        </div>

        <div className="dialog-foot">
          <button type="button" className="link-btn" onClick={() => patch({ apiKey: '' })}>
            清除 Key
          </button>
          <div className="dialog-foot-right">
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="cta cta--sm"
              disabled={!canSave}
              onClick={() => onSave(draft)}
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
