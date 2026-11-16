// 설계서 v3: 판단·계산은 코드가, 말 이해·질문·설명은 AI가 한다.
import { readFileSync } from 'node:fs';
import * as realAi from './ai.js';

// ---------- 데이터 (엑셀 CSV) ----------
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x !== ''));
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^﻿/, '');
const num = v => (v === '' || v == null ? null : Number(v));
const bool = v => String(v).toLowerCase() === 'true';
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const clamp = v => Math.max(0, Math.min(1, v));

// 설계서의 새 칸(min_order, is_main)은 CSV에 추가하면 자동으로 쓰인다. 없으면 0 / 중앙값 50% 규칙.
export const stores = parseCsv(read('stores_excel')).map(s => ({
  id: s.store_id, name: s.name, dong: s.dong, category: s.category,
  franchise: bool(s.is_franchise), tip: num(s.delivery_tip) ?? 0,
  rating: num(s.rating), reviews: num(s.review_count) ?? 0, open: bool(s.is_open),
  minOrder: num(s.min_order) ?? 0,
}));
const menus = parseCsv(read('menus_excel')).map(m => ({
  id: m.menu_id, store: m.store_id, name: m.name, price: num(m.price), desc: m.description || '',
  isMain: m.is_main ? bool(m.is_main) : null,
}));
// 가게별 메인 메뉴 (가격 오름차순)
export const mains = {};
for (const s of stores) {
  const ms = menus.filter(m => m.store === s.id);
  const cut = median(ms.map(m => m.price)) * 0.5;
  mains[s.id] = ms.filter(m => m.isMain ?? m.price >= cut).sort((a, b) => a.price - b.price);
}

export const DONGS = ['서초1동', '서초2동', '서초4동'];
export const CATEGORIES = ['치킨', '중식', '분식', '피자', '찜·탕'];
const PER_TWO = ['치킨', '피자']; // 2인당 1개, 나머지 1인당 1개 [제안]

// ---------- 노출 횟수 (가게별, 매일 0시 초기화) ----------
// ponytail: 서버 메모리라 재시작/서버리스 인스턴스마다 초기화됨. 유지가 필요하면 Supabase 테이블로.
const exposure = { day: '', counts: {} };
const today = () => new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
function expo(id) {
  if (exposure.day !== today()) { exposure.day = today(); exposure.counts = {}; }
  return exposure.counts[id] ?? 0;
}

// ---------- 가격 패턴 (숫자+원/만/천, 한글 수사+원/만) ----------
const PRICE_RE = /\d[\d,]*(?:\.\d+)?\s*(?:만\s*(?:\d+\s*천)?\s*원?|천\s*원?|원)|[일이삼사오육칠팔구십백]*[만천][일이삼사오육칠팔구십백천]*\s*원|[이삼사오육칠팔구]만/;
export const hasPrice = t => PRICE_RE.test(String(t || ''));
const DIG = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
export function parseAmount(text) {
  const m = String(text).match(PRICE_RE);
  if (!m) return null;
  let total = 0, cur = 0, d = 0;
  for (const [, n, h, u] of m[0].replace(/[,\s원]/g, '').matchAll(/(\d+(?:\.\d+)?)|([일이삼사오육칠팔구])|([십백천만])/g)) {
    if (n) d = Number(n);
    else if (h) d = DIG[h];
    else if (u === '만') { total += (cur + d || 1) * 10000; cur = 0; d = 0; }
    else { cur += (d || 1) * { 십: 10, 백: 100, 천: 1000 }[u]; d = 0; }
  }
  return Math.round(total + cur + d) || null;
}

// ---------- 상태 ----------
const freshCond = () => ({ menu: null, people: null, budget: null, budget_unit: 'total', price_pref: 'none', taste: [], franchise: 'none', budget_under: false });
const fresh = dong => ({ dong, cond: freshCond(), chosen: [], questions: 0, asked: [], pending: null, seen: [], excludeSeen: false, exposed: [], cheapBoost: 1, lastMin: null, lastTop: [] });

function load(raw) {
  const s = { ...fresh(null), ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!DONGS.includes(s.dong)) s.dong = null;
  s.cond = { ...freshCond(), ...(s.cond && typeof s.cond === 'object' ? s.cond : {}) };
  for (const k of ['chosen', 'asked', 'seen', 'exposed', 'lastTop']) if (!Array.isArray(s[k])) s[k] = [];
  s.chosen = s.chosen.filter(c => c && typeof c.label === 'string' && Array.isArray(c.store_ids));
  if (!Array.isArray(s.pending)) s.pending = null;
  s.questions = Number(s.questions) || 0;
  s.cheapBoost = Math.min(Math.max(Number(s.cheapBoost) || 1, 1), 1.5);
  return s;
}

