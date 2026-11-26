#!/usr/bin/env python
"""从权威机构名录 xlsx 生成 src/lib/authority.ts。

用法：
    python scripts/gen-authority.py [xlsx 路径]

表格结构（见 README）：
    「1 论文收录与检索平台」B=类别 C=名称 F=官网
    「2 学术媒体与资讯」    B=类别 C=名称 F=官网
    「3 权威机构与评价体系」B=类别 C=名称 F=官网
其余两张是说明页，跳过。
"""

import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
DOC_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "authority.ts")

# 类别 → (score, label, kind)
TIERS = {
    # 论文收录与检索
    "全文平台": (0.98, "同行评议期刊", "peer-reviewed"),
    "学科库": (0.95, "学科索引", "index"),
    "综合引文索引": (0.92, "引文索引", "index"),
    "期刊评价": (0.9, "期刊评价", "index"),
    "收录查询": (0.9, "收录查询", "index"),
    "期刊目录": (0.88, "期刊目录", "index"),
    "中文库": (0.88, "中文数据库", "index"),
    "中文评价": (0.86, "中文评价", "index"),
    "文献发现平台": (0.86, "开放学术数据", "index"),
    "开放学术图谱": (0.84, "开放学术数据", "index"),
    "开放获取聚合": (0.84, "开放获取库", "index"),
    "元数据基础设施": (0.88, "元数据源", "index"),
    "语义检索": (0.8, "学术搜索", "index"),
    "综合学术搜索": (0.72, "学术搜索", "index"),
    "学位论文": (0.75, "学位论文库", "index"),
    "预印本": (0.6, "预印本（未经同行评审）", "preprint"),
    "科研工具": (0.35, "科研工具", "tool"),
    # 学术媒体
    "国际·综合科学": (0.76, "科学媒体", "media"),
    "国际·学科": (0.76, "学科媒体", "media"),
    "国际·诚信监督": (0.8, "科研诚信监督", "media"),
    "国际·出版行业": (0.6, "出版行业媒体", "media"),
    "国际·高等教育": (0.58, "高教媒体", "media"),
    "国际·职业发展": (0.5, "职业媒体", "media"),
    "国际·计量": (0.5, "计量平台", "media"),
    "中文·科学媒体": (0.7, "中文科学媒体", "media"),
    "中文·学科媒体": (0.66, "中文学科媒体", "media"),
    "中文·高等教育": (0.56, "中文高教媒体", "media"),
    # 权威机构与评价体系
    "国际组织与政府机构": (0.98, "政府 / 国际组织", "official"),
    "国家级文献信息机构": (0.97, "国家级机构", "official"),
    "学会与学术团体": (0.95, "学会", "official"),
    "商业数据库与出版商": (0.92, "出版商 / 数据库", "official"),
    "出版伦理与标准组织": (0.9, "标准 / 伦理组织", "official"),
    "中文数据库商": (0.85, "中文数据库商", "official"),
    "大学与机构排名": (0.65, "排名机构", "media"),
}

# 个别条目的类别不足以表达其性质，单独覆盖
OVERRIDES = {
    # 学术搜索 / 工具类：可检索，但不是一手来源
    "scholar.google.com": (0.72, "学术搜索", "index"),
    "app.dimensions.ai": (0.8, "开放学术数据", "index"),
    "www.lens.org": (0.8, "开放学术数据", "index"),
    "openalex.org": (0.84, "开放学术数据", "index"),
    "www.semanticscholar.org": (0.8, "学术搜索", "index"),
    "www.crossref.org": (0.9, "元数据源", "index"),
    "core.ac.uk": (0.84, "开放获取库", "index"),
    "www.base-search.net": (0.82, "开放获取库", "index"),
    "doaj.org": (0.88, "期刊目录", "index"),
    "orcid.org": (0.4, "身份标识", "tool"),
    "www.researchgate.net": (0.35, "学术社交", "tool"),
    "www.academia.edu": (0.35, "学术社交", "tool"),
    "www.zotero.org": (0.3, "科研工具", "tool"),
    "www.mendeley.com": (0.3, "科研工具", "tool"),
    "endnote.com": (0.3, "科研工具", "tool"),
    "www.connectedpapers.com": (0.35, "科研工具", "tool"),
    "www.researchrabbit.ai": (0.35, "科研工具", "tool"),
    "www.litmaps.com": (0.35, "科研工具", "tool"),
    "www.ithenticate.com": (0.4, "查重工具", "tool"),
    "www.scilit.com": (0.6, "元数据源", "index"),
    "pubpeer.com": (0.72, "同行质疑平台", "media"),
    "retractionwatch.com": (0.8, "撤稿监测", "media"),
    "arxiv.org": (0.65, "预印本（未经同行评审）", "preprint"),
    "www.biorxiv.org": (0.62, "预印本（未经同行评审）", "preprint"),
    "www.medrxiv.org": (0.62, "预印本（未经同行评审）", "preprint"),
    "chemrxiv.org": (0.6, "预印本（未经同行评审）", "preprint"),
    "www.researchsquare.com": (0.58, "预印本（未经同行评审）", "preprint"),
    "www.chinaxiv.org": (0.58, "预印本（未经同行评审）", "preprint"),
    "www.preprints.org": (0.55, "预印本（未经同行评审）", "preprint"),
}

