import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, FileCheck2, Fingerprint, ListChecks } from 'lucide-react';
import { Composer } from './components/Composer';
import { HistoryPanel } from './components/HistoryPanel';
import { Processing } from './components/Processing';
import { ReportView } from './components/ReportView';
import { SettingsDialog } from './components/SettingsDialog';
import { TaskDock } from './components/TaskDock';
import { TaskError } from './components/TaskError';
import { TopBar } from './components/TopBar';
import { demoReport } from './lib/demo';
import { historyCount, onHistoryChange, type HistoryEntry } from './lib/history';
import {
  cancelTask,
  clearFinishedTasks,
  dismissTask,
  onSettingsPatched,
  pauseTask,
  resumeTask,
  startTask,
  useTasks,
} from './lib/task';
import { configOf, isConfigured, isVerified, loadSettings, presetOf, saveSettings } from './lib/settings';
import { runtimeLabel } from './lib/transport';
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

const DRAFT_KEY = 'veritas.draft.v1';

type View =
  | { kind: 'home' }
  | { kind: 'task'; id: string }
  | { kind: 'report'; report: Report; demo?: boolean; input?: string };

function loadDraft(): { input: string; mode: 'text' | 'url' } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { input: '', mode: 'text' };
    const parsed = JSON.parse(raw) as { input?: string; mode?: 'text' | 'url' };
    return { input: parsed.input ?? '', mode: parsed.mode === 'url' ? 'url' : 'text' };
  } catch {
    return { input: '', mode: 'text' };
  }
}