// 조건 변경 + 재계산 표(7단계): 업종이 바뀌면 질문 횟수·chosen 초기화. 기준가·수량은 매번 같은 입력으로 계산되므로 저장하지 않는다.
function setCond(state, next) {
  const prev = state.cond;
  const c = { ...prev };
  for (const k of ['menu', 'people', 'budget', 'budget_unit', 'price_pref', 'taste', 'franchise']) if (k in next) c[k] = next[k];
  if (!CATEGORIES.includes(c.menu)) c.menu = null;
  c.people = Number.isInteger(c.people) && c.people > 0 && c.people <= 20 ? c.people : null;
  c.budget = Number.isFinite(c.budget) && c.budget > 0 ? Math.round(c.budget) : null;
  if (!['total', 'per_person'].includes(c.budget_unit)) c.budget_unit = 'total';
  if (!['none', 'cheap', 'any'].includes(c.price_pref)) c.price_pref = 'none';
  c.taste = Array.isArray(c.taste) ? [...new Set(c.taste.map(t => String(t).trim()).filter(Boolean))].slice(0, 8) : [];
  if (!['none', 'exclude', 'only'].includes(c.franchise)) c.franchise = 'none';
  if (c.budget !== prev.budget || c.budget_unit !== prev.budget_unit) c.budget_under = !!next.budget_under;
  if (c.menu !== prev.menu) { state.questions = 0; state.chosen = []; state.asked = []; }
  state.cond = c; state.pending = null; state.excludeSeen = false; state.cheapBoost = 1;
}

// ---------- 1.5단계: 수량·기준가·가격 모드 ----------
export const qtyFor = (cat, people) => (PER_TWO.includes(cat) ? Math.ceil(people / 2) : people);

function ctx(state) {
  const c = state.cond, people = c.people || 1, qty = qtyFor(c.menu, people);
  const minTotal = s => (mains[s.id][0] ? mains[s.id][0].price * qty + s.tip : Infinity);
  // 기준가: 영업·프랜차이즈 무관, 같은 동+업종 → 5곳 미만이면 3개 동 → 그래도 5곳 미만이면 없음
  let pool = stores.filter(s => s.category === c.menu && s.dong === state.dong);
  if (pool.length < 5) pool = stores.filter(s => s.category === c.menu);
  const base = pool.length >= 5 ? median(pool.map(minTotal).filter(Number.isFinite)) : null;
  const totalBudget = c.budget == null ? null : c.budget_unit === 'per_person' ? c.budget * people : c.budget;
  const mode = totalBudget != null ? 'budget' : c.price_pref === 'any' ? 'any' : c.price_pref === 'cheap' ? 'cheap' : 'value';
  const rated = stores.filter(s => s.dong === state.dong && s.rating != null);
  const avgRating = rated.reduce((a, s) => a + s.rating, 0) / rated.length;
  return { qty, people, base, totalBudget, mode, avgRating, minTotal };
}

// ---------- 2단계: 필터 ----------
function filterStores(state, x, o = {}) {
  const c = { ...state.cond, ...o.cond };
  const chosen = o.chosen ?? state.chosen;
  const seen = (o.excludeSeen ?? state.excludeSeen) ? state.seen : [];
  const tb = o.totalBudget ?? x.totalBudget;
  const cheapCap = x.base == null ? Infinity : x.base * (o.cheapBoost ?? state.cheapBoost);
  return stores.filter(s => s.dong === state.dong && s.category === c.menu && s.open
    && !(c.franchise === 'exclude' && s.franchise) && !(c.franchise === 'only' && !s.franchise)
    && (x.mode !== 'budget' || x.minTotal(s) <= tb)
    && (x.mode !== 'cheap' || x.minTotal(s) <= cheapCap)
    && mains[s.id].some(m => m.price * x.qty >= s.minOrder)
    && (s.rating == null || s.rating >= 3.5)
    && !seen.includes(s.id)
    && chosen.every(ch => ch.store_ids.includes(s.id)));
}

// ---------- 5단계: 점수 ----------
export function priceScore(total, x) {
  if (x.mode === 'budget') return clamp((x.totalBudget - total) / (x.totalBudget * 0.3));
  if ((x.mode === 'value' || x.mode === 'cheap') && x.base) return clamp((x.base * 1.2 - total) / (x.base * 0.4));
  return 0.5;
}
export function ratingScore(s, avg) {
  const adj = s.rating == null ? avg : (s.reviews * s.rating + 10 * avg) / (s.reviews + 10);
  return clamp((adj - 3.5) / 1.5);
}

