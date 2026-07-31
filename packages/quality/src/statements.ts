import {
  FACT_MAPPING_CLASSIFICATION_VERSION,
  FACT_MAPPING_LIMITS,
  KEY_FACT_POLICY_VERSION,
  PROTECTED_SIGNAL_POLICY_VERSION,
  type FactDomain,
  type FactMateriality,
  type ProtectedSignalKind,
  type StatementKind,
} from './constants.js';
import {
  assertClassification,
  type DraftStatementClassificationV1,
  type ProtectedSignalV1,
} from './contracts.js';
import { factMappingHash, normalizeDraftText } from './identity.js';

const AWARD_PATTERN =
  /(?:获奖|获奖者|入围|提名|候选|大奖|奖项|award|winner|shortlist|nominee|受賞|候補)/giu;
const RANKING_PATTERN = /(?:第[一二三四五六七八九十百千万\d]+|TOP\s*\d+|榜首|冠军|排名|销量)/giu;
const DATE_PATTERN =
  /(?:\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?)?|\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?)/gu;
const PERCENT_PATTERN = /(?:\d+(?:\.\d+)?\s*%|[零一二三四五六七八九十百千万两]+\s*成)/gu;
const CURRENCY_PATTERN =
  /(?:[$¥￥€£]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|万元|亿元|美元|日元|人民币))/gu;
const ISBN_PATTERN = /ISBN(?:-1[03])?\s*:?\s*(?:97[89][-\s]?)?[0-9Xx][0-9Xx\-\s]{8,20}/gu;
const NUMBER_PATTERN =
  /(?:\d+(?:\.\d+)?|[零〇一二三四五六七八九十百千万亿两]{2,})(?:\s*(?:本|部|册|万|亿|分|页|次|名|位|份|年))?/gu;
