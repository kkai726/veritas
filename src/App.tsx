import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, FileCheck2, Fingerprint, ListChecks, X } from 'lucide-react';
import { Composer } from './components/Composer';
import { Processing } from './components/Processing';
import { ReportView } from './components/ReportView';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { STAGE_TEXT, factCheck, type Stage } from './lib/pipeline';
import { demoReport } from './lib/demo';
import { runtimeLabel } from './lib/transport';
import { configOf, isConfigured, loadSettings, presetOf, saveSettings } from './lib/settings';
import type { ProviderId, Report, Settings } from './lib/types';

const EXAMPLES = [
  {
    label: '公共卫生',
    text: '2023 年 3 月，世界卫生组织正式宣布新冠疫情全球大流行结束。研究显示，全球约 65% 的成年人至少感染过一次新冠病毒。同期某制药公司公布的 III 期临床数据显示，其疫苗有效率达 97%，并已在 40 个国家获批上市。',
  },
  {
    label: 'AI 行业',
    text: 'GPT-4 于 2023 年 3 月发布，参数量为 1.8 万亿，训练成本约 6300 万美元。OpenAI 在 2024 年的营收达到 34 亿美元，其中企业版订阅贡献了超过一半收入。',
  },
  {
    label: '消费与健康',
    text: '每天喝 8 杯水是医学界的共识，因为人体每天必须排出约 2 升水分。此外，咖啡因会显著抑制儿童身高发育，所以 12 岁以下儿童应完全禁止饮用含咖啡因饮料。',
  },
];

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [mode, setMode] = useState<'text' | 'url'>('text');
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [stage, setStage] = useState<Stage>('analyze');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusProvider, setFocusProvider] = useState<ProviderId | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('demo')) {
      setReport(demoReport());
      setIsDemo(true);
      setPhase('done');
    }
    if (params.get('panel') === 'settings') setSettingsOpen(true);
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const patchSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const openSettings = (id?: ProviderId) => {
    setFocusProvider(id ?? null);
    setSettingsOpen(true);
  };

  const pickProvider = (id: ProviderId) => {
    setSettings((prev) => ({ ...prev, activeId: id }));
  };

  const run = useCallback(async () => {
    if (!isConfigured(settings)) {
      openSettings(settings.activeId);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setPhase('running');
    setStage(mode === 'url' ? 'extract' : settings.search ? 'research' : 'analyze');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const result = await factCheck({
        settings,
        input,
        mode,
        onStage: setStage,
        signal: ctrl.signal,
      });
      setReport(result);
      setPhase('done');
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase('idle');
        return;
      }
      const detail = err as { message?: string; hint?: string };
      setError({
        message: detail?.message || String(err),
        hint: detail?.hint,
      });
      setPhase('idle');
    } finally {
      abortRef.current = null;
    }
  }, [settings, input, mode]);

  const cancel = () => abortRef.current?.abort();

  const reset = () => {
    setReport(null);
    setError(null);
    setIsDemo(false);
    setPhase('idle');
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const preset = presetOf(settings.activeId);
  const config = configOf(settings);
  const configured = isConfigured(settings);

  return (
    <div className="app">
      <TopBar settings={settings} onOpenSettings={() => openSettings()} />

      <main className={`shell ${phase === 'idle' ? 'shell--idle' : ''}`}>
        {phase === 'done' && report ? (
          <ReportView
            report={report}
            onReset={reset}
            demo={isDemo}
            initialView={new URLSearchParams(window.location.search).get('view') === 'markdown' ? 'markdown' : 'report'}
          />
        ) : phase === 'running' ? (
          <Processing
            stage={stage}
            isUrl={mode === 'url'}
            search={settings.search && preset.supportsSearch}
            onCancel={cancel}
            providerLabel={preset.name}
            model={config.model}
          />
        ) : (
          <>
            <section className="intro">
              <p className="eyebrow">Evidence, not vibes</p>
              <h1 className="display">
                把每一句话，
                <br />
                <span className="display-em">查到底</span>。
              </h1>
              <p className="lede">
                贴入一段文字，或者一个链接。Veritas 拆解段落、联网检索公开来源、逐条比对证据，
                给出可信度评分、可追溯的引用，以及一份可直接引用的 Markdown 报告。
              </p>

              <ul className="pillars">
                <li>
                  <ListChecks size={15} strokeWidth={1.8} />
                  逐段判定，而不是一句「真 / 假」
                </li>
                <li>
                  <Fingerprint size={15} strokeWidth={1.8} />
                  每条陈述都挂到具体来源
                </li>
                <li>
                  <FileCheck2 size={15} strokeWidth={1.8} />
                  结果可导出为整洁 Markdown
                </li>
              </ul>
            </section>

            {error && (
              <div className="banner banner--error" role="alert">
                <AlertCircle size={15} />
                <div className="banner-body">
                  <span className="banner-msg">{error.message}</span>
                  {error.hint && <span className="banner-hint">{error.hint}</span>}
                </div>
                <div className="banner-side">
                  <button type="button" className="banner-action" onClick={() => openSettings(settings.activeId)}>
                    模型设置
                  </button>
                  <button type="button" className="banner-close" onClick={() => setError(null)} aria-label="关闭">
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}

            <Composer
              mode={mode}
              onModeChange={setMode}
              value={input}
              onValueChange={setInput}
              settings={settings}
              onSettingsChange={patchSettings}
              onRun={run}
              busy={false}
              configured={configured}
              onOpenSettings={() => openSettings()}
              onPickProvider={pickProvider}
              onConfigureProvider={(id) => openSettings(id)}
            />

            <div className="examples">
              <span className="examples-label">试一试</span>
              <button
                type="button"
                className="example example--demo"
                onClick={() => {
                  setReport(demoReport());
                  setIsDemo(true);
                  setPhase('done');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                示例报告
                <ArrowUpRight size={12} />
              </button>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="example"
                  onClick={() => {
                    setMode('text');
                    setInput(ex.text);
                    setError(null);
                    setIsDemo(false);
                  }}
                >
                  {ex.label}
                  <ArrowUpRight size={12} />
                </button>
              ))}
            </div>

            {!configured && (
              <p className="setup-hint">
                首次使用需要填写你自己的 API Key，
                <button type="button" className="link-btn" onClick={() => openSettings()}>
                  选择模型
                </button>
                。Key 只保存在这台设备的浏览器。
              </p>
            )}
          </>
        )}
      </main>

      <footer className="foot">
        <span>
          Veritas · 核查结果为辅助判断，重要结论请回到原始来源复核
        </span>
        <span className="foot-dim">
          {runtimeLabel()} · {STAGE_TEXT.compose} · 由你的模型驱动
        </span>
      </footer>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          initialProvider={focusProvider ?? undefined}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            setSettings(next);
            setSettingsOpen(false);
            setFocusProvider(null);
          }}
        />
      )}
    </div>
  );
}