// ---------- AI 실패 시 코드만으로 판단 (메뉴 이름·설명 키워드) ----------
// terms의 각 항목은 단어 하나, 또는 "이 중 하나면 됨" 단어 배열 (비슷한 맛 대체용)
function keywordJudge(s, terms) {
  const ms = mains[s.id];
  if (!terms.length) return { match: '맞음', menu_ids: ms.slice(0, 5).map(m => m.id), quotes: {}, reason: '', words: [] };
  const hits = m => terms.map(t => [t].flat().find(w => `${m.name} ${m.desc}`.includes(w))).filter(Boolean);
  const best = Math.max(0, ...ms.map(m => hits(m).length));
  if (!best) return { match: '안 맞음', menu_ids: [], quotes: {}, reason: '', words: [] };
  const top = ms.filter(m => hits(m).length === best);
  const words = hits(top[0]);
  return {
    match: best === terms.length ? '맞음' : '일부',
    menu_ids: top.slice(0, 5).map(m => m.id), quotes: {},
    reason: `${words.join('·')} 조건에 맞는 메뉴가 있어요`, words,
  };
}

// 원하는 맛의 메뉴가 없을 때 대신 찾아볼 비슷한 맛 [제안 · 리허설에서 조정]
const SIMILAR = {
  크림: ['로제', '크리미', '치즈', '갈릭', '마늘'], 로제: ['크림', '크리미', '치즈'], 치즈: ['크림', '모짜렐라', '체다', '로제'],
  매운: ['매콤', '양념', '마라', '칼칼', '얼큰', '청양', '얼얼'], 마라: ['얼얼', '매운', '칼칼'], 칼칼: ['얼큰', '매콤', '짬뽕'], 얼큰: ['칼칼', '매콤'],
  간장: ['마늘', '데리야끼'], 마늘: ['갈릭', '간장'], 달콤: ['양념', '꿀', '단짠', '달큰'], 양념: ['달콤', '매콤'],
  담백: ['후라이드', '맑', '깔끔'], 바삭: ['튀김', '크리스피', '겉바속촉'], 불향: ['불맛', '화덕', '직화'], 해물: ['해산물', '새우', '오징어', '홍합'],
};

const TASTES = ['바삭', '간장', '양념', '마늘', '매운', '순살', '뼈', '치즈', '로제', '짜장', '짬뽕', '마라', '국물', '담백', '반반', '불향', '해물', '크림', '얼큰', '칼칼', '달콤', '화덕'];
const MENU_WORDS = [['치킨', /치킨|통닭|후라이드|닭강정/], ['중식', /중식|중국|짜장|짬뽕|탕수육|마라|꿔바로우/], ['분식', /분식|떡볶이|김밥|순대|라볶이/], ['피자', /피자/], ['찜·탕', /한식|찜|탕|국밥|해장|갈비/]];
// ---------- 오타 바로잡기 (자모 단위 편집 거리) ----------
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const jamo = s => [...s].map(ch => {
  const c = ch.charCodeAt(0) - 0xac00;
  return c < 0 || c > 11171 ? ch : CHO[(c / 588) | 0] + JUNG[((c % 588) / 28) | 0] + (c % 28 ? JONG[c % 28] : '');
}).join('');
// 소리가 비슷한 자모끼리는 0.5 (치긴→치킨, 깐장→간장, 피짜→피자, 프렌→프랜, 저럼→저렴), ㅇ 넣고 빼기도 0.5 (두리서→둘이서)
const ALIKE = ['ㄱㄲㅋ', 'ㄷㄸㅌ', 'ㅂㅃㅍ', 'ㅅㅆ', 'ㅈㅉㅊ', 'ㅐㅔ', 'ㅒㅖ', 'ㅙㅞㅚ', 'ㅓㅕ', 'ㅏㅑ', 'ㅗㅛ', 'ㅜㅠ'];
const subCost = (x, y) => (x === y ? 0 : ALIKE.some(g => g.includes(x) && g.includes(y)) ? 0.5 : 1);
const gapCost = x => (x === 'ㅇ' ? 0.5 : 1);
function lev(a, b) {
  let prev = [0];
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + gapCost(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    const cur = [prev[0] + gapCost(a[i - 1])];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + gapCost(a[i - 1]), cur[j - 1] + gapCost(b[j - 1]), prev[j - 1] + subCost(a[i - 1], b[j - 1]));
    prev = cur;
  }
  return prev[b.length];
}
// ponytail: 아는 단어 목록과 같은 음절 수 구간만, 소리 비슷한 오타만 교체(2음절 0.5 · 3~4음절 1 · 5음절 1.5). 메뉴 데이터 문장 374개로 오탐 0 확인.
// 흔한 다른 단어와 헷갈리는 말(한식↔간식, 반반↔반찬 등)은 목록에서 뺐다. 더 넓은 오타는 Claude(AI ①)가 맡는다.
const FUZZY = ['프랜차이즈', '꿔바로우', '후라이드', '처음부터', '떡볶이', '라볶이', '탕수육', '닭강정', '감자탕', '둘이서', '셋이서', '넷이서', '가성비',
  '치킨', '피자', '짜장', '짬뽕', '김밥', '순대', '분식', '중식', '찜닭', '국밥', '간장', '양념', '마늘', '바삭', '순살', '매운', '매콤', '치즈', '로제',
  '국물', '담백', '불향', '해물', '얼큰', '칼칼', '달콤', '화덕', '저렴'].map(w => [w, jamo(w)]);