export default function App() {
  const draft = useMemo(loadDraft, []);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [mode, setMode] = useState<'text' | 'url'>(draft.mode);
  const [input, setInput] = useState(draft.input);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [histCount, setHistCount] = useState(() => historyCount());
  const [focusProvider, setFocusProvider] = useState<ProviderId | null>(null);
  const tasks = useTasks();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('demo')) setView({ kind: 'report', report: demoReport(), demo: true });
    if (params.get('panel') === 'settings') setSettingsOpen(true);
    if (params.get('panel') === 'history') setHistoryOpen(true);
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // 任务在后台验证通过后，把 verified 标记写回设置
  useEffect(() => {
    onSettingsPatched((next) => setSettings(next));
    return () => onSettingsPatched(null);
  }, []);

  useEffect(() => onHistoryChange(() => setHistCount(historyCount())), []);

  // 草稿留在本机，刷新页面不丢
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, mode }));
    } catch {
      /* 写不进就放弃 */
    }
  }, [input, mode]);

  // 打开的任务被移除时回到首页
  useEffect(() => {
    if (view.kind === 'task' && !tasks.some((t) => t.id === view.id)) setView({ kind: 'home' });
  }, [tasks, view]);

  const patchSettings = (patch: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...patch }));

  const openSettings = (id?: ProviderId) => {
    setFocusProvider(id ?? null);
    setSettingsOpen(true);
  };

  const pickProvider = (id: ProviderId) => setSettings((prev) => ({ ...prev, activeId: id }));

  const run = useCallback(() => {
    if (!isConfigured(settings)) {
      openSettings(settings.activeId);
      return;
    }
    const id = startTask({ settings, input, mode });
    setView({ kind: 'task', id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [settings, input, mode]);

  const rerun = (text: string, nextMode: 'text' | 'url' | 'auto' = 'auto') => {
    if (!text.trim()) return;
    if (!isConfigured(settings)) {
      openSettings(settings.activeId);
      return;
    }
    setInput(text);
    const resolved: 'text' | 'url' = nextMode === 'auto' ? (/^https?:\/\//i.test(text.trim()) ? 'url' : 'text') : nextMode;
    setMode(resolved);
    const id = startTask({ settings, input: text, mode: resolved });
    setView({ kind: 'task', id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goHome = () => {
    setView({ kind: 'home' });
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openHistoryEntry = (entry: HistoryEntry) => {
    setView({ kind: 'report', report: { ...entry.report, raw: '' }, input: entry.input });
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 快捷键：Esc 收起当前视图，⌘/Ctrl+K 历史，⌘/Ctrl+, 设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHistoryOpen(true);
      } else if (meta && e.key === ',') {
        e.preventDefault();
        openSettings();
      } else if (e.key === 'Escape' && !settingsOpen && !historyOpen && view.kind === 'task') {
        goHome();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, historyOpen, view]);

  const preset = presetOf(settings.activeId);
  const config = configOf(settings);
  const configured = isConfigured(settings);
  const verified = isVerified(settings);

  const activeTask = view.kind === 'task' ? tasks.find((t) => t.id === view.id) : undefined;
  const runningCount = tasks.filter((t) => t.status === 'running' || t.status === 'pausing').length;

  let body: ReactNode;

  if (view.kind === 'report') {
    body = (
      <ReportView
        report={view.report}
        demo={view.demo}
        onReset={goHome}
        onRerun={view.input ? () => rerun(view.input as string) : undefined}
        initialView={new URLSearchParams(window.location.search).get('view') === 'markdown' ? 'markdown' : 'report'}
      />
    );
  } else if (view.kind === 'task' && activeTask) {
    if (activeTask.status === 'done' && activeTask.report) {
      body = (
        <ReportView
          report={activeTask.report}
          onReset={goHome}
          onRerun={() => rerun(activeTask.input, activeTask.mode)}
        />
      );
    } else if (activeTask.status === 'error') {
      body = (
        <TaskError
          task={activeTask}
          onRetry={() => rerun(activeTask.input, activeTask.mode)}
          onBack={goHome}
          onOpenSettings={() => openSettings(settings.activeId)}
        />
      );
    } else if (activeTask.status === 'cancelled') {
      body = (
        <TaskError
          task={activeTask}
          cancelled
          onRetry={() => rerun(activeTask.input, activeTask.mode)}
          onBack={goHome}
          onOpenSettings={() => openSettings(settings.activeId)}
        />
      );
    } else {
      body = (
        <Processing
          task={activeTask}
          onPause={() => pauseTask(activeTask.id)}
          onResume={() => resumeTask(activeTask.id)}
          onCancel={() => cancelTask(activeTask.id)}
          onCollapse={goHome}
        />
      );
    }
  } else {
    body = (
      <>
        <section className="intro">
          <p className="eyebrow">Evidence, not vibes</p>
          <h1 className="display">
            把每一句话，
            <br />
            <span className="display-em">查到底</span>。
          </h1>
          <p className="lede">
            贴入一段文字，或者一个链接。Veritas 拆解段落、在应用内检索公开来源、逐条比对证据，
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
          runningCount={runningCount}
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
              setView({ kind: 'report', report: demoReport(), demo: true });
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
              }}
            >
              {ex.label}
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>

        {!configured ? (
          <p className="setup-hint">
            首次使用需要填写你自己的 API Key，
            <button type="button" className="link-btn" onClick={() => openSettings()}>
              选择模型
            </button>
            。Key 只保存在这台设备。
          </p>
        ) : !verified ? (
          <p className="setup-hint">
            {preset.name} · {config.model} 还没有测通过，
            <button type="button" className="link-btn" onClick={() => openSettings(settings.activeId)}>
              验证一下
            </button>
            ——第一次核查前会自动验证，不通过不会开跑。
          </p>
        ) : (
          <p className="setup-hint">
            快捷键：<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 开始核查，<kbd>⌘</kbd>/<kbd>Ctrl</kbd> +{' '}
            <kbd>K</kbd> 打开历史。核查可以随时收起，也能同时跑多个。
          </p>
        )}
      </>
    );
  }

  return (
    <div className={`app ${tasks.length ? 'app--dock' : ''}`}>
      <TopBar
        settings={settings}
        onOpenSettings={() => openSettings()}
        onOpenHistory={() => setHistoryOpen(true)}
        historyCount={histCount}
      />

      <main className={`shell ${view.kind === 'home' ? 'shell--idle' : ''}`}>{body}</main>

      <footer className="foot">
        <span>Veritas · 核查结果为辅助判断，重要结论请回到原始来源复核</span>
        <span className="foot-dim">
          {runtimeLabel()} · v{__APP_VERSION__} · 由你的模型驱动
        </span>
      </footer>

      <TaskDock
        tasks={tasks}
        activeId={view.kind === 'task' ? view.id : null}
        onOpen={(id) => {
          setView({ kind: 'task', id });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onPause={pauseTask}
        onResume={resumeTask}
        onCancel={cancelTask}
        onDismiss={(id) => {
          dismissTask(id);
        }}
        onClearFinished={clearFinishedTasks}
      />

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

      {historyOpen && <HistoryPanel onOpen={openHistoryEntry} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
