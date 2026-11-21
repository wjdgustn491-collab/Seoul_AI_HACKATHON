import { createLLM } from "../lib/llm/index.js";
import { createEngine } from "../lib/engine.js";
import { loadIndex, loadZone, engineSnapshot, hasDong, guOfDong, dataCategories } from "../lib/catalog.js";
import { supabaseConfig } from "../dist/supabase-config.js";

// 턴 전체 시간 예산. 남은 시간이 부족하면 AI 재요청 없이 규칙 기반 폴백.
const TURN_BUDGET_MS = 12000;
// 가게 데이터: dist/data의 동별 JSON(node scripts/build-data.mjs). 주문자 동 + 3km 안의 동만 읽는다.
// 엔진은 주문자 동마다 하나씩 만들어 캐시한다.
const ENGINE_CACHE = 30; // ponytail: 단순 LRU 30개. 동마다 수천 곳이라 메모리가 빠듯하면 줄일 것.
const engines = new Map();
// 노출 횟수는 모든 동 엔진이 같이 쓴다 (추천에 노출되면 +1, 동점이면 덜 노출된 가게 먼저)
const exposure = { day: "", counts: {} };

export function engineFor(dong) {
  if (engines.has(dong)) {
    const value = engines.get(dong);
    engines.delete(dong); engines.set(dong, value); // 최근 사용으로
    return value;
  }
  const value = createEngine(engineSnapshot(dong), { zone: loadZone(), exposure, guided: true });
  engines.set(dong, value);
  if (engines.size > ENGINE_CACHE) engines.delete(engines.keys().next().value);
  return value;
}
// scripts/bench.js 호환
export const engine = async (dong = "서초4동") => engineFor(dong);

// 문장에 나온 동 이름 (긴 이름 먼저, "신사동(은평구)"는 괄호 없이 말해도 같은 구 표기가 없는 쪽 우선)
let dongNames;
function dongInText(text) {
  dongNames ??= loadIndex().dongs.map(d => d.dong).sort((a, b) => b.length - a.length);
  return dongNames.find(name => text.includes(name)) ?? null;
}

// ---------- 사장님 메뉴 수정 반영 (팀 main 코드) ----------
// 사장님 화면은 Supabase 데모 카탈로그(4,672곳)의 가게를 고친다. 이 카탈로그와 dist/data는 가게·메뉴 id 체계가 달라서
// 수정 내역이 있는 브라우저만 데모 카탈로그 + 수정 내역으로 추천한다(동 단위·대화형 흐름 없음).
// ponytail: 카탈로그 두 개. 사장님 가게를 dist/data id로 저장하게 되면 수정 내역을 동 엔진에 바로 덮고 이 경로는 지울 것.
const CATALOG_TIMEOUT_MS = 15000;
const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog;
let loading;

async function baseCatalog() {
  if (catalog?.expires > Date.now()) return catalog;
  loading ??= (async () => {
    const response = await fetch(supabaseConfig.url + "/rest/v1/rpc/seoul_recommendation_snapshot", {
      method: "POST",
      headers: { apikey: supabaseConfig.publishableKey, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error("Supabase response " + response.status);
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.stores) || !Array.isArray(snapshot.menus)) throw new Error("Catalog response invalid");
    catalog = { snapshot, expires: Date.now() + CATALOG_TTL_MS };
    return catalog;
  })().finally(() => { loading = undefined; });
  return loading;
}

async function menuChanges(browserKey) {
  const response = await fetch(supabaseConfig.url + '/rest/v1/rpc/seoul_delivery_demo', {
    method: 'POST',
    headers: { apikey: supabaseConfig.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'recommendation_menu_changes', browser_key: browserKey }),
    signal: AbortSignal.timeout(6500),
  });
  const changes = await response.json();
  // During a staggered deploy, the older RPC still serves the base catalog.
  if (response.status === 400 && changes?.code === 'P0001' && changes.message === '지원하지 않는 시연 요청입니다.') return [];
  if (!response.ok || !Array.isArray(changes)) throw new Error('Supabase menu changes response ' + response.status);
  return changes;
}

