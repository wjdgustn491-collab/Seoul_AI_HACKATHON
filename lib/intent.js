// 의도 분류 (규칙). 지역 확인보다 먼저 실행한다. 안전 관련(위기·역할 유지·거절·지역 밖·범위 밖)은 AI 없이도 잡는다.
// 반환: { kind, stop } stop=true면 추천하지 않고 바로 답한다. 그 밖의 필드는 추천을 이어갈 때 쓴다.
import {
  CRISIS_RE, ROLE_KEEP_RE, REFUSE_RE, OUT_OF_SCOPE_RE, OUT_OF_AREA_RE, AMBIGUOUS_PLACE_RE, EXPLAIN_RE, LIMIT_RE,
  HEALTH, DIET, BRANDS, MAYBE_MISSING, BULK_RE, SMALL_RE, BIG_EATER_RE, CONFLICTS,
} from './vocab.js';

const REFUSE_REASONS = [
  [/리뷰|척/, '실제와 다른 리뷰를 쓰거나 꾸미는 일은 도와드릴 수 없어요.'],
  [/전화|연락처|주소|개인\s*정보/, '사장님·배달원 같은 개인의 연락처나 주소는 알려 드릴 수 없어요.'],
  [/미성년|술|맥주/, '미성년자의 주류 주문은 도와드릴 수 없어요.'],
  [/공짜|무료로|쿠폰|환불|사기|먹튀/, '결제를 피하거나 쿠폰·환불을 속이는 방법은 도와드릴 수 없어요.'],
  [/망하게|협박|해킹/, '가게에 피해를 주는 일은 도와드릴 수 없어요.'],
  [/욕/, '욕설이 담긴 요청사항은 써 드릴 수 없어요.'],
];

export function classifyIntent(text) {
  const t = String(text ?? '');
  if (CRISIS_RE.test(t)) return { kind: 'caution', crisis: true, stop: true, notices: ['crisis_resources'] };
  if (ROLE_KEEP_RE.test(t)) return { kind: 'role_keep', stop: true };
  if (REFUSE_RE.test(t)) return { kind: 'refuse', stop: true, reason: REFUSE_REASONS.find(([re]) => re.test(t))?.[1] ?? '그 요청은 도와드릴 수 없어요.' };
  if (OUT_OF_AREA_RE.test(t)) return { kind: 'out_of_area', stop: true, place: t.match(OUT_OF_AREA_RE)[0] };
  if (AMBIGUOUS_PLACE_RE.test(t)) return { kind: 'ask_region', stop: true, place: t.match(AMBIGUOUS_PLACE_RE)[0] };
  if (OUT_OF_SCOPE_RE.test(t)) return { kind: 'out_of_scope', stop: true, askedName: /이름|누구/.test(t) };
  if (EXPLAIN_RE.test(t)) return { kind: 'explain', stop: true, topic: explainTopic(t) };
  const result = { kind: null, notices: [], avoid: [] };
  for (const c of CONFLICTS) {
    const m = t.match(c.re);
    if (m) return { kind: 'ask_clarify', stop: true, conflict: { ...c, match: m } };
  }
  const health = [...HEALTH, ...DIET].filter(h => h.re.test(t));
  if (health.length) {
    result.kind = 'caution';
    result.health = health.map(h => h.label);
    result.avoid = [...new Set(health.flatMap(h => h.avoid))];
    result.prefer = health.find(h => h.prefer)?.prefer ?? null;
    result.notices.push(HEALTH.some(h => h.re.test(t)) ? 'allergy_data_missing' : 'diet_data_missing');
  }
  if (LIMIT_RE.test(t)) { result.kind ??= 'limit_notice'; result.limit = true; result.notices.push('no_realtime_data'); }
  const brand = BRANDS.find(b => b.re.test(t));
  if (brand) { result.kind ??= 'substitute'; result.brand = brand; }
  const missing = !brand && MAYBE_MISSING.find(m => m.re.test(t));
  if (missing) result.missing = missing;
  const bulk = t.match(BULK_RE);
  const bulkCount = Number(bulk?.[1] || bulk?.[2]) || (bulk ? 30 : 0);
  if (bulk && bulkCount >= 10) { result.bulk = bulkCount; result.notices.push('no_bulk_data'); }
  const big = t.match(BIG_EATER_RE);
  if (big) result.bigEater = Number(big[1] || big[2]);
  if (SMALL_RE.test(t)) result.small = true;
  return result;
}

function explainTopic(t) {
  if (/광고/.test(t)) return 'ad';
  if (/착한/.test(t)) return 'goodPrice';
  if (/신규|별점\s*(?:이\s*)?(?:왜\s*)?없/.test(t)) return 'newStore';
  if (/별점\s*(?:높은|좋은)\s*순/.test(t)) return 'rating';
  if (/어제|지난번|저번에/.test(t)) return 'history';
  if (/왜|이유|근거/.test(t)) return 'why';
  return 'how';
}
