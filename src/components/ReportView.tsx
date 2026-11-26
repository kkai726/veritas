import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  HelpCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { Claim, ClaimVerdict, Paragraph, Report, Source } from '../lib/types';
import { VERDICT_LABEL, bandOf } from '../lib/types';
import { faviconOf, formatElapsed, formatTime, hostOf } from '../lib/utils';
import { ScoreRing } from './ScoreRing';

interface Props {
  report: Report;
  onReset: () => void;
  demo?: boolean;
  initialView?: 'report' | 'markdown';
}

const VERDICT_TONE: Record<ClaimVerdict, string> = {
  supported: 'good',
  partial: 'warn',
  unsupported: 'muted',
  contradicted: 'bad',
  unknown: 'muted',
};

const VERDICT_ICON = {
  supported: CheckCircle2,
  partial: CircleDot,
  unsupported: CircleDashed,
  contradicted: XCircle,
  unknown: HelpCircle,
} as const;

function CiteLinks({ ids, sources }: { ids: number[]; sources: Source[] }) {
  if (!ids.length) return null;
  return (
    <span className="cites">
      {ids.map((id) => {
        const src = sources.find((s) => s.id === id);
        if (!src) return null;
        return (
          <a
            key={id}
            className="cite"
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            title={src.title}
          >
            {id}
          </a>
        );
      })}
    </span>
  );
}

function ClaimRow({ claim, sources }: { claim: Claim; sources: Source[] }) {
  const Icon = VERDICT_ICON[claim.verdict];
  return (
    <li className={`claim claim--${VERDICT_TONE[claim.verdict]}`}>
      <Icon className="claim-icon" size={15} strokeWidth={1.9} />
      <div className="claim-body">
        <p className="claim-text">
          {claim.text}
          <CiteLinks ids={claim.sourceIds} sources={sources} />
        </p>
        {claim.note && <p className="claim-note">{claim.note}</p>}
      </div>
      <span className="claim-tag">{VERDICT_LABEL[claim.verdict]}</span>
    </li>
  );
}

function ParagraphCard({ paragraph, sources }: { paragraph: Paragraph; sources: Source[] }) {
  const band = bandOf(paragraph.score);
  return (
    <article className="para">
      <div className="para-head">
        <span className="para-index">{String(paragraph.index).padStart(2, '0')}</span>
        <span className={`chip chip--${band.tone}`}>{band.label}</span>
        <span className="para-score">
          {paragraph.score}
          <em>/100</em>
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <span className={`bar-fill bar-fill--${band.tone}`} style={{ width: `${paragraph.score}%` }} />
      </div>
      {paragraph.text && <blockquote className="quote">{paragraph.text}</blockquote>}
      {paragraph.summary && <p className="analysis">{paragraph.summary}</p>}
      {paragraph.claims.length > 0 && (
        <ul className="claims">
          {paragraph.claims.map((claim, i) => (
            <ClaimRow key={`${paragraph.index}-${i}`} claim={claim} sources={sources} />
          ))}
        </ul>
      )}
    </article>
  );
}

function SourceCard({ source }: { source: Source }) {
  const [broken, setBroken] = useState(false);
  return (
    <a className="source-card" href={source.url} target="_blank" rel="noreferrer noopener">
      <span className="source-favicon">
        {broken ? (
          <span className="source-favicon-fallback">{hostOf(source.url).slice(0, 1).toUpperCase()}</span>
        ) : (
          <img src={faviconOf(source.url)} alt="" onError={() => setBroken(true)} loading="lazy" />
        )}
      </span>
      <span className="source-main">
        <span className="source-title">{source.title}</span>
        <span className="source-meta">
          {source.publisher}
          {source.cited.length ? ` · 第 ${source.cited.join('、')} 段` : ' · 检索命中'}
        </span>
      </span>
      <ExternalLink className="source-link" size={13} />
    </a>
  );
}

