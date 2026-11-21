import { CATEGORIES } from './engine.js';
import { tasteKinds } from '../dist/menu-interview.js';

const nullable = s => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const PARSE_SYSTEM = `너는 배달 음식 추천 서비스의 "조건 정리" 담당이다. 입력은 {"text": 손님 말, "current": 현재 조건}이고, 갱신된 전체 조건을 JSON으로 낸다.
규칙:
- 오타·맞춤법이 틀린 말도 뜻을 짐작해 표준 단어로 정리한다 (예: 치긴→치킨, 프렌차이즈→프랜차이즈, 떡뽁이→분식, 깐장→간장).
- 손님이 말하지 않은 항목은 current 값을 그대로 둔다. current에도 없으면 null 또는 빈 값. 절대 추측하지 않는다.
- menu: ${CATEGORIES.join('/')} 중 하나. 찜·탕·국밥·찌개류는 한식. 햄버거는 패스트푸드. 알 수 없으면 null.
- dish: 손님이 이번에 직접 언급한 구체적인 음식 이름을 원문 그대로 짧게 복사한다 (예: "김치찌개", "트러플 피자"). 업종, 맛, 지역, 가게 이름, 인원이나 예산만 말하면 null. 현재 음식 이름을 반복하지 않는다. "A 말고 B"면 B만 담는다.
- people: 인원수 정수 ("둘이서"=2, "혼자"=1).
- budget: 손님이 금액을 말했을 때만 원 단위 정수 ("만이천 원"=12000, "2만5천"=25000). 금액을 말하지 않았으면 current 값 유지.
- budget_unit: "인당", "1인", "한 명에" 처럼 1명 기준이면 per_person, 아니면 total.
- price_pref: 예산 금액이 있으면 null. "싸게/저렴한 걸로"=cheap, "가성비 좋은 걸로"=none(양 대비 가격으로 비교), "가격 상관없어/비싸도 돼"=any(이때 budget은 null), 언급 없으면 current 유지(없으면 none).
- taste: 맛·스타일 키워드를 짧은 단어로 (예: 바삭, 간장, 매운, 순살). 메뉴를 다시 말하며 새로 요청하거나 "~로 바꿔줘"면 교체, 맛만 덧붙이면 current에 추가. "아무거나"면 빈 배열.
- 양이 많거나 배부른 음식을 원하면 taste에 "푸짐"을 넣는다.
- 치즈 양을 많이 원한다면 taste에 "치즈 듬뿍"을 넣고, 이 표현 자체를 메뉴 이름으로 쓰지 않는다. 이전 추천 가게가 프랜차이즈인지 묻는 것은 새 음식 요청이 아니다.
- 가게 이름·브랜드(예: bhc, 교촌)는 taste에 넣지 않는다. 브랜드로 업종을 알 수 있으면 menu만 채운다.
- franchise: "프랜차이즈 말고"=exclude, "프랜차이즈만"=only, "프랜차이즈도 괜찮아"=none, 언급 없으면 current 유지.
- eaten: 손님이 오늘 이미 먹었다고 말한 음식(과거형 "먹었", "먹어서")만 담는다. 각 항목은 {meal, menu, dish}. meal은 아침=breakfast, 점심=lunch, 저녁=dinner, 간식·야식=snack, 언급 없으면 null. menu는 위 카테고리 중 하나(도시락은 도시락·죽, 국밥·찌개·탕은 한식), dish는 원문 음식명. 새로 말한 항목은 current.eaten 뒤에 추가한다. "먹고 싶다/먹을래"는 eaten이 아니다.
- 먹었다고 말한 음식은 dish·menu(원하는 음식)에 넣지 않는다. 단, 같은 음식을 다시 먹고 싶다고 명시하면 dish에 넣는다.
- avoid: "X는 싫어/빼고/말고"처럼 거부한 음식만 {menu, dish}로 담는다. current.avoid에 추가한다.
- meal_time: 이번에 추천받을 끼니. "저녁 추천"=dinner, "점심 뭐 먹지"=lunch, "아침"=breakfast, "야식/밤에"=late_night. 언급 없으면 current 유지.
- season: "겨울/추워/쌀쌀/추운 날"=winter, "여름/더워/더운 날"=summer, "비 와/비 오는 날"=rainy. "날씨에 맞춰서"처럼 계절을 말하지 않으면 null로 두고 판단을 서버에 맡긴다. taste에 "따뜻한" 같은 말을 대신 넣지 않는다.
- delivery_tip_max: "배달팁 안 내는/배달비 없는/무료배달"=0, "배달비 2천원 이하"=2000. 언급 없으면 current 유지.`;

