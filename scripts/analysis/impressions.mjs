// 분석용: [요청사항 2] 노출 횟수 확인 시나리오. 기존 코드는 import만 하고 바꾸지 않는다.
// 데이터: local/catalog.json (실제 Supabase snapshot을 받아 저장한 것. exposure_count = DB impressions)
// 실행: node scripts/analysis/impressions.mjs
import { readFileSync } from 'node:fs';
import { createEngine } from '../../lib/engine.js';

const noAI = new Proxy({}, { get: () => async () => { throw Error('LLM unavailable'); } });
const snapshot = JSON.parse(readFileSync(new URL('../../local/catalog.json', import.meta.url), 'utf8'));
const dbValue = new Map(snapshot.stores.map(s => [s.id, s.exposure_count ?? 0]));
const nameOf = new Map(snapshot.stores.map(s => [s.id, s.name]));
const QUESTION = '치킨';
const GU = '성동구';

// 엔진 안의 메모리 카운트는 밖에서 못 읽으므로, 엔진이 쓰는 규칙(state.exposed에 새로 들어간 가게만 +1)을 그대로 따라 센다
function makeRun(engine) {
  const memory = new Map();
  const turn = async (state, action) => {
    const before = new Set(state?.exposed ?? []);
    const memoryBefore = new Map(memory);
    const r = await engine.handle(state, action, noAI);
    for (const id of r.state.exposed) if (!before.has(id)) memory.set(id, (memory.get(id) ?? 0) + 1);
    r.memoryBefore = memoryBefore; r.memoryAfter = new Map(memory); // 이 요청 전·후 메모리 값
    return r;
  };
  return { memory, turn };
}

function row(label, r, memory, watched) {
  const top = r.reply.cards.map(c => c.storeId);
  const scores = r.reply.cards.map(c => c.score);
  const within5 = scores.every(s => scores[0] - s <= 5);
  // 이 회차 정렬 때 쓰인 값 = 직전 회차까지의 메모리 (+ DB). 회차 뒤 값은 괄호.
  const cells = Object.fromEntries(watched.map(id => [nameOf.get(id), `DB ${dbValue.get(id)} / 메모리 ${r.memoryBefore.get(id) ?? 0}→${r.memoryAfter.get(id) ?? 0}`]));
  return { 회차: label, TOP3: top.map(id => nameOf.get(id)).join(' > '), 점수: scores.join(' / '), '1등과 5점 이내': within5 ? '예' : '아니오', ...cells };
}

async function scenarioA(engine, rounds = 3) {
  const { memory, turn } = makeRun(engine);
  const rows = [], tops = [];
  for (let i = 1; i <= rounds; i++) {
    const area = await turn(undefined, { type: 'dong', dong: GU });
    const r = await turn(area.state, { type: 'text', text: QUESTION });
    tops.push(r.reply.cards.map(c => c.storeId));
    rows.push(r);
  }
  return { memory, rows, tops };
}

async function scenarioB(engine, rounds = 3) {
  const { memory, turn } = makeRun(engine);
  const rows = [], tops = [];
  let s = (await turn(undefined, { type: 'dong', dong: GU })).state;
  for (let i = 1; i <= rounds; i++) {
    const r = await turn(s, { type: 'text', text: QUESTION });
    tops.push(r.reply.cards.map(c => c.storeId));
    rows.push(r);
    s = (await turn(r.state, { type: 'text', text: '처음부터' })).state;
  }
  return { memory, rows, tops };
}

async function scenarioC(engine, rounds = 3) { // 같은 대화에서 "처음부터" 없이 같은 질문 반복
  const { memory, turn } = makeRun(engine);
  const rows = [], tops = [];
  let s = (await turn(undefined, { type: 'dong', dong: GU })).state;
  for (let i = 1; i <= rounds; i++) {
    const r = await turn(s, { type: 'text', text: QUESTION });
    tops.push(r.reply.cards.map(c => c.storeId));
    rows.push(r);
    s = r.state;
  }
  return { memory, rows, tops };
}

const changes = tops => tops.slice(1).map((t, i) => t.slice(1).join() !== tops[i].slice(1).join()).filter(Boolean).length;

async function report(title, randomMode) {
  const realRandom = Math.random;
  if (randomMode === 'fixed') Math.random = () => 0.5; // 분석용 고정값 (비교 함수가 0을 돌려 동점이면 순서 유지)
  try {
    console.log(`\n# ${title}`);
    for (const [name, fn] of [['(a) 새 대화 3번', scenarioA], ['(b) 한 대화에서 "처음부터" 후 3번', scenarioB], ['(c) 한 대화에서 "처음부터" 없이 같은 질문 3번', scenarioC]]) {
      const engine = createEngine(snapshot); // 서버 인스턴스 1개 = 엔진 1개 (메모리 카운트는 엔진 안에만 있음)
      const { memory, rows, tops } = await fn(engine);
      const watched = [...new Set(tops.flat())];
      console.log(`\n## ${name} — 2·3등이 바뀐 횟수: ${changes(tops)} / ${tops.length - 1}`);
      console.table(rows.map((r, i) => row(`${i + 1}회`, r, memory, watched)));
    }
  } finally { Math.random = realRandom; }
}

await report('무작위 그대로 (현재 코드)', 'real');
await report('Math.random 고정 (분석용, 노출 값만으로 순서가 바뀌는지)', 'fixed');

// 서버 재시작·다른 서버리스 인스턴스: 엔진을 새로 만들면 메모리 카운트가 사라진다
{
  const realRandom = Math.random; Math.random = () => 0.5;
  try {
    const first = createEngine(snapshot), second = createEngine(snapshot);
    const ask = async e => { const a = await e.handle(undefined, { type: 'dong', dong: GU }, noAI); return (await e.handle(a.state, { type: 'text', text: QUESTION }, noAI)).reply.cards.map(c => nameOf.get(c.storeId)).join(' > '); };
    const a1 = await ask(first), a2 = await ask(first), b1 = await ask(second);
    console.log('\n# 인스턴스가 바뀌면');
    console.table([{ 상황: '인스턴스1 첫 요청', TOP3: a1 }, { 상황: '인스턴스1 두 번째 요청', TOP3: a2 }, { 상황: '인스턴스2(재시작) 첫 요청', TOP3: b1 }]);
  } finally { Math.random = realRandom; }
}
console.log('\nDB impressions(exposure_count) 값: 전체', snapshot.stores.length, '곳 중 0이 아닌 가게', snapshot.stores.filter(s => s.exposure_count).length, '곳');