export function fixTypos(text) {
  let s = String(text);
  const locked = new Array(s.length).fill(false); // 이미 맞게 쓴 단어 안쪽은 건드리지 않는다 (프랜차이즈의 '이즈'→치즈 방지)
  const lock = (i, n) => locked.fill(true, i, i + n);
  for (const [w] of FUZZY) for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) lock(i, w.length);
  for (const [w, wj] of FUZZY) {
    const max = w.length <= 2 ? 0.5 : w.length <= 4 ? 1 : 1.5;
    for (let i = 0; i + w.length <= s.length; i++) {
      const win = s.slice(i, i + w.length);
      if (locked.slice(i, i + w.length).some(Boolean) || !/^[가-힣]+$/.test(win) || lev(jamo(win), wj) > max) continue;
      s = s.slice(0, i) + w + s.slice(i + w.length);
      lock(i, w.length);
    }
  }
  return s;
}

// AI ① 실패 시 규칙 기반 조건 정리
export function ruleParse(raw, cur) {
  const t = fixTypos(raw);
  const out = {};
  const menu = MENU_WORDS.find(([, re]) => re.test(t))?.[0];
  if (menu) out.menu = menu;
  const n = t.match(/(\d+)\s*(?:명|인(?!당))/);
  const p = n ? Number(n[1]) : /혼자|한\s*명(?!에|당)/.test(t) ? 1 : /둘|두\s*명/.test(t) ? 2 : /셋|세\s*명/.test(t) ? 3 : /넷|네\s*명/.test(t) ? 4 : null;
  if (p) out.people = p;
  if (hasPrice(t)) {
    out.budget = parseAmount(t);
    out.budget_unit = /인당|1인|한\s*명(에|당)/.test(t) ? 'per_person' : 'total';
  }
  if (/가격\s*(은|는)?\s*상관\s*없|비싸도/.test(t)) { out.price_pref = 'any'; out.budget = null; }
  else if (/싸게|가성비|저렴/.test(t)) out.price_pref = 'cheap';
  if (/프랜차이즈\s*(말고|빼고|제외|싫|x)/i.test(t)) out.franchise = 'exclude';
  else if (/프랜차이즈\s*만/.test(t)) out.franchise = 'only';
  else if (/프랜차이즈(도)?\s*(괜찮|상관)/.test(t)) out.franchise = 'none';
  const found = TASTES.filter(w => t.includes(w)).concat(/매콤|맵/.test(t) && !t.includes('매운') ? ['매운'] : []);
  // 메뉴를 다시 말하면 새 요청 → 맛 조건 교체. 맛만 말하면 추가. "아무거나"는 맛 조건 비우기.
  if (/아무\s*거나|다\s*좋아/.test(t)) out.taste = [];
  else if (menu || /바꿔/.test(t)) out.taste = found;
  else if (found.length) out.taste = [...cur.taste, ...found];
  return out;
}

// ---------- 화면용 ----------
const man = n => `${+(n / 10000).toFixed(1)}만 원`;
const won = n => `${n.toLocaleString('ko-KR')}원`;
const menuButtons = () => CATEGORIES.map(c => ({ label: c, action: { type: 'apply', cond: { menu: c } } }));
const followUps = () => ['다른 데는?', '더 싸게', '처음부터'].map(t => ({ label: t, action: { type: 'text', text: t }, ghost: true }));

function chips(state) {
  const c = state.cond;
  if (!c.menu) return [];
  const out = [{ label: c.menu }, { label: `${c.people || 1}인` }];
  if (c.budget) {
    const tb = c.budget_unit === 'per_person' ? c.budget * (c.people || 1) : c.budget;
    out.push({ label: c.budget_under ? `${man(tb)} 미만` : `총 ${man(tb)}↓`, kind: 'price', remove: { type: 'apply', cond: { budget: null, price_pref: 'none' } } });
  } else if (c.price_pref === 'cheap') out.push({ label: '싸게', kind: 'price', remove: { type: 'apply', cond: { price_pref: 'none' } } });
  else if (c.price_pref === 'any') out.push({ label: '가격 무관', kind: 'price', remove: { type: 'apply', cond: { price_pref: 'none' } } });
  else out.push({ label: '가성비 우선', kind: 'price', accent: true, remove: { type: 'apply', cond: { price_pref: 'any' } } });
  for (const t of c.taste) out.push({ label: t, remove: { type: 'apply', cond: { taste: c.taste.filter(x => x !== t) } } });
  if (c.franchise !== 'none') out.push({ label: c.franchise === 'exclude' ? '프랜차이즈 X' : '프랜차이즈만', remove: { type: 'apply', cond: { franchise: 'none' } } });
  for (const ch of state.chosen) out.push({ label: ch.label, remove: { type: 'apply', chosenRemove: ch.label } });
  return out;
}