const BOOK_PATTERN = /《[^》\r\n]{1,120}》/gu;
const QUOTE_ATTRIBUTION_PATTERN =
  /(?:作者|译者|出版社|评委|媒体|[A-Za-z\u3400-\u9fff]{2,20})(?:曾|表示|称|写道|说)[^。！？\n]{0,80}[“"][^”"]+[”"]/gu;

const OPINION_PATTERN = /(?:我认为|我觉得|我给|值得|推荐|喜欢|好看|精彩|最爱|不喜欢|读起来)/u;
const PERSONAL_PATTERN = /(?:我读|我看|我重读|我的阅读|我给|亲自读|读完后我)/u;
const ANALYSIS_PATTERN = /(?:叙事|结构|逻辑|诡计|伏笔|节奏|视角|文本|可理解为|意味着|显示出)/u;
const PLOT_FACT_PATTERN =
  /(?:叙事|结构|诡计|伏笔|视角|情节|文本)(?:是|为|采用|包含|使用|分成|分为|发生于)/u;
const FACT_VERB_PATTERN =
  /(?:是|(?<!认|因)为|出版|发行|连载|获得|获奖|入围|提名|位列|排名|销量|创作|改编|译自|发表于|担任)/u;
const WARNING_PATTERN = /^(?:⚠️?\s*)?(?:无剧透|轻微剧透|含剧透|完整诡计分析|剧透预警)$/u;
const LABEL_PATTERN = /^(?:公开资料整理|资料分析评分)$/u;

interface Match {
  readonly end: number;
  readonly kind: ProtectedSignalKind;
  readonly start: number;
  readonly text: string;
}

function codePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

function matches(text: string, pattern: RegExp, kind: ProtectedSignalKind): Match[] {
  return [...text.matchAll(pattern)].map((match) => ({
    end: codePointOffset(text, (match.index ?? 0) + match[0].length),
    kind,
    start: codePointOffset(text, match.index ?? 0),
    text: match[0],
  }));
}

function listOrdinal(text: string, match: Match): boolean {
  if (match.kind !== 'NUMBER' && match.kind !== 'RANKING') return false;
  const before = Array.from(text)
    .slice(Math.max(0, match.start - 2), match.start)
    .join('');
  const after = Array.from(text)
    .slice(match.end, match.end + 1)
    .join('');
  return (
    (match.start === 0 || /[\n。；;]\s*$/u.test(before)) &&
    (after === '.' || after === '、' || after === '）' || after === ')')
  );
}

export function detectProtectedSignals(textValue: string): readonly ProtectedSignalV1[] {
  const text = normalizeDraftText(textValue);
  const raw = [
    ...matches(text, ISBN_PATTERN, 'ISBN'),
    ...matches(text, DATE_PATTERN, 'DATE'),
    ...matches(text, PERCENT_PATTERN, 'PERCENT'),
    ...matches(text, CURRENCY_PATTERN, 'CURRENCY'),
    ...matches(text, AWARD_PATTERN, 'AWARD'),
    ...matches(text, RANKING_PATTERN, 'RANKING'),
    ...matches(text, BOOK_PATTERN, 'BIBLIOGRAPHIC_IDENTITY'),
    ...matches(text, QUOTE_ATTRIBUTION_PATTERN, 'QUOTATION_ATTRIBUTION'),
    ...matches(text, NUMBER_PATTERN, 'NUMBER'),
  ]
    .filter((item) => !listOrdinal(text, item))
    .sort(
      (left, right) =>
        left.start - right.start || right.end - left.end || left.kind.localeCompare(right.kind),
    );
  const deduplicated = raw.filter(
    (item, index) =>
      !raw
        .slice(0, index)
        .some(
          (prior) =>
            prior.start <= item.start &&
            prior.end >= item.end &&
            (prior.kind !== 'NUMBER' || item.kind === 'NUMBER'),
        ),
  );
  return Object.freeze(
    deduplicated.slice(0, FACT_MAPPING_LIMITS.signals).map((item, index) =>
      Object.freeze({
        acknowledged: false,
        endCodePoint: item.end,
        kind: item.kind,
        policyVersion: PROTECTED_SIGNAL_POLICY_VERSION,
        reason: null,
        signalId: `signal-${String(index + 1).padStart(4, '0')}-${factMappingHash([
          item.kind,
          item.start,
          item.end,
          item.text,
        ]).slice(0, 16)}`,
        startCodePoint: item.start,
        tokenHash: factMappingHash(item.text),
      }),
    ),
  );
}

function domain(signals: readonly ProtectedSignalV1[], text: string): FactDomain {
  if (signals.some(({ kind }) => kind === 'AWARD')) return 'AWARD';
  if (signals.some(({ kind }) => kind === 'RANKING')) return 'RANKING';
  if (signals.some(({ kind }) => kind === 'DATE')) return 'DATE_TIME';
  if (signals.some(({ kind }) => ['CURRENCY', 'NUMBER', 'PERCENT'].includes(kind)))
    return 'NUMERIC';
  if (signals.some(({ kind }) => ['ISBN', 'BIBLIOGRAPHIC_IDENTITY'].includes(kind)))
    return 'BIBLIOGRAPHIC';
  if (signals.some(({ kind }) => kind === 'QUOTATION_ATTRIBUTION')) return 'QUOTATION_ATTRIBUTION';
  if (/(?:情节|诡计|凶手|动机|结构事实)/u.test(text)) return 'PLOT_OR_STRUCTURE';
  if (/(?:作者|译者|出版社|出版方)/u.test(text)) return 'CREATOR_OR_PUBLISHER';
  return 'OTHER';
}

function materiality(signals: readonly ProtectedSignalV1[], text: string): FactMateriality {
  if (
    signals.some(({ kind }) =>
      ['AWARD', 'BIBLIOGRAPHIC_IDENTITY', 'CURRENCY', 'DATE', 'ISBN', 'RANKING'].includes(kind),
    ) ||
    /(?:首次|唯一|最高|销量|市场份额|改编)/u.test(text)
  ) {
    return 'KEY_FACT';
  }
  return 'SUPPORTING_FACT';
}

export function classifyStatement(textValue: string): DraftStatementClassificationV1 {
  const text = normalizeDraftText(textValue).trim();
  const signals = detectProtectedSignals(text);
  let kind: StatementKind;
  let requiresReview = false;
  let reasonCode: string;
  if (WARNING_PATTERN.test(text) || LABEL_PATTERN.test(text)) {
    kind = 'LABEL_OR_WARNING';
    reasonCode = 'FROZEN_LABEL_OR_WARNING';
  } else if (PERSONAL_PATTERN.test(text)) {
    kind = 'PERSONAL_EXPERIENCE';
    requiresReview = signals.length > 0;
    reasonCode = signals.length > 0 ? 'PERSONAL_WITH_PROTECTED_SIGNAL' : 'PERSONAL_EXPERIENCE';
  } else if (OPINION_PATTERN.test(text) && FACT_VERB_PATTERN.test(text)) {
    kind = 'MIXED';
    requiresReview = true;
    reasonCode = 'FACT_OPINION_MIXED';
  } else if (OPINION_PATTERN.test(text)) {
    kind = 'OPINION';
    requiresReview = signals.length > 0;
    reasonCode = signals.length > 0 ? 'OPINION_WITH_PROTECTED_SIGNAL' : 'OPINION_EXPRESSION';
  } else if (PLOT_FACT_PATTERN.test(text)) {
    kind = 'FACT';
    reasonCode = 'PLOT_OR_STRUCTURE_FACT';
  } else if (ANALYSIS_PATTERN.test(text) && FACT_VERB_PATTERN.test(text)) {
    kind = 'MIXED';
    requiresReview = true;
    reasonCode = 'FACT_ANALYSIS_MIXED';
  } else if (ANALYSIS_PATTERN.test(text)) {
    kind = 'ANALYTICAL_JUDGMENT';
    requiresReview = signals.length > 0;
    reasonCode = signals.length > 0 ? 'ANALYSIS_WITH_PROTECTED_SIGNAL' : 'ANALYTICAL_EXPRESSION';
  } else if (/[？?]\s*$/u.test(text) && !FACT_VERB_PATTERN.test(text)) {
    kind = 'RHETORICAL';
    reasonCode = 'RHETORICAL_QUESTION';
  } else if (signals.length > 0 || FACT_VERB_PATTERN.test(text)) {
    kind = 'FACT';
    reasonCode = signals.length > 0 ? 'PROTECTED_FACT_SIGNAL' : 'ASSERTIVE_FACT_EXPRESSION';
  } else {
    kind = 'AMBIGUOUS';
    requiresReview = true;
    reasonCode = 'CLASSIFICATION_REQUIRED';
  }
  return assertClassification({
    classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
    domain: kind === 'FACT' || kind === 'MIXED' ? domain(signals, text) : 'NOT_APPLICABLE',
    kind,
    materiality:
      kind === 'FACT' || kind === 'MIXED' ? materiality(signals, text) : 'NOT_APPLICABLE',
    reasonCode,
    requiresReview,
  });
}

interface Segment {
  readonly endCodePoint: number;
  readonly startCodePoint: number;
  readonly text: string;
}

function trimSegment(
  points: readonly string[],
  startValue: number,
  endValue: number,
): Segment | null {
  let start = startValue;
  let end = endValue;
  while (start < end && /\s/u.test(points[start] ?? '')) start += 1;
  while (end > start && /\s/u.test(points[end - 1] ?? '')) end -= 1;
  if (start >= end) return null;
  return { endCodePoint: end, startCodePoint: start, text: points.slice(start, end).join('') };
}

export function segmentStatementText(textValue: string): readonly Segment[] {
  const text = normalizeDraftText(textValue);
  const points = Array.from(text);
  const boundaries = new Set<number>([0, points.length]);
  points.forEach((point, index) => {
    if (/[。！？!?；;\n]/u.test(point)) boundaries.add(index + 1);
  });
  for (const connector of text.matchAll(/(?:并于|且于|并获得|并获|同时)/gu)) {
    const start = codePointOffset(text, connector.index ?? 0);
    const before = points.slice(Math.max(0, start - 80), start).join('');
    const after = points.slice(start, Math.min(points.length, start + 80)).join('');
    if (
      (detectProtectedSignals(before).length > 0 || FACT_VERB_PATTERN.test(before)) &&
      (detectProtectedSignals(after).length > 0 || FACT_VERB_PATTERN.test(after))
    ) {
      boundaries.add(start);
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const segments = ordered
    .slice(0, -1)
    .map((start, index) => trimSegment(points, start, ordered[index + 1] ?? points.length))
    .filter((item): item is Segment => item !== null);
  return Object.freeze(segments.slice(0, FACT_MAPPING_LIMITS.statements));
}

export const KEY_FACT_POLICY = Object.freeze({
  detectorVersion: PROTECTED_SIGNAL_POLICY_VERSION,
  policyVersion: KEY_FACT_POLICY_VERSION,
  protectedDomains: Object.freeze([
    'AWARD',
    'BIBLIOGRAPHIC',
    'DATE_TIME',
    'INDUSTRY_OR_MARKET',
    'NUMERIC',
    'QUOTATION_ATTRIBUTION',
    'RANKING',
  ] as const),
});