SKIP_CATEGORIES = {"科研工具"}

# 名录之外、但事实核查里经常作为一手来源出现的一小撮站点。
# 只补公认的政府 / 国际组织 / 系统综述 / 顶级学会，不补媒体与聚合站。
SUPPLEMENT = {
    "cdc.gov": (0.97, "政府 / 国际组织", "official"),
    "un.org": (0.97, "政府 / 国际组织", "official"),
    "cochrane.org": (0.96, "系统综述", "peer-reviewed"),
    "cochranelibrary.com": (0.96, "系统综述", "peer-reviewed"),
    "europa.eu": (0.95, "政府 / 国际组织", "official"),
    "nasa.gov": (0.95, "政府 / 国际组织", "official"),
    "noaa.gov": (0.95, "政府 / 国际组织", "official"),
    "usgs.gov": (0.94, "政府 / 国际组织", "official"),
    "aap.org": (0.93, "学会", "official"),
    "plos.org": (0.95, "同行评议期刊", "peer-reviewed"),
    "mayoclinic.org": (0.85, "医疗机构", "official"),
    "stats.gov.cn": (0.96, "国家级机构", "official"),
}


def read_sheets(path):
    """返回 {sheet_name: [[cell, ...], ...]}"""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {}
        for rel in rels.findall(f"{REL_NS}Relationship"):
            targets[rel.get("Id")] = rel.get("Target")

        out = {}
        for sheet in wb.find(f"{NS}sheets").findall(f"{NS}sheet"):
            name = sheet.get("name")
            rid = sheet.get(f"{DOC_REL}id")
            target = targets.get(rid, "")
            if not target:
                continue
            if not target.startswith("xl/"):
                target = "xl/" + target.lstrip("/")
            if target not in z.namelist():
                continue
            root = ET.fromstring(z.read(target))
            rows = []
            for row in root.iter(f"{NS}row"):
                cells = {}
                for c in row.findall(f"{NS}c"):
                    ref = c.get("r", "")
                    col = re.match(r"[A-Z]+", ref)
                    if not col:
                        continue
                    v = c.find(f"{NS}v")
                    isr = c.find(f"{NS}is")
                    if c.get("t") == "s" and v is not None:
                        val = shared[int(v.text)]
                    elif isr is not None:
                        val = "".join(t.text or "" for t in isr.iter(f"{NS}t"))
                    else:
                        val = v.text if v is not None else ""
                    cells[col.group(0)] = (val or "").strip()
                rows.append(cells)
            out[name] = rows
        return out