// ---------- 가게 이름으로 찾기 ----------
// "꼬꼬닭 서초4동점" → "꼬꼬닭". 이름 전체가 말에 들어 있거나, 말의 한 단어가 이름의 60% 이상을 덮으면 그 가게
// (60%: "감자탕"이 "순이네감자탕"에, "김치찜"이 "김치찜하는날"에 걸리지 않게)
const storeBase = name => name.replace(/\s+\S+점$/, '').replace(/\s+/g, '').toLowerCase();
const STORE_BASES = stores.map(s => [s, storeBase(s.name)]).filter(([, b]) => b.length >= 2);
export function findStores(text) {
  const t = String(text).toLowerCase();
  const whole = t.replace(/\s+/g, '');
  const words = t.split(/[\s,.!?~]+/).filter(w => w.length >= 3);
  return STORE_BASES.filter(([, b]) => whole.includes(b) || words.some(w => b.includes(w) && w.length / b.length >= 0.6)).map(([s]) => s);
}
function storeReply(state, named) {
  const here = named.filter(s => s.dong === state.dong);
  const list = (here.length ? here : named).slice(0, 3);
  const people = state.cond.people || 1;
  const cards = list.map(s => {
    const qty = qtyFor(s.category, people), m = mains[s.id][0];
    return {
      name: s.name, menu: m.name, qty: qty >= 2 ? qty : null, total: m.price * qty + s.tip,
      checks: [s.open ? '영업중' : '지금은 영업 안 함', s.franchise ? '프랜차이즈' : '개인 가게'],
      isNew: s.reviews === 0, rating: s.rating, reviews: s.reviews,
      reason: `${s.dong} ${s.category} · 가장 싼 메인 메뉴 기준 가격이에요`, quote: m.desc,
    };
  });
  const dongs = [...new Set(list.map(s => s.dong))].join('·');
  const cats = [...new Set(list.map(s => s.category))].filter(c => CATEGORIES.includes(c));
  return {
    text: here.length ? '찾으신 가게예요.' : `찾으신 가게는 ${state.dong}이 아니라 ${dongs}에 있어요.`,
    cards, lookup: true,
    buttons: cats.map(c => ({ label: `${state.dong} ${c} 추천 받기`, action: { type: 'apply', cond: { menu: c } } })),
  };
}

const out = (state, reply) => ({ state, reply: { ...reply, chips: chips(state) } });

// ---------- 양보안 ----------
function concessions(state, x, leftIds) {
  const res = [];
  const more = leftIds.size ? ' 더' : '';
  const add = (text, o, action) => {
    const n = filterStores(state, x, o).filter(s => !leftIds.has(s.id)).length;
    if (n) { res.push({ label: text(n), action }); return true; }
    return false;
  };
  if (x.mode === 'budget') {
    for (const d of [2000, 5000]) {
      if (add(n => `${won(d)}만 더 쓰면 ${n}곳${more} 있어요`, { totalBudget: x.totalBudget + d },
        { type: 'apply', cond: { budget: x.totalBudget + d, budget_unit: 'total' } })) break;
    }
  }
  if (x.mode === 'cheap' && x.base && state.cheapBoost < 1.1) {
    add(n => `동네 보통 가격보다 10% 더 써도 되면 ${n}곳${more} 있어요`, { cheapBoost: 1.1 }, { type: 'apply', cheapBoost: 1.1 });
  }
  if (state.chosen.length) {
    const last = state.chosen.at(-1);
    add(n => `'${last.label}' 말고 다른 것도 괜찮으면 ${n}곳${more} 있어요`, { chosen: state.chosen.slice(0, -1) }, { type: 'apply', chosenRemove: last.label });
  }
  if (state.cond.franchise === 'exclude') {
    add(n => `프랜차이즈도 괜찮으면 ${n}곳${more} 있어요`, { cond: { franchise: 'none' } }, { type: 'apply', cond: { franchise: 'none' } });
  }
  if (state.excludeSeen && !leftIds.size) {
    add(n => `새 가게는 더 없어요. 아까 본 ${n}곳 다시 볼까요?`, { excludeSeen: false }, { type: 'apply', seenAgain: true });
  }
  return res.slice(0, 3);
}

function zero(state, x, leftIds = new Set(), lead = '지금 조건으로는 가게가 없어요.') {
  const cs = concessions(state, x, leftIds);
  if (!cs.length) return out(state, { text: '조건에 맞는 가게가 없어요.', buttons: [{ label: '처음부터', action: { type: 'text', text: '처음부터' } }], remaining: 0 });
  return out(state, { text: `${lead} 이렇게 바꿔 볼까요?`, buttons: cs, remaining: 0 });
}