async function editedEngine(changes) {
  const base = await baseCatalog();
  const edits = new Map(changes.map(menu => [menu.id, menu]));
  const isAvailable = menu => menu.available && !menu.removed;
  const menus = [];
  for (const menu of base.snapshot.menus) {
    const edit = edits.get(menu.id);
    edits.delete(menu.id);
    if (!edit) menus.push(menu);
    else if (isAvailable(edit)) menus.push({ ...menu, ...edit });
  }
  for (const menu of edits.values()) if (isAvailable(menu)) menus.push(menu);
  return createEngine({ stores: base.snapshot.stores, menus });
}

export default async function recommend(req, res) {
  const started = Date.now();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "지원하지 않는 요청입니다." });
  }

  if (req.method === "GET") {
    try {
      const { dongs } = loadIndex();
      return res.status(200).json({
        dongs: dongs.map(({ dong, gu, lat, lon }) => ({ dong, gu, lat, lon })),
        regions: [...new Set(dongs.map(d => d.gu))].sort((a, b) => a.localeCompare(b, "ko")),
        categories: dataCategories(),
      });
    } catch (error) {
      console.warn("Recommendation data unavailable:", error.message);
      return res.status(503).json({ error: "가게 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
    }
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "추천 요청을 읽을 수 없습니다." }); }
  const action = body?.action;
  if (!["dong", "text", "apply", "option", "stage"].includes(action?.type) ||
      (action.type === "stage" && (body.flow !== "guided" || !["people", "menu", "taste", "extra", "budget"].includes(action.stage))) ||
      (action.type === "text" && (typeof action.text !== "string" || action.text.length > 300)) ||
      (body.browserKey !== undefined && (typeof body.browserKey !== "string" ||
        !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.browserKey))) ||
      JSON.stringify(body).length > 50000) {
    return res.status(400).json({ error: "지역이나 음식 요청을 확인해 주세요." });
  }
  let changes = [];
  if (body.browserKey) {
    try { changes = await menuChanges(body.browserKey); }
    catch (error) { console.warn("Menu changes unavailable:", error.message); } // 못 읽으면 원래 데이터로 추천
  }
  if (changes.length) {
    let edited;
    try { edited = await editedEngine(changes); }
    catch (error) {
      console.warn("Recommendation catalog unavailable:", error.message);
      return res.status(503).json({ error: "가게 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
    }
    if (action.type === "dong" && !edited.regions.includes(action.dong)) {
      return res.status(400).json({ error: "목록에 표시된 지역을 골라 주세요." });
    }
    return respond(res, edited, body.state, { ...action, staged: body.flow === "guided" }, started, Date.now() - started);
  }

  if (action.type === "dong" && !(hasDong(action.neighborhood) && guOfDong(action.neighborhood) === action.dong)) {
    return res.status(400).json({ error: "목록에 표시된 동네를 골라 주세요." });
  }

  // 주문자 동: 고른 동 → 문장에 나온 동 → 대화에 저장된 동
  const customerDong = action.type === "dong" ? action.neighborhood
    : (action.type === "text" && dongInText(action.text)) || (hasDong(body.state?.neighborhood) ? body.state.neighborhood : null);
  if (!customerDong) {
    return res.status(200).json({ state: body.state ?? null, reply: { text: "먼저 배달받을 동네를 골라 주세요.", chips: [], needDong: true }, provider: "rules" });
  }

  let current;
  try { current = engineFor(customerDong); }
  catch (error) {
    console.warn("Recommendation data unavailable:", error.message);
    return res.status(503).json({ error: "가게 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
  }
  const catalogMs = Date.now() - started;
  // 다른 동 엔진으로 넘어온 대화면 주문자 동을 맞춰 준다
  const state = body.state && action.type !== "dong" && body.state.neighborhood !== customerDong
    ? { ...body.state, dong: guOfDong(customerDong), neighborhood: customerDong } : body.state;
  return respond(res, current, state, { ...action, staged: body.flow === "guided" }, started, catalogMs);
}

async function respond(res, current, state, action, started, catalogMs) {
  const ai = process.env.RECOMMENDATION_MODE === "rules" ? undefined
    : createLLM(process.env, { deadline: Date.now() + TURN_BUDGET_MS });
  try {
    const result = await current.handle(state, action, ai);
    const timing = { catalog: catalogMs, ...ai?.timing, total: Date.now() - started };
    return res.status(200).json({ ...result, provider: ai?.used ? ai.provider : "rules", timing });
  } catch (error) {
    console.warn("Recommendation request failed:", error.message);
    return res.status(400).json({ error: "요청을 처리하지 못했어요. 지역과 조건을 다시 확인해 주세요." });
  }
}