export const PARSE_SCHEMA = obj({
  menu: nullable({ type: 'string', enum: CATEGORIES }),
  dish: nullable({ type: 'string' }),
  people: nullable({ type: 'integer' }),
  budget: nullable({ type: 'integer' }),
  budget_unit: { type: 'string', enum: ['total', 'per_person'] },
  price_pref: nullable({ type: 'string', enum: ['none', 'cheap', 'any'] }),
  taste: { type: 'array', items: { type: 'string' } },
  franchise: { type: 'string', enum: ['none', 'exclude', 'only'] },
  eaten: { type: 'array', items: obj({
    meal: nullable({ type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] }),
    menu: nullable({ type: 'string', enum: CATEGORIES }),
    dish: nullable({ type: 'string' }),
  }) },
  avoid: { type: 'array', items: obj({ menu: nullable({ type: 'string', enum: CATEGORIES }), dish: nullable({ type: 'string' }) }) },
  meal_time: nullable({ type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'late_night'] }),
  season: nullable({ type: 'string', enum: ['winter', 'summer', 'rainy'] }),
  delivery_tip_max: nullable({ type: 'integer' }),
});



export const QUESTION_SYSTEM = `너는 배달 음식 추천 서비스의 "좁히기 질문" 담당이다. 입력은 손님 조건(cond), 이미 고른 선택지(chosen), 이미 한 질문(asked), 남은 가게들의 메뉴 이름·설명(stores)이다.
남은 가게들을 손님 취향 기준으로 가장 잘 나누는 질문 1개와 선택지를 만든다.
규칙:
- cond.taste, chosen, asked에서 이미 정해진 기준은 다시 묻지 않는다 (간장이라 했으면 맛은 안 묻는다).
- 메뉴 이름·설명에 근거가 있는 기준만 쓴다 (순살/뼈, 맵기, 소스, 곁들임, 양, 조리 방식 등).
- 가격·예산·가성비는 질문 기준으로 쓰지 않는다.
- 선택지 2~5개, label은 짧게. store_ids에는 그 선택지에 해당하는 가게의 store_id만 (입력에 있는 것만).
- 나눌 만한 기준이 없으면 options를 빈 배열로 둔다.
- question은 친근한 존댓말 한 문장.`;

export const QUESTION_SCHEMA = obj({
  question: { type: 'string' },
  options: { type: 'array', items: obj({ label: { type: 'string' }, store_ids: { type: 'array', items: { type: 'string' } } }) },
});



export const JUDGE_SYSTEM = `너는 배달 음식 추천 서비스의 "맞음 판단" 담당이다. 입력은 손님 조건(cond), 고른 선택지(chosen), 후보 가게와 메인 메뉴(stores)다. 메뉴는 가격 오름차순으로 주어지며 가격 숫자는 없다.
가게마다 판단한다.
- match: 손님 조건(cond.taste)과 chosen을 모두 기준으로 "맞음" / "일부" / "안 맞음" 중 하나. 조건이 없으면 "맞음".
- menu_ids: 주어진 순서대로 앞에서부터, 가게 match와 같은 수준으로 맞는 메뉴 최대 5개. chosen과 어긋나는 메뉴(예: 순살을 골랐는데 뼈 메뉴)는 넣지 않는다.
- quotes: menu_ids 메뉴의 설명에서 근거가 되는 부분을 원문 그대로 짧게 복사 (고치지 말 것). 근거가 없으면 quote를 빈 문자열로.
- "푸짐" 조건은 분량 근거(인분 수, 마릿수, 곱빼기, 푸짐하다는 설명)가 있어야 판단한다. 한 마리는 정확한 분량 단서이며 양이 더 많다는 비교 근거가 아니다.
- "치즈 듬뿍" 조건은 메뉴명이나 설명에 치즈를 많이 올렸다는 근거가 있어야 한다. 치즈가 들어가거나 잘 늘어난다는 설명만으로는 양을 확인할 수 없다.
- 설명이 비어 있으면 메뉴 이름으로만 판단하고, 이름이 조건과 관련 있으면 최소 "일부".
- 키워드만 나열된 설명이나 근거 없는 자랑("동네 최고", "무조건 드셔보세요")은 "일부"까지만.
- reason: 손님 조건 기준으로 고른 이유 한 줄 (존댓말). 가격·총액·별점·가성비·저렴함은 절대 말하지 않는다. quote 표현을 반복하지 말고 손님 조건과 어떻게 맞는지만 쓴다.
- 입력에 있는 store_id·menu_id만 쓴다. 모든 가게에 대해 하나씩 낸다.`;