const aiCond = c => ({ menu: c.menu, people: c.people || 1, taste: c.taste, franchise: c.franchise }); // 가격 정보는 AI ②③에 안 넘긴다

// ---------- 3단계: 좁히기 질문 ----------
async function question(state, left, ai) {
  let q;
  try {
    q = await ai.question({
      cond: aiCond(state.cond), chosen: state.chosen.map(c => c.label), asked: state.asked,
      stores: left.map(s => ({ store_id: s.id, menus: mains[s.id].map(m => ({ name: m.name, desc: m.desc.slice(0, 100) })) })),
    });
  } catch (e) { console.warn('[AI ②] 실패 → 질문 없이 결과로:', e.message); return null; }
  const ids = new Set(left.map(s => s.id));
  const opts = (q.options || [])
    .filter(o => o && typeof o.label === 'string' && o.label.trim() && !hasPrice(o.label) && o.label !== '상관없어요')
    .map(o => ({ label: o.label.trim().slice(0, 30), store_ids: [...new Set(o.store_ids || [])].filter(id => ids.has(id)) }))
    .filter(o => o.store_ids.length)
    .slice(0, 5);
  if (opts.length < 2 || new Set(opts.map(o => [...o.store_ids].sort().join())).size < 2) return null; // 더 나눌 기준 없음
  state.questions++; state.asked.push(String(q.question)); state.pending = opts;
  return {
    text: String(q.question),
    buttons: [...opts.map((o, i) => ({ label: `${o.label} (${o.store_ids.length}곳)`, action: { type: 'option', index: i } })),
      { label: '상관없어요', action: { type: 'option', index: -1 } }],
    remaining: left.length,
  };
}

