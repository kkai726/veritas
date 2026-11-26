import { buildReport } from './report';
import type { Report } from './types';

const TEXT = `每天喝 8 杯水是医学界的共识，因为人体每天必须排出约 2 升水分。

咖啡因会显著抑制儿童身高发育，因此 12 岁以下儿童应完全禁止饮用含咖啡因的饮料。

2023 年，世界卫生组织下属的国际癌症研究机构（IARC）将阿斯巴甜列为「可能对人致癌」（2B 类），同时维持每日允许摄入量 40 毫克/千克体重不变。`;

const JSON_PAYLOAD = {
  title: '「8 杯水」与咖啡因：三条流行健康说法的核查',
  overallScore: 46,
  verdict: '存疑',
  tldr:
    '三段说法中只有阿斯巴甜一段与官方文件一致。「每天 8 杯水」并非医学共识，且忽略了食物中的水分来源；「咖啡因抑制儿童身高」缺乏证据支持，儿科指南要求的是限量而非全面禁止。',
  paragraphs: [
    {
      text: '每天喝 8 杯水是医学界的共识，因为人体每天必须排出约 2 升水分。',
      score: 34,
      verdict: '矛盾',
      summary:
        '「8 杯水」没有权威机构背书，且把总需水量简化成了饮水量——成人每日水排出量通常为 2–3 升，其中约 20%–30% 来自食物。',
      claims: [
        {
          text: '「每天 8 杯水」是医学界共识',
          verdict: '矛盾',
          note: '美国国家医学院、梅奥诊所等机构均未给出「8 杯」这一统一标准，推荐量按性别、活动量与气候区分，且包含食物中的水分。',
          sources: ['https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/water/art-20044256'],
        },
        {
          text: '人体每天必须排出约 2 升水分',
          verdict: '部分支持',
          note: '成人每日总水排出量约 2–3 升（尿液 1–2 升、皮肤与呼吸约 0.8 升），「2 升」处于区间下限，并非普适值。',
          sources: ['https://www.ncbi.nlm.nih.gov/books/NBK541069/'],
        },
      ],
    },
    {
      text: '咖啡因会显著抑制儿童身高发育，因此 12 岁以下儿童应完全禁止饮用含咖啡因的饮料。',
      score: 31,
      verdict: '矛盾',
      summary:
        '现有研究未发现咖啡因与儿童身高之间存在显著的因果关系；权威指南的建议是限量（如每公斤体重 2.5 毫克以内），而不是对 12 岁以下儿童全面禁止。',
      claims: [
        {
          text: '咖啡因会显著抑制儿童身高发育',
          verdict: '缺证据',
          note: '未检索到支持「显著抑制身高」的高质量研究；部分观察性研究提示咖啡因摄入与钙摄入替代有关，但未证实对最终身高有直接影响。',
          sources: ['https://www.efsa.europa.eu/en/efsajournal/pub/2053'],
        },
        {
          text: '12 岁以下儿童应完全禁止含咖啡因饮料',
          verdict: '矛盾',
          note: '美国儿科学会建议儿童避免咖啡因，但对含咖啡因饮料的表述是「不推荐常规饮用」，并非「完全禁止」；各国指南多以每日限量表述。',
          sources: ['https://publications.aap.org/pediatrics/article/138/3/e20161547/52555'],
        },
      ],
    },
    {
      text: '2023 年，世界卫生组织下属的国际癌症研究机构（IARC）将阿斯巴甜列为「可能对人致癌」（2B 类），同时维持每日允许摄入量 40 毫克/千克体重不变。',
      score: 92,
      verdict: '支持',
      summary: '两处关键信息与 IARC 及 WHO 的官方发布一致：危害分类为 2B，每日允许摄入量维持 0–40 毫克/千克体重。',
      claims: [
        {
          text: 'IARC 于 2023 年将阿斯巴甜列为 2B 类「可能致癌」',
          verdict: '支持',
          note: 'IARC 于 2023 年 7 月发布评估，将阿斯巴甜归入 2B 组（可能对人致癌），依据是有限的人类证据。',
          sources: ['https://www.iarc.who.int/wp-content/uploads/2023/06/PR324_E.pdf'],
        },
        {
          text: '每日允许摄入量维持 40 毫克/千克体重',
          verdict: '支持',
          note: 'WHO 与 FAO 联合专家委员会（JECFA）同期结论：维持 0–40 毫克/千克体重的每日允许摄入量不变。',
          sources: ['https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released'],
        },
      ],
    },
  ],
  sources: [
    {
      title: 'Water: How much should you drink every day?',
      url: 'https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/water/art-20044256',
      publisher: 'Mayo Clinic',
    },
    {
      title: 'Physiology, Water Balance',
      url: 'https://www.ncbi.nlm.nih.gov/books/NBK541069/',
      publisher: 'NCBI Bookshelf',
    },
    {
      title: 'Scientific Opinion on the safety of caffeine',
      url: 'https://www.efsa.europa.eu/en/efsajournal/pub/2053',
      publisher: 'EFSA',
    },
    {
      title: 'Clinical Report: Sports Drinks and Energy Drinks for Children and Adolescents',
      url: 'https://publications.aap.org/pediatrics/article/138/3/e20161547/52555',
      publisher: 'American Academy of Pediatrics',
    },
    {
      title: 'Aspartame hazard and risk assessment results released',
      url: 'https://www.who.int/news/item/14-07-2023-aspartame-hazard-and-risk-assessment-results-released',
      publisher: 'World Health Organization',
    },
  ],
  limitations: [
    '示例报告使用内置样例数据，用于展示输出结构，不代表对真实文本的核查结论。',
    '部分研究结论来自观察性研究，因果推断需谨慎。',
  ],
};

export function demoReport(): Report {
  return buildReport({
    json: JSON_PAYLOAD,
    raw: 'demo',
    provider: 'deepseek',
    model: 'deepseek-chat',
    providerName: 'DeepSeek',
    citations: [],
    searchUsed: false,
    inputType: 'text',
    text: TEXT,
    elapsedMs: 43_800,
    evidenceStat: {
      queries: 4,
      hits: 6,
      pages: 3,
      engines: ['DuckDuckGo', 'Wikipedia'],
    },
  });
}
