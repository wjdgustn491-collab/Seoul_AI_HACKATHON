// AI ① 조건 정리 · AI ② 좁히기 질문 · AI ③ 맞음 판단. 실패하면 throw → engine이 코드만으로 처리.
import Anthropic from '@anthropic-ai/sdk';

let client = null;
try { client = new Anthropic(); } catch { client = null; } // 키 없으면 AI 없이 동작

async function callJson(system, payload, schema) {
  if (!client) throw new Error('ANTHROPIC_API_KEY 없음');
  for (let i = 0; i < 2; i++) { // 형식 깨지면 1번 재요청
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } }, // 턴당 5초 목표라 low
      system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    if (r.stop_reason === 'refusal') throw new Error('refusal');
    const text = r.content.find(b => b.type === 'text')?.text;
    try { return JSON.parse(text); } catch { /* retry */ }
  }
  throw new Error('JSON 형식 오류');
}

const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const PARSE_SYSTEM = `너는 배달 음식 추천 서비스의 "조건 정리" 담당이다. 입력은 {"text": 손님 말, "current": 현재 조건}이고, 갱신된 전체 조건을 JSON으로 낸다.
규칙:
- 손님이 말하지 않은 항목은 current 값을 그대로 둔다. current에도 없으면 null 또는 빈 값. 절대 추측하지 않는다.
- menu: 치킨/중식/분식/피자/찜·탕 중 하나. 한식·찜·탕·국밥·찌개류는 "찜·탕". 알 수 없으면 null.
- people: 인원수 정수 ("둘이서"=2, "혼자"=1).
- budget: 손님이 금액을 말했을 때만 원 단위 정수 ("만이천 원"=12000, "2만5천"=25000). 금액을 말하지 않았으면 current 값 유지.
- budget_unit: "인당", "1인", "한 명에" 처럼 1명 기준이면 per_person, 아니면 total.
- price_pref: 예산 금액이 있으면 null. "싸게/가성비/저렴한 걸로"=cheap, "가격 상관없어/비싸도 돼"=any(이때 budget은 null), 언급 없으면 current 유지(없으면 none).
- taste: 맛·스타일 키워드를 짧은 단어로 (예: 바삭, 간장, 매운, 순살). "~로 바꿔줘"면 교체, 아니면 current에 추가. menu가 바뀌면 이전 taste는 버린다.
- franchise: "프랜차이즈 말고"=exclude, "프랜차이즈만"=only, "프랜차이즈도 괜찮아"=none, 언급 없으면 current 유지.`;

const PARSE_SCHEMA = obj({
  menu: nullable({ type: 'string', enum: ['치킨', '중식', '분식', '피자', '찜·탕'] }),
  people: nullable({ type: 'integer' }),
  budget: nullable({ type: 'integer' }),
  budget_unit: { type: 'string', enum: ['total', 'per_person'] },
  price_pref: nullable({ type: 'string', enum: ['none', 'cheap', 'any'] }),
  taste: { type: 'array', items: { type: 'string' } },
  franchise: { type: 'string', enum: ['none', 'exclude', 'only'] },
});

export const parse = (text, current) => callJson(PARSE_SYSTEM, { text, current }, PARSE_SCHEMA);

const QUESTION_SYSTEM = `너는 배달 음식 추천 서비스의 "좁히기 질문" 담당이다. 입력은 손님 조건(cond), 이미 고른 선택지(chosen), 이미 한 질문(asked), 남은 가게들의 메뉴 이름·설명(stores)이다.
남은 가게들을 손님 취향 기준으로 가장 잘 나누는 질문 1개와 선택지를 만든다.
규칙:
- cond.taste, chosen, asked에서 이미 정해진 기준은 다시 묻지 않는다 (간장이라 했으면 맛은 안 묻는다).
- 메뉴 이름·설명에 근거가 있는 기준만 쓴다 (순살/뼈, 맵기, 소스, 곁들임, 양, 조리 방식 등).
- 가격·예산·가성비는 질문 기준으로 쓰지 않는다.
- 선택지 2~5개, label은 짧게. store_ids에는 그 선택지에 해당하는 가게의 store_id만 (입력에 있는 것만).
- 나눌 만한 기준이 없으면 options를 빈 배열로 둔다.
- question은 친근한 존댓말 한 문장.`;

const QUESTION_SCHEMA = obj({
  question: { type: 'string' },
  options: { type: 'array', items: obj({ label: { type: 'string' }, store_ids: { type: 'array', items: { type: 'string' } } }) },
});

export const question = payload => callJson(QUESTION_SYSTEM, payload, QUESTION_SCHEMA);

const JUDGE_SYSTEM = `너는 배달 음식 추천 서비스의 "맞음 판단" 담당이다. 입력은 손님 조건(cond), 고른 선택지(chosen), 후보 가게와 메인 메뉴(stores)다. 메뉴는 가격 오름차순으로 주어지며 가격 숫자는 없다.
가게마다 판단한다.
- match: 손님 조건(cond.taste)과 chosen을 모두 기준으로 "맞음" / "일부" / "안 맞음" 중 하나. 조건이 없으면 "맞음".
- menu_ids: 주어진 순서대로 앞에서부터, 가게 match와 같은 수준으로 맞는 메뉴 최대 5개. chosen과 어긋나는 메뉴(예: 순살을 골랐는데 뼈 메뉴)는 넣지 않는다.
- quotes: menu_ids 메뉴의 설명에서 근거가 되는 부분을 원문 그대로 짧게 복사 (고치지 말 것). 근거가 없으면 quote를 빈 문자열로.
- 설명이 비어 있으면 메뉴 이름으로만 판단하고, 이름이 조건과 관련 있으면 최소 "일부".
- 키워드만 나열된 설명이나 근거 없는 자랑("동네 최고", "무조건 드셔보세요")은 "일부"까지만.
- reason: 손님 조건 기준으로 고른 이유 한 줄 (존댓말). 가격·총액·별점·가성비·저렴함은 절대 말하지 않는다.
- 입력에 있는 store_id·menu_id만 쓴다. 모든 가게에 대해 하나씩 낸다.`;

const JUDGE_SCHEMA = obj({
  results: {
    type: 'array',
    items: obj({
      store_id: { type: 'string' },
      match: { type: 'string', enum: ['맞음', '일부', '안 맞음'] },
      menu_ids: { type: 'array', items: { type: 'string' } },
      quotes: { type: 'array', items: obj({ menu_id: { type: 'string' }, quote: { type: 'string' } }) },
      reason: { type: 'string' },
    }),
  },
});

export const judge = async payload => (await callJson(JUDGE_SYSTEM, payload, JUDGE_SCHEMA)).results;