// ---------- 4·5·6단계: 맞음 판단 → 대표 메뉴·점수·TOP3 → 카드 ----------
async function results(state, x, left, ai) {
  const pre = s => priceScore(x.minTotal(s), x) * 30 + ratingScore(s, x.avgRating) * 20;
  const cands = left.length > 8 ? [...left].sort((a, b) => pre(b) - pre(a) || expo(a.id) - expo(b.id)).slice(0, 8) : left;
  const terms = [...state.cond.taste, ...state.chosen.map(c => c.label)];

  const judged = new Map();
  try {
    const res = await ai.judge({
      cond: aiCond(state.cond), chosen: state.chosen.map(c => c.label),
      stores: cands.map(s => ({ store_id: s.id, menus: mains[s.id].map(m => ({ menu_id: m.id, name: m.name, desc: m.desc.slice(0, 100) })) })),
    });
    const byId = new Map(cands.map(s => [s.id, s]));
    for (const j of res || []) {
      const s = byId.get(j?.store_id);
      if (!s || judged.has(s.id) || !['맞음', '일부', '안 맞음'].includes(j.match)) continue; // 없는 가게 버림
      const valid = new Map(mains[s.id].map(m => [m.id, m]));
      const quotes = {};
      for (const q of j.quotes || []) {
        const m = valid.get(q?.menu_id);
        if (m && q.quote && m.desc.includes(q.quote)) quotes[m.id] = q.quote; // 원문 인용만
      }
      const reason = String(j.reason || '');
      judged.set(s.id, {
        match: j.match,
        menu_ids: (j.menu_ids || []).filter(id => valid.has(id)).slice(0, 5),
        quotes,
        reason: hasPrice(reason) || /저렴|가성비|싸게|싸요|별점/.test(reason) ? '' : reason,
      });
    }
  } catch (e) { console.warn('[AI ③] 실패 → 키워드 판단:', e.message); }
  for (const s of cands) if (!judged.has(s.id)) judged.set(s.id, keywordJudge(s, terms));

  const scoreAll = judgedMap => {
    const res = [];
    for (const s of cands) {
      const j = judgedMap.get(s.id);
      if (j.match === '안 맞음') continue;
      const opts = j.menu_ids.map(id => mains[s.id].find(m => m.id === id))
        .filter(m => m.price * x.qty >= s.minOrder)
        .map(m => ({ m, total: m.price * x.qty + s.tip }))
        .filter(o => x.mode !== 'budget' || o.total <= x.totalBudget)
        .sort((a, b) => a.total - b.total);
      if (!opts.length) continue; // 대표 메뉴 없으면 제외
      const { m, total } = opts[0];
      const score = (j.match === '맞음' ? 50 : 25) + priceScore(total, x) * 30 + ratingScore(s, x.avgRating) * 20;
      res.push({ s, j, m, total, score });
    }
    return res;
  };
  let scored = scoreAll(judged);

  // 맛 조건(예: 크림)을 가진 메뉴가 후보 어디에도 없어서 0곳이면: 그 조건만 비슷한 맛으로 바꿔서 → 그래도 없으면 빼고 다시 고른다.
  // 예산·프랜차이즈 등 필터는 그대로이고, 바꾼 사실은 화면에 밝힌다 (몰래 풀지 않음). 결과는 '일부'로만 표시.
  let swapped = null;
  const inMenus = w => cands.some(s => mains[s.id].some(m => `${m.name} ${m.desc}`.includes(w)));
  const missing = terms.filter(t => !inMenus(t));
  if (!scored.length && terms.length) {
    if (missing.length) {
      const kept = terms.filter(t => !missing.includes(t));
      const alike = [...new Set(missing.flatMap(t => SIMILAR[t] || []))].filter(inMenus);
      for (const tryTerms of alike.length ? [[...kept, alike], kept] : [kept]) {
        const relaxed = new Map(cands.map(s => {
          const j = keywordJudge(s, tryTerms);
          const near = j.words.filter(w => alike.includes(w));
          return [s.id, { ...j, match: j.match === '안 맞음' ? j.match : '일부',
            reason: near.length ? `'${missing.join('·')}' 대신 비슷한 ${near.join('·')} 메뉴예요` : '' }];
        }));
        scored = scoreAll(relaxed);
        if (scored.length) { swapped = { missing, similar: tryTerms.some(Array.isArray) }; break; }
      }
    }
  }
  const leftIds = new Set(left.map(s => s.id));
  if (!scored.length) return zero(state, x, new Set(), '조건에 딱 맞는 가게가 없어요.');

  scored.sort((a, b) => b.score - a.score);
  const [first, ...rest] = scored;
  const peers = rest.filter(r => first.score - r.score <= 5).sort((a, b) => expo(a.s.id) - expo(b.s.id) || Math.random() - 0.5);
  const pick = [first, ...peers.slice(0, 2)];
  for (const r of rest) if (pick.length < 3 && !pick.includes(r)) pick.push(r);
  pick.sort((a, b) => b.score - a.score);

  for (const { s } of pick) {
    if (!state.exposed.includes(s.id)) { expo(s.id); exposure.counts[s.id] = (exposure.counts[s.id] ?? 0) + 1; state.exposed.push(s.id); }
    if (!state.seen.includes(s.id)) state.seen.push(s.id);
  }
  state.lastMin = Math.min(...pick.map(p => p.total));

  const c = state.cond;
  const cards = pick.map(({ s, j, m, total, score }) => {
    const checks = ['영업중'];
    if (c.franchise === 'exclude') checks.push('프랜차이즈 아님');
    if (c.franchise === 'only') checks.push('프랜차이즈');
    if (j.match === '맞음') checks.push(...c.taste, ...state.chosen.map(ch => ch.label));
    if (x.mode === 'budget') checks.push('예산');
    const save = x.base ? Math.round((x.base - total) / 1000) * 1000 : 0;
    return {
      name: s.name, menu: m.name, qty: x.qty >= 2 ? x.qty : null, total, checks,
      partial: j.match === '일부',
      valueLabel: x.base && x.base - total >= 1000 ? `동네 ${c.menu} 보통 가격보다 ${won(save)} 저렴` : null,
      isNew: s.reviews === 0, rating: s.rating, reviews: s.reviews,
      reason: j.reason, quote: j.quotes[m.id] || Object.values(j.quotes)[0] || '',
      score: Math.round(score * 10) / 10,
    };
  });
  // 조건(예산 등)을 바꿨는데 TOP3가 그대로면, 고장처럼 보이지 않게 이유를 말해 준다
  const ids = pick.map(p => p.s.id);
  const same = state.lastTop.length === ids.length && ids.every(id => state.lastTop.includes(id));
  state.lastTop = ids;
  const where = x.mode === 'budget' ? '예산 안에 드는' : '조건에 맞는';
  const text = swapped ? `'${swapped.missing.join('·')}' 메뉴가 있는 가게는 없어요. 대신 ${x.mode === 'budget' ? '같은 예산 안에서 ' : ''}${swapped.similar ? '비슷한 메뉴가 있는' : '다른 조건이 맞는'} 곳을 골랐어요.`
    : missing.length ? `'${missing.join('·')}' 메뉴가 있는 가게는 없어서, 나머지 조건으로 ${left.length}곳 중 ${cards.length}곳을 골랐어요.`
    : !same ? `남은 ${left.length}곳 중 ${cards.length}곳을 골랐어요.`
    : left.length === cards.length ? `${where} 가게는 이 ${cards.length}곳이 전부라 결과가 그대로예요.`
    : `${where} ${left.length}곳 중에서는 이 ${cards.length}곳이 가장 잘 맞아요. 다른 곳도 보시려면 '다른 데는?'을 눌러 주세요.`;
  const unseen = left.some(s => !state.seen.includes(s.id)); // 안 본 가게가 없으면 '다른 데는?'은 빈손이라 숨긴다
  return out(state, {
    text,
    banner: x.mode === 'value' ? '예산을 말씀 안 하셔서 가성비 좋은 곳 위주로 골랐어요.' : null,
    cards,
    buttons: [...(cards.length < 3 ? concessions(state, x, leftIds) : []), ...followUps().filter(b => unseen || b.label !== '다른 데는?')],
    remaining: left.length,
  });
}