def host_of(url):
    m = re.match(r"https?://([^/?#]+)", url.strip(), re.I)
    if not m:
        return ""
    host = m.group(1).lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "authority-registry.xlsx")
    sheets = read_sheets(xlsx)

    records = {}
    for name, rows in sheets.items():
        if not name.strip().startswith(("1 ", "2 ", "3 ")):
            continue
        for cells in rows[1:]:
            category = cells.get("B", "").strip()
            title = cells.get("C", "").strip()
            url = cells.get("F", "").strip()
            if not url or not title:
                continue
            if category in SKIP_CATEGORIES:
                continue
            host = host_of(url)
            if not host:
                continue
            tier = TIERS.get(category)
            if not tier:
                tier = TIERS.get(category.split("·")[0], (0.6, "其他来源", "media"))
            if host in OVERRIDES:
                tier = OVERRIDES[host]
            prev = records.get(host)
            if not prev or tier[0] > prev["score"]:
                records[host] = {
                    "score": tier[0],
                    "label": tier[1],
                    "kind": tier[2],
                    "title": title,
                    "category": category,
                }

    for host, (score, label, kind) in SUPPLEMENT.items():
        records.setdefault(
            host,
            {"score": score, "label": label, "kind": kind, "title": host, "category": "补充"},
        )

    lines = []
    lines.append("/**")
    lines.append(" * 权威来源名录（自动生成，勿手改）。")
    lines.append(" *")
    lines.append(" * 数据源：data/authority-registry.xlsx ——《全球权威论文收录平台 · 学术媒体 · 权威机构名录》")
    lines.append(" * 共 195 个条目，这里只保留可作为「证据来源」的域名，并按性质给出 0–1 的权威度：")
    lines.append(" *   0.98  同行评议期刊（Nature / Science / NEJM…）、政府与国际组织（WHO / NIH / NLM）")
    lines.append(" *   0.9x  引文索引、学会、国家级文献机构、出版商")
    lines.append(" *   0.7x  科学媒体（Nature News / ScienceDaily / 科学网）")
    lines.append(" *   0.6x  预印本（未经同行评审）、行业媒体")
    lines.append(" *   0.3x  科研工具与学术社交（可参考，不作证据）")
    lines.append(" *")
    lines.append(" * 末尾另附少量名录未收录、但常作一手来源的站点（CDC / Cochrane / 欧盟 / NASA 等），")
    lines.append(" * 在 SUPPLEMENT 里单独维护。")
    lines.append(" *")
    lines.append(" * 重新生成：python scripts/gen-authority.py")
    lines.append(" */")
    lines.append("")
    lines.append("export type AuthorityKind = 'peer-reviewed' | 'index' | 'official' | 'media' | 'preprint' | 'tool';")
    lines.append("")
    lines.append("export interface AuthorityInfo {")
    lines.append("  /** 0–1，越高越权威 */")
    lines.append("  score: number;")
    lines.append("  /** 展示用短标签 */")
    lines.append("  label: string;")
    lines.append("  kind: AuthorityKind;")
    lines.append("}")
    lines.append("")
    lines.append("/** 域名 → 权威度。匹配时从完整 host 逐级去掉左侧标签，所以 pmc.ncbi.nlm.nih.gov 能命中 nlm.nih.gov */")
    lines.append("const REGISTRY: Record<string, AuthorityInfo> = {")
    for host in sorted(records):
        r = records[host]
        lines.append(
            f"  '{host}': {{ score: {r['score']:.2f}, label: '{r['label']}', kind: '{r['kind']}' }},"  # noqa: E501
        )
    lines.append("};")
    lines.append("")
    lines.append("/**")
    lines.append(" * 查一个 URL 的权威度：命中名录返回条目，否则 null。")
    lines.append(" * 只看域名，不看路径——nature.com/news 与 nature.com 上的论文同归「同行评议期刊」，")
    lines.append(" * 这是名录本身的分辨率上限，报告里不会据此断言单篇内容的质量。")
    lines.append(" */")
    lines.append("export function authorityOf(url: string): AuthorityInfo | null {")
    lines.append("  let host = '';")
    lines.append("  try {")
    lines.append("    host = new URL(url).hostname.toLowerCase();")
    lines.append("  } catch {")
    lines.append("    return null;")
    lines.append("  }")
    lines.append("  if (host.startsWith('www.')) host = host.slice(4);")
    lines.append("  const parts = host.split('.');")
    lines.append("  for (let i = 0; i < parts.length - 1; i += 1) {")
    lines.append("    const hit = REGISTRY[parts.slice(i).join('.')];")
    lines.append("    if (hit) return hit;")
    lines.append("  }")
    lines.append("  return null;")
    lines.append("}")
    lines.append("")
    lines.append("export const AUTHORITY_COUNT = " + str(len(records)) + ";")
    lines.append("")

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    kinds = {}
    for r in records.values():
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"写入 {OUT}：{len(records)} 个域名")
    print("分布：", json.dumps(kinds, ensure_ascii=False))


if __name__ == "__main__":
    main()