function MarkdownPanel({ report, onCopy, copied }: { report: Report; onCopy: () => void; copied: boolean }) {
  return (
    <div className="md-panel">
      <div className="md-toolbar">
        <span className="md-label">Markdown 预览</span>
        <button className="ghost-btn ghost-btn--sm" type="button" onClick={onCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制全文'}
        </button>
      </div>
      <div className="md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

export function ReportView({ report, onReset, demo = false, initialView = 'report' }: Props) {
  const [view, setView] = useState<'report' | 'markdown'>(initialView);
  const [copied, setCopied] = useState(false);
  const band = bandOf(report.overallScore);

  const claimCount = useMemo(
    () => report.paragraphs.reduce((acc, p) => acc + p.claims.length, 0),
    [report],
  );
  const citedCount = useMemo(() => report.sources.filter((s) => s.cited.length).length, [report]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const download = () => {
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veritas-${report.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="report">
      {demo && (
        <div className="demo-note">
          这是示例报告，用内置样例数据展示输出结构；填入 API Key 后可核查你自己的文本。
        </div>
      )}
      <div className="report-head">
        <div className="report-head-main">
          <p className="eyebrow">Fact-check report</p>
          <h1 className="report-title">{report.title}</h1>
          <p className="report-meta">
            {report.meta.providerName} · {report.meta.model}
            {report.meta.searchUsed ? ' · 联网' : ' · 离线'}
            {' · '}
            {formatTime(report.meta.createdAt)}
            {' · '}
            {formatElapsed(report.meta.elapsedMs)}
            {report.meta.sourceUrl && (
              <>
                {' · '}
                <a href={report.meta.sourceUrl} target="_blank" rel="noreferrer noopener" className="meta-link">
                  {hostOf(report.meta.sourceUrl)}
                </a>
              </>
            )}
          </p>
          <p className={`tldr tldr--${band.tone}`}>{report.tldr}</p>

          <div className="stat-strip">
            <div className="stat">
              <span className="stat-num">{report.paragraphs.length}</span>
              <span className="stat-label">段落</span>
            </div>
            <div className="stat">
              <span className="stat-num">{claimCount}</span>
              <span className="stat-label">可核实陈述</span>
            </div>
            <div className="stat">
              <span className="stat-num">{report.sources.length}</span>
              <span className="stat-label">来源</span>
            </div>
            <div className="stat">
              <span className="stat-num">{citedCount}</span>
              <span className="stat-label">直接引用</span>
            </div>
          </div>
        </div>

        <div className="report-score">
          <ScoreRing score={report.overallScore} />
          <span className="score-caption">综合可信度</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'report'}
            className={view === 'report' ? 'is-active' : ''}
            onClick={() => setView('report')}
          >
            核查结果
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'markdown'}
            className={view === 'markdown' ? 'is-active' : ''}
            onClick={() => setView('markdown')}
          >
            Markdown
          </button>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="ghost-btn ghost-btn--sm" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button type="button" className="ghost-btn ghost-btn--sm" onClick={download}>
            <Download size={13} />
            下载 .md
          </button>
          <button type="button" className="ghost-btn ghost-btn--sm" onClick={onReset}>
            <RotateCcw size={13} />
            新核查
          </button>
        </div>
      </div>

      {view === 'report' ? (
        <>
          <div className="para-list">
            {report.paragraphs.map((p) => (
              <ParagraphCard key={p.index} paragraph={p} sources={report.sources} />
            ))}
          </div>

          {report.sources.length > 0 && (
            <section className="section">
              <h2 className="section-title">
                来源清单
                <span className="section-count">{report.sources.length}</span>
              </h2>
              <div className="source-grid">
                {report.sources.map((s) => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </section>
          )}

          {report.limitations.length > 0 && (
            <section className="section">
              <h2 className="section-title">核查局限</h2>
              <ul className="limits">
                {report.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <MarkdownPanel report={report} onCopy={copy} copied={copied} />
      )}
    </section>
  );
}