async function fromStep2(state, ai) {
  const x = ctx(state);
  const left = filterStores(state, x);
  if (!left.length) return zero(state, x);
  if (left.length >= 4 && state.questions < 3) {
    const q = await question(state, left, ai);
    if (q) return out(state, q);
  }
  return results(state, x, left, ai);
}

// ---------- 진입점 ----------
export async function handle(raw, action, ai = realAi) {
  const state = load(raw);
  const a = action && typeof action === 'object' ? action : {};

  if (a.type === 'dong') {
    if (!DONGS.includes(a.dong)) throw new Error('bad dong');
    Object.assign(state, fresh(a.dong));
    return out(state, { text: `${a.dong}에서 찾아볼게요. 뭐 드시고 싶으세요? 인원·예산·취향을 편하게 말씀해 주세요.`, buttons: menuButtons() });
  }
  if (!state.dong) return out(state, { text: '먼저 동네를 골라 주세요.' });

  if (a.type === 'option') {
    const o = (state.pending || [])[a.index];
    if (o) state.chosen.push(o);
    state.pending = null;
    return fromStep2(state, ai);
  }

  if (a.type === 'apply') {
    setCond(state, a.cond && typeof a.cond === 'object' ? a.cond : {});
    if (a.chosenRemove) state.chosen = state.chosen.filter(ch => ch.label !== a.chosenRemove);
    if (a.cheapBoost) state.cheapBoost = Math.min(Number(a.cheapBoost) || 1, 1.5);
    if (!state.cond.menu) return out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
    if (a.seenAgain) { const x = ctx(state); const left = filterStores(state, x); return left.length ? results(state, x, left, ai) : zero(state, x); }
    return fromStep2(state, ai);
  }

  if (a.type === 'text') {
    const t = String(a.text || '').trim().slice(0, 300);
    const ft = fixTypos(t);
    if (!t) return out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
    if (/처음\s*부터|다시\s*시작/.test(ft)) {
      Object.assign(state, fresh(state.dong));
      return out(state, { text: '처음부터 다시 할게요. 뭐 드시고 싶으세요?', buttons: menuButtons() });
    }
    if (state.cond.menu && /다른\s*(데|대|곳|가게|집)/.test(ft)) { // 4단계부터, 질문 없이
      state.excludeSeen = true; state.pending = null;
      const x = ctx(state); const left = filterStores(state, x);
      return left.length ? results(state, x, left, ai) : zero(state, x);
    }
    if (state.cond.menu && state.lastMin && /더\s*(싸게|사게|저렴|싼)/.test(ft)) { // "더 싸게"는 코드가 상한 계산
      setCond(state, { budget: state.lastMin - 1, budget_unit: 'total', price_pref: 'none', budget_under: true });
      return fromStep2(state, ai);
    }
    const named = findStores(ft);
    if (named.length) return out(state, storeReply(state, named));
    let parsed;
    try { parsed = await ai.parse(t, aiParseCond(state.cond)); }
    catch (e) { console.warn('[AI ①] 실패 → 규칙 기반:', e.message); parsed = ruleParse(t, state.cond); }
    // AI가 지어낸 예산 삭제: 원문에 가격 패턴이 없는데 예산이 바뀌었으면 되돌린다
    if ('budget' in parsed && parsed.budget !== state.cond.budget && !hasPrice(t)) parsed.budget = state.cond.budget;
    const before = JSON.stringify(aiParseCond(state.cond));
    const understood = Object.keys(ruleParse(t, state.cond)).length > 0;
    setCond(state, parsed);
    if (!state.cond.menu) return out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
    // 알아들은 게 없고 조건도 그대로면, 이전 결과를 반복하지 말고 못 알아들었다고 말한다
    if (!understood && JSON.stringify(aiParseCond(state.cond)) === before) {
      return out(state, {
        text: `'${t.slice(0, 20)}'은(는) 이 동네 가게나 메뉴에서 찾지 못했어요. 메뉴·맛·인원·예산이나 가게 이름으로 말씀해 주세요.`,
        buttons: menuButtons(),
      });
    }
    return fromStep2(state, ai);
  }
  throw new Error('bad action');
}

const aiParseCond = c => ({ menu: c.menu, people: c.people, budget: c.budget, budget_unit: c.budget_unit, price_pref: c.price_pref, taste: c.taste, franchise: c.franchise });
