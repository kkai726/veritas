import type { Claim, ClaimVerdict, Paragraph, Report, Source } from './types';
import { VERDICT_LABEL, bandOf } from './types';
import { formatTime } from './utils';

type ReportData = Omit<Report, 'markdown' | 'raw'>;

const VERDICT_ICON: Record<ClaimVerdict, string> = {
  supported: '✓',
  partial: '◐',
  unsupported: '○',
  contradicted: '✕',
  unknown: '?',
};

function clean(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

function cite(ids: number[]): string {
  if (!ids.length) return '';
  return ids.map((id) => `[${id}]`).join('');
}

function sourceLabel(source: Source): string {
  return `[${source.title}](${source.url})`;
}

function claimLine(claim: Claim): string {
  const badge = `**${VERDICT_ICON[claim.verdict]} ${VERDICT_LABEL[claim.verdict]}**`;
  const note = claim.note ? ` — ${clean(claim.note)}` : '';
  const refs = cite(claim.sourceIds);
  return `- ${badge} ${clean(claim.text)}${note}${refs ? ` ${refs}` : ''}`;
}

function paragraphBlock(p: Paragraph): string {
  const lines: string[] = [];
  const band = bandOf(p.score);
  lines.push(`### ${p.index}. ${band.label} · ${p.score}/100`);
  lines.push('');
  if (p.text) {
    lines.push(`> ${clean(p.text)}`);
    lines.push('');
  }
  if (p.summary) {
    lines.push(`**判定** — ${clean(p.summary)}`);
    lines.push('');
  }
  if (p.claims.length) {
    lines.push(...p.claims.map(claimLine));
    lines.push('');
  }
  return lines.join('\n');
}

function tally(claims: Claim[]): Record<ClaimVerdict, number> {
  const base: Record<ClaimVerdict, number> = {
    supported: 0,
    partial: 0,
    unsupported: 0,
    contradicted: 0,
    unknown: 0,
  };
  for (const c of claims) base[c.verdict] += 1;
  return base;
}

export function buildMarkdown(data: ReportData): string {
  const { meta } = data;
  const band = bandOf(data.overallScore);
  const claims = data.paragraphs.flatMap((p) => p.claims);
  const counts = tally(claims);
  const domains = new Set(data.sources.map((s) => s.publisher).filter(Boolean));

  const out: string[] = [];

  out.push(`# 事实核查报告 · ${clean(data.title)}`);
  out.push('');
  out.push(
    `> **综合可信度 ${data.overallScore}/100 — ${band.label}**  `,
  );
  out.push(
    `> ${clean(data.tldr)}`,
  );
  out.push('');

  out.push('| 项目 | 内容 |');
  out.push('| :--- | :--- |');
  out.push(`| 核查对象 | ${meta.inputType === 'url' && meta.sourceUrl ? `[${clean(meta.sourceUrl)}](${meta.sourceUrl})` : '用户粘贴的文本'} |`);
  out.push(`| 段落 / 可核实陈述 | ${data.paragraphs.length} 段 / ${claims.length} 条 |`);
  out.push(
    `| 判定分布 | 有据支持 ${counts.supported} · 部分支持 ${counts.partial} · 缺乏证据 ${counts.unsupported} · 与证据矛盾 ${counts.contradicted} · 无法核实 ${counts.unknown} |`,
  );
  out.push(`| 引用来源 | ${data.sources.length} 条 · ${domains.size} 个站点 |`);
  if (meta.authority?.total) {
    out.push(
      `| 权威来源 | 命中名录 ${meta.authority.total} 条 · 权威度 ≥ 0.9 共 ${meta.authority.tier1} 条 · 已被引用 ${meta.authority.cited} 条 |`,
    );
  }
  if (meta.sourceAuthority) {
    out.push(`| 原文出处 | 命中权威名录：${meta.sourceAuthority.label} |`);
  }
  out.push(`| 核查模型 | ${meta.providerName} · ${meta.model} |`);
  const ev = meta.evidence;
  out.push(
    `| 检索 | ${
      ev && ev.queries
        ? `${ev.queries} 次查询 · 命中 ${ev.hits} 条 · 精读 ${ev.pages} 篇${ev.engines.length ? ` · ${ev.engines.join(' / ')}` : ''}`
        : meta.searchUsed
          ? '由模型自带联网检索完成'
          : '未取到可引用来源'
    } |`,
  );
  out.push(`| 生成时间 | ${formatTime(meta.createdAt)} |`);
  out.push('');

  out.push('## 逐段核查');
  out.push('');
  for (const p of data.paragraphs) {
    out.push(paragraphBlock(p));
  }

  if (data.sources.length) {
    out.push('## 来源清单');
    out.push('');
    data.sources.forEach((s) => {
      const used = s.cited.length ? ` · 用于第 ${s.cited.join('、')} 段` : '';
      const publisher = s.publisher ? ` — ${clean(s.publisher)}` : '';
      const rank = s.authority ? ` · ${s.authority.label}` : '';
      out.push(`${s.id}. ${sourceLabel(s)}${publisher}${rank}${used}`);
    });
    out.push('');
  }

  if (data.limitations.length) {
    out.push('## 核查局限');
    out.push('');
    data.limitations.forEach((item) => out.push(`- ${clean(item)}`));
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(
    `<sub>由 Veritas 事实核查工作台生成 · 模型：${meta.model}${meta.searchUsed ? '（联网）' : ''} · ${formatTime(meta.createdAt)}。核查结果依赖公开来源与模型判断，请结合原始资料自行复核。</sub>`,
  );

  return out.join('\n');
}
