/**
 * 权威来源名录（自动生成，勿手改）。
 *
 * 数据源：data/authority-registry.xlsx ——《全球权威论文收录平台 · 学术媒体 · 权威机构名录》
 * 共 195 个条目，这里只保留可作为「证据来源」的域名，并按性质给出 0–1 的权威度：
 *   0.98  同行评议期刊（Nature / Science / NEJM…）、政府与国际组织（WHO / NIH / NLM）
 *   0.9x  引文索引、学会、国家级文献机构、出版商
 *   0.7x  科学媒体（Nature News / ScienceDaily / 科学网）
 *   0.6x  预印本（未经同行评审）、行业媒体
 *   0.3x  科研工具与学术社交（可参考，不作证据）
 *
 * 末尾另附少量名录未收录、但常作一手来源的站点（CDC / Cochrane / 欧盟 / NASA 等），
 * 在 SUPPLEMENT 里单独维护。
 *
 * 重新生成：python scripts/gen-authority.py
 */

export type AuthorityKind = 'peer-reviewed' | 'index' | 'official' | 'media' | 'preprint' | 'tool';

export interface AuthorityInfo {
  /** 0–1，越高越权威 */
  score: number;
  /** 展示用短标签 */
  label: string;
  kind: AuthorityKind;
}

/** 域名 → 权威度。匹配时从完整 host 逐级去掉左侧标签，所以 pmc.ncbi.nlm.nih.gov 能命中 nlm.nih.gov */
const REGISTRY: Record<string, AuthorityInfo> = {
  'aaas.org': { score: 0.95, label: '学会', kind: 'official' },
  'aap.org': { score: 0.93, label: '学会', kind: 'official' },
  'acabridge.cn': { score: 0.56, label: '中文高教媒体', kind: 'media' },
  'academic.oup.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'acm.org': { score: 0.95, label: '学会', kind: 'official' },
  'acs.org': { score: 0.95, label: '学会', kind: 'official' },
  'aeaweb.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'agiweb.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'airitilibrary.com': { score: 0.88, label: '中文数据库', kind: 'index' },
  'altmetric.com': { score: 0.50, label: '计量平台', kind: 'media' },
  'ams.org': { score: 0.95, label: '学会', kind: 'official' },
  'annualreviews.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'apa.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'app.dimensions.ai': { score: 0.80, label: '开放学术数据', kind: 'index' },
  'aps.org': { score: 0.95, label: '学会', kind: 'official' },
  'arstechnica.com': { score: 0.76, label: '学科媒体', kind: 'media' },
  'arxiv.org': { score: 0.65, label: '预印本（未经同行评审）', kind: 'preprint' },
  'ascelibrary.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'asmedigitalcollection.asme.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'base-search.net': { score: 0.84, label: '开放获取库', kind: 'index' },
  'biblioboard.com': { score: 0.75, label: '学位论文库', kind: 'index' },
  'bioon.com': { score: 0.66, label: '中文学科媒体', kind: 'media' },
  'biorxiv.org': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'bmj.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'cacm.acm.org': { score: 0.76, label: '学科媒体', kind: 'media' },
  'calis.edu.cn': { score: 0.75, label: '学位论文库', kind: 'index' },
  'cambridge.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'cas.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'cass.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'cast.org.cn': { score: 0.95, label: '学会', kind: 'official' },
  'cdc.gov': { score: 0.97, label: '政府 / 国际组织', kind: 'official' },
  'cdgdc.edu.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'cell.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'cen.acs.org': { score: 0.76, label: '学科媒体', kind: 'media' },
  'chaoxing.com': { score: 0.85, label: '中文数据库商', kind: 'official' },
  'chemistryworld.com': { score: 0.76, label: '学科媒体', kind: 'media' },
  'chemrxiv.org': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'chinaxiv.org': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'chronicle.com': { score: 0.58, label: '高教媒体', kind: 'media' },
  'clarivate.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'cnki.net': { score: 0.88, label: '中文数据库', kind: 'index' },
  'coalition-s.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'cochrane.org': { score: 0.96, label: '系统综述', kind: 'peer-reviewed' },
  'cochranelibrary.com': { score: 0.96, label: '系统综述', kind: 'peer-reviewed' },
  'core.ac.uk': { score: 0.84, label: '开放获取库', kind: 'index' },
  'countermetrics.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'cqvip.com': { score: 0.88, label: '中文数据库', kind: 'index' },
  'crossref.org': { score: 0.88, label: '元数据源', kind: 'index' },
  'cssrac.nju.edu.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'cujs.org.cn': { score: 0.95, label: '学会', kind: 'official' },
  'datacite.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'degruyter.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'digital-science.com': { score: 0.92, label: '出版商 / 数据库', kind: 'official' },
  'dl.acm.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'doaj.org': { score: 0.88, label: '期刊目录', kind: 'index' },
  'duxiu.com': { score: 0.88, label: '中文数据库', kind: 'index' },
  'dxy.cn': { score: 0.66, label: '中文学科媒体', kind: 'media' },
  'ebsco.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'editage.com': { score: 0.60, label: '出版行业媒体', kind: 'media' },
  'elsevier.com': { score: 0.92, label: '出版商 / 数据库', kind: 'official' },
  'embase.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'emerald.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'engineeringvillage.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'eric.ed.gov': { score: 0.95, label: '学科索引', kind: 'index' },
  'eurekalert.org': { score: 0.76, label: '科学媒体', kind: 'media' },
  'europa.eu': { score: 0.95, label: '政府 / 国际组织', kind: 'official' },
  'fenqubiao.com': { score: 0.90, label: '期刊评价', kind: 'index' },
  'guokr.com': { score: 0.70, label: '中文科学媒体', kind: 'media' },
  'huanqiukexue.com': { score: 0.70, label: '中文科学媒体', kind: 'media' },
  'hxqk.lib.pku.edu.cn': { score: 0.86, label: '中文评价', kind: 'index' },
  'icmje.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'ieee.org': { score: 0.95, label: '学会', kind: 'official' },
  'ieeexplore.ieee.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'insidehighered.com': { score: 0.58, label: '高教媒体', kind: 'media' },
  'ioppublishing.org': { score: 0.95, label: '学会', kind: 'official' },
  'iopscience.iop.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'istic.ac.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'jamanetwork.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'jcr.clarivate.com': { score: 0.90, label: '期刊评价', kind: 'index' },
  'journals.aps.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'journals.sagepub.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'jstor.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'las.ac.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'leidenranking.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'lens.org': { score: 0.86, label: '开放学术数据', kind: 'index' },
  'lib.pku.edu.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'link.springer.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'linkresearcher.com': { score: 0.70, label: '中文科学媒体', kind: 'media' },
  'mathscinet.ams.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'mayoclinic.org': { score: 0.85, label: '医疗机构', kind: 'official' },
  'medrxiv.org': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'medsci.cn': { score: 0.66, label: '中文学科媒体', kind: 'media' },
  'mjl.clarivate.com': { score: 0.90, label: '收录查询', kind: 'index' },
  'mla.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'moe.gov.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'most.gov.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'nal.usda.gov': { score: 0.95, label: '学科索引', kind: 'index' },
  'nasa.gov': { score: 0.95, label: '政府 / 国际组织', kind: 'official' },
  'nature.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'ncpssd.org': { score: 0.88, label: '中文数据库', kind: 'index' },
  'ndltd.org': { score: 0.75, label: '学位论文库', kind: 'index' },
  'nejm.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'newscientist.com': { score: 0.76, label: '科学媒体', kind: 'media' },
  'nih.gov': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'niso.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'nlm.nih.gov': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'noaa.gov': { score: 0.95, label: '政府 / 国际组织', kind: 'official' },
  'nopss.gov.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'nsfc.gov.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'nstl.gov.cn': { score: 0.97, label: '国家级机构', kind: 'official' },
  'oaspa.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'oatd.org': { score: 0.75, label: '学位论文库', kind: 'index' },
  'oecd-ilibrary.org': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'onlinelibrary.wiley.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'openalex.org': { score: 0.84, label: '开放学术数据', kind: 'index' },
  'openknowledge.worldbank.org': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'orcid.org': { score: 0.40, label: '身份标识', kind: 'tool' },
  'paper.edu.cn': { score: 0.88, label: '中文数据库', kind: 'index' },
  'philpapers.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'phys.org': { score: 0.76, label: '科学媒体', kind: 'media' },
  'plos.org': { score: 0.95, label: '同行评议期刊', kind: 'peer-reviewed' },
  'pmc.ncbi.nlm.nih.gov': { score: 0.95, label: '学科索引', kind: 'index' },
  'preprints.org': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'proquest.com': { score: 0.92, label: '出版商 / 数据库', kind: 'official' },
  'publicationethics.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'pubmed.ncbi.nlm.nih.gov': { score: 0.95, label: '学科索引', kind: 'index' },
  'pubpeer.com': { score: 0.72, label: '同行质疑平台', kind: 'media' },
  'pubs.acs.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'pubs.aip.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'pubs.rsc.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'quantamagazine.org': { score: 0.76, label: '科学媒体', kind: 'media' },
  'reaxys.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'research4life.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'researchinformation.info': { score: 0.60, label: '出版行业媒体', kind: 'media' },
  'researchsquare.com': { score: 0.60, label: '预印本（未经同行评审）', kind: 'preprint' },
  'retractionwatch.com': { score: 0.80, label: '撤稿监测', kind: 'media' },
  'rsc.org': { score: 0.95, label: '学会', kind: 'official' },
  'scholar.google.com': { score: 0.72, label: '学术搜索', kind: 'index' },
  'scholarlykitchen.sspnet.org': { score: 0.60, label: '出版行业媒体', kind: 'media' },
  'science.org': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'sciencechina.cn': { score: 0.86, label: '中文评价', kind: 'index' },
  'sciencedaily.com': { score: 0.76, label: '科学媒体', kind: 'media' },
  'sciencedirect.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'sciencenet.cn': { score: 0.70, label: '中文科学媒体', kind: 'media' },
  'scientificamerican.com': { score: 0.76, label: '科学媒体', kind: 'media' },
  'scilit.com': { score: 0.90, label: '期刊评价', kind: 'index' },
  'scimagoir.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'scimagojr.com': { score: 0.90, label: '期刊评价', kind: 'index' },
  'scopus.com': { score: 0.92, label: '引文索引', kind: 'index' },
  'semanticscholar.org': { score: 0.80, label: '学术搜索', kind: 'index' },
  'shanghairanking.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'spectrum.ieee.org': { score: 0.76, label: '学科媒体', kind: 'media' },
  'springernature.com': { score: 0.92, label: '出版商 / 数据库', kind: 'official' },
  'ssrn.com': { score: 0.95, label: '学科索引', kind: 'index' },
  'statnews.com': { score: 0.76, label: '学科媒体', kind: 'media' },
  'stats.gov.cn': { score: 0.96, label: '国家级机构', kind: 'official' },
  'stm-assoc.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'tandfonline.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'technologyreview.com': { score: 0.76, label: '科学媒体', kind: 'media' },
  'the-scientist.com': { score: 0.76, label: '学科媒体', kind: 'media' },
  'theconversation.com': { score: 0.76, label: '科学媒体', kind: 'media' },
  'theiet.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'thelancet.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'timeshighereducation.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'topuniversities.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'ui.adsabs.harvard.edu': { score: 0.95, label: '学科索引', kind: 'index' },
  'un.org': { score: 0.97, label: '政府 / 国际组织', kind: 'official' },
  'undark.org': { score: 0.76, label: '科学媒体', kind: 'media' },
  'unesco.org': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'usgs.gov': { score: 0.94, label: '政府 / 国际组织', kind: 'official' },
  'usnews.com': { score: 0.65, label: '排名机构', kind: 'media' },
  'wame.org': { score: 0.90, label: '标准 / 伦理组织', kind: 'official' },
  'wanfangdata.com.cn': { score: 0.88, label: '中文数据库', kind: 'index' },
  'webofscience.com': { score: 0.92, label: '引文索引', kind: 'index' },
  'who.int': { score: 0.98, label: '政府 / 国际组织', kind: 'official' },
  'wiley.com': { score: 0.92, label: '出版商 / 数据库', kind: 'official' },
  'worldscientific.com': { score: 0.98, label: '同行评议期刊', kind: 'peer-reviewed' },
  'x-mol.com': { score: 0.70, label: '中文科学媒体', kind: 'media' },
  'zbmath.org': { score: 0.95, label: '学科索引', kind: 'index' },
  'zhishifenzi.com': { score: 0.70, label: '中文科学媒体', kind: 'media' },
};

/**
 * 查一个 URL 的权威度：命中名录返回条目，否则 null。
 * 只看域名，不看路径——nature.com/news 与 nature.com 上的论文同归「同行评议期刊」，
 * 这是名录本身的分辨率上限，报告里不会据此断言单篇内容的质量。
 */
export function authorityOf(url: string): AuthorityInfo | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const hit = REGISTRY[parts.slice(i).join('.')];
    if (hit) return hit;
  }
  return null;
}

export const AUTHORITY_COUNT = 180;