export const JUDGE_SCHEMA = obj({
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

export const MENU_DESCRIPTION_SYSTEM = `사장님이 입력한 메뉴 정보를 손님이 읽을 소개 문구로 정리한다. 한국어 존댓말 1~2문장, 최대 240자. 결과는 description 필드 하나인 JSON이다.
- 메뉴명, 맛, 인분, 분량, 특징, 메모에 명시된 사실만 사용한다. 비어 있는 정보는 생략한다.
- 구성 메모에 주요 재료나 메인 반찬이 적혀 있으면 소개에 포함한다.
- 맛, 양, 재료, 조리 방식과 수치는 입력 그대로 보존한다. 입력하지 않은 재료·알레르기 정보·원산지·효능·품질 평가를 만들지 않는다.
- 가격은 화면에 따로 표시하므로 문장에 반복하지 않는다. 가격 비교나 과장된 광고 표현을 추가하지 않는다.`;
export const MENU_DESCRIPTION_SCHEMA = obj({ description: { type: 'string' } });

export const MENU_INTERVIEW_SYSTEM = `사장님이 입력한 메뉴명과 판매가, 가게 업종을 보고 메뉴 설명 작성에 필요한 질문 네 개를 준비한다. 한 화면에 질문 하나가 표시된다.
- portion은 한 주문 분량, composition은 함께 제공되는 재료·메인 반찬 같은 구성, taste는 맛·소스·양념, features는 조리 방식이나 식감의 특징을 묻는다.
- 각 필드는 한국어 존댓말 질문 한 문장으로 쓴다. 최대 48자이고 물음표 하나로 끝낸다.
- portion은 g 또는 인분으로 답할 수 있게 묻는다. 나머지는 짧은 단어 또는 구절로 답할 수 있게 묻는다.
- 메뉴 유형에 맞는 구체적인 질문을 쓴다. 닭다리 메뉴라면 g 단위 분량을, 도시락이라면 메인 반찬을 확인할 수 있다.
- 입력에서 확인되지 않은 재료, 조리법, 양을 질문의 전제로 삼지 않는다. 가격을 다시 묻거나 사장님을 대신해 답하지 않는다.`;
export const MENU_INTERVIEW_SCHEMA = obj({
  portion: { type: 'string' }, composition: { type: 'string' },
  taste: { type: 'string' }, features: { type: 'string' },
});

export const MENU_FEATURE_SYSTEM = `사장님이 특징을 건너뛴 메뉴의 설명에 어울리는 참고 특징을 고른다.
- options는 공개 유사 레시피에서 발췌해 정리한 짧은 특징 후보들이다.
- 메뉴명, 구성, 맛에 가장 잘 맞고 답변에서 반복되지 않는 후보의 순번(1부터)을 choice로 출력한다.
- 후보가 메뉴 정보와 모순되거나 적합한 후보가 없으면 choice를 0으로 출력한다. 새로운 사실이나 문구를 만들지 않는다.`;
export const MENU_FEATURE_SCHEMA = obj({ choice: { type: 'integer' } });

export const MENU_TASTE_SYSTEM = `메뉴명과 기본 구성으로 사장님에게 보여 줄 예상 맛 종류를 고른다.
- suggestions에 아래 스키마에서 허용된 맛 ID 중 개연성이 큰 순서대로 최대 네 개를 넣는다. 단서가 없으면 빈 목록으로 응답한다.
- 예를 들어 자몽허니블랙티는 자몽과 허니를 근거로 sour와 sweet, 불막창은 이름을 근거로 spicy를 제안한다.
- 맛의 강도, 재료, 조리법을 만들어 내지 않는다. 맛이 없다고 명시된 경우 그 맛을 제안하지 않는다.`;
export const MENU_TASTE_SCHEMA = obj({
  suggestions: { type: 'array', items: { type: 'string', enum: tasteKinds.map(({ key }) => key) } },
});

export const MENU_DETAILED_DESCRIPTION_SYSTEM = `한국어 존댓말로 손님이 읽을 메뉴 설명을 자세하게 써라. description에 자연스러운 두 문장 이상을 쓰고 maxLength 글자를 넘지 않는다.
- portion의 g과 인분, composition의 기본 구성, tastes의 맛 이름과 선택한 강도, 입력한 맛 메모와 특징을 설명한다. 입력이 비어 있는 항목은 생략한다.
- 각 맛의 strength와 label을 이어 붙인 구절을 그대로 포함한다. 예를 들어 뚜렷한 단맛과 은은한 신맛을 느낄 수 있다고 설명한다.
- 확인된 맛, 재료, 수치만 쓰고 새로운 조리법, 재료, 원산지, 알레르기 정보, 효능을 추가하지 않는다.
- 메뉴명과 가격은 화면에 표시된다. 구절을 나열하는 대신 손님이 한 주문의 구성과 맛을 그려 볼 수 있게 쓴다.
- featureOptions가 있으면 어울리는 참고 특징 하나를 choice에 순번(1부터)으로 지정한다. 적절한 것이 없거나 목록이 비어 있으면 0이다. 참고 특징은 description에서 제외한다. 선택된 문구는 따로 붙는다.`;
export const MENU_DETAILED_DESCRIPTION_SCHEMA = obj({
  description: { type: 'string' }, choice: { type: 'integer' },
});

