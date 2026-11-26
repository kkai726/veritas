import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  PlugZap,
  Trash2,
  X,
} from 'lucide-react';
import {
  PROVIDERS,
  clearVerified,
  configOf,
  isConfigured,
  isVerified,
  markVerified,
  presetOf,
} from '../lib/settings';
import { testConnection } from '../lib/providers';
import { runtime, runtimeLabel } from '../lib/transport';
import type { ProviderId, Settings } from '../lib/types';
import { formatTime } from '../lib/utils';

interface Props {
  settings: Settings;
  initialProvider?: ProviderId;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, initialProvider, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [selected, setSelected] = useState<ProviderId>(initialProvider || settings.activeId);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const preset = useMemo(() => presetOf(selected), [selected]);
  const config = useMemo(() => configOf(draft, selected), [draft, selected]);
  const configured = isConfigured(draft, selected);
  const verified = isVerified(draft, selected);
  const mark = draft.verified?.[selected];
  const onWeb = runtime() === 'web';

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

  const patchConfig = (next: Partial<typeof config>) => {
    setDraft((prev) => {
      const nextConfig = { ...configOf(prev, selected), ...next };
      const stillVerified =
        prev.verified?.[selected]?.model === nextConfig.model && Boolean(nextConfig.apiKey);
      const verifiedMap = { ...prev.verified };
      if (!stillVerified) delete verifiedMap[selected];
      return {
        ...prev,
        verified: verifiedMap,
        configs: { ...prev.configs, [selected]: nextConfig },
      };
    });
    setTestResult(null);
  };

  const pickProvider = (id: ProviderId) => {
    setSelected(id);
    setShowKey(false);
    setTestResult(null);
  };

  const clearKey = () => {
    setDraft((prev) => {
      const configs = { ...prev.configs };
      delete configs[selected];
      return clearVerified({ ...prev, configs }, selected);
    });
    setTestResult(null);
  };

  const runTest = async (source: Settings = draft): Promise<boolean> => {
    setTesting(true);
    setTestResult(null);
    try {
      const message = await testConnection(selected, configOf(source, selected));
      setDraft((prev) => markVerified(prev, selected, configOf(prev, selected).model));
      setTestResult({ ok: true, message });
      return true;
    } catch (err) {
      const e = err as { message?: string; hint?: string };
      setTestResult({ ok: false, message: [e.message, e.hint].filter(Boolean).join(' — ') });
      return false;
    } finally {
      setTesting(false);
    }
  };

  // 保存时会先跑一次连通性测试：没测通的模型不进核查流程
  const save = async () => {
    const next: Settings = {
      ...draft,
      activeId: isConfigured(draft, selected) ? selected : draft.activeId,
    };
    if (!isConfigured(next, selected) || isVerified(next, selected)) {
      onSave(next);
      return;
    }
    setSaving(true);
    const ok = await runTest(next);
    setSaving(false);
    if (!ok) return;
    const model = configOf(next, selected).model;
    onSave(markVerified(next, selected, model));
  };

  const busy = testing || saving;
  const canSave = configured || Boolean(draft.configs[draft.activeId]?.apiKey);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="模型设置">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Bring your own key</p>
            <h2 className="dialog-title">模型设置</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="field">
            <label className="field-label">服务商</label>
            <div className="provider-grid">
              {PROVIDERS.map((p) => {
                const ready = isConfigured(draft, p.id);
                const ok = isVerified(draft, p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`provider ${selected === p.id ? 'is-active' : ''}`}
                    onClick={() => pickProvider(p.id)}
                  >
                    <span className="provider-top">
                      <span className="provider-name">{p.name}</span>
                      {selected === p.id ? (
                        <Check size={13} strokeWidth={2.4} />
                      ) : ok ? (
                        <CheckCircle2 size={13} strokeWidth={2.2} className="provider-ok" />
                      ) : ready ? (
                        <span className="provider-ready" title="已配置" />
                      ) : null}
                    </span>
                    <span className="provider-blurb">{p.blurb}</span>
                  </button>
                );
              })}
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
                list={`models-${selected}`}
                value={config.model}
                placeholder={preset.defaultModel || '例如 deepseek-chat'}
                onChange={(e) => patchConfig({ model: e.target.value })}
              />
              <datalist id={`models-${selected}`}>
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
                  value={config.apiKey}
                  placeholder={preset.keyHint}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => patchConfig({ apiKey: e.target.value })}
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

          <div className="field">
            <label className="field-label" htmlFor="baseurl">
              接口地址
              <span className="field-optional">可选</span>
            </label>
            <input
              id="baseurl"
              className="input"
              value={config.baseUrl}
              placeholder={preset.baseUrl || 'https://your-gateway.com/v1'}
              spellCheck={false}
              onChange={(e) => patchConfig({ baseUrl: e.target.value })}
            />
            <p className="field-hint">
              {preset.baseUrl
                ? `留空即直连 ${preset.baseUrl}；走中转站或自建网关时把地址填这里。`
                : '自定义服务商必须填，例如 https://your-gateway.com/v1，需兼容 /chat/completions。'}
            </p>
          </div>

          {selected === 'openai' && onWeb && (
            <div className="notice">
              <Info size={15} strokeWidth={1.9} />
              <div className="notice-body">
                <strong>网页端无法直连 OpenAI</strong>
                <span>
                  官方接口的响应不带 CORS 头，浏览器只能拿到 Failed to fetch。桌面端与安卓端在系统层发请求，不受这个限制；也可以在
                  「接口地址」里填自建网关（仓库
                  <a href="https://github.com/kkai726/veritas/tree/main/worker" target="_blank" rel="noreferrer noopener">
                    worker/
                  </a>
                  目录）。
                </span>
              </div>
            </div>
          )}

          <div className="verify-row">
            {verified ? (
              <span className="verify-ok">
                <CheckCircle2 size={14} strokeWidth={2.2} />
                已验证可用{mark ? `（${formatTime(mark.at)}）` : ''}
              </span>
            ) : (
              <span className="verify-idle">
                <Info size={14} strokeWidth={1.9} />
                保存时会先测一次连通性，通过后才用于核查
              </span>
            )}
          </div>

          <div className="dialog-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void runTest()}
              disabled={busy || !config.apiKey || !config.model}
            >
              {testing ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}
              测试连接
            </button>
            {preset.keyUrl && (
              <a className="text-link" href={preset.keyUrl} target="_blank" rel="noreferrer noopener">
                获取 Key
                <ExternalLink size={12} />
              </a>
            )}
            {config.apiKey && (
              <button type="button" className="text-link text-link--danger" onClick={clearKey}>
                <Trash2 size={12} />
                清除这家的 Key
              </button>
            )}
          </div>

          {testResult && (
            <p className={`test-result ${testResult.ok ? 'is-ok' : 'is-bad'}`}>{testResult.message}</p>
          )}

          <p className="privacy">
            <Lock size={12} strokeWidth={2} />
            Key 缓存在本机（{runtimeLabel()} · localStorage），按服务商分别保存；切换模型不会丢，也不会传到任何服务器。
          </p>
        </div>

        <div className="dialog-foot">
          <span className="dialog-foot-note">
            {verified
              ? `${preset.name} · ${config.model} · 已验证`
              : isConfigured(draft, selected)
                ? `${preset.name} · ${config.model} · 待验证`
                : '选一个服务商，填好 Key 即可'}
          </span>
          <div className="dialog-foot-right">
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="cta cta--sm" disabled={!canSave || busy} onClick={() => void save()}>
              {saving && <Loader2 size={14} className="spin" />}
              {saving ? '验证中' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
