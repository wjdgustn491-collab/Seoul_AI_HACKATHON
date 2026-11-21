# 작업 지시: 복합 문장에서 "먹은 것·끼니·날씨·배달팁" 조건을 뽑아 추천에 반영하기

## 배경

이 저장소(`seoul_ai_hackathon`)는 배달 메뉴 추천 챗봇이다. 흐름은 다음과 같다.

- `api/recommend.js` → `lib/engine.js`의 `handle()`
- 손님 문장은 규칙 파서 `ruleParse()`와 AI 파서 `ai.parse()`(`lib/prompts.js`의 `PARSE_SYSTEM`/`PARSE_SCHEMA`)를 거쳐 `state.cond`가 된다.
- `setCond()` → `filterStores()` → 점수 계산(5단계) → `judge` 순으로 추천한다.
- Gemini 키가 없거나 `RECOMMENDATION_MODE=rules`이면 규칙 기반으로만 동작한다.

지금은 "치킨 2명 3만원 간장"처럼 원하는 음식을 직접 말하는 문장만 잘 처리한다. 아래처럼 맥락이 섞인 문장은 제대로 처리하지 못한다.

> "아침에는 국밥을 먹었고, 점심은 도시락을 먹었는데 저녁 추천 좀 해봐 겨울 날씨에 맞춰서 배달팁 안 내는 곳으로"

현재 코드는 이 문장의 "국밥", "도시락"을 **원하는 음식**으로 잘못 읽을 가능성이 크다(`readFood`, `readFoodList`, `findStoreName`, AI parse의 `dish`). 이번 작업의 목표는 이런 문장에서 의미 있는 조건을 종류별로 나눠 뽑고, 추천에 반영하는 것이다.

## 먼저 할 일

코드를 고치기 전에 `lib/engine.js`(특히 `setCond`, `load`, `resetSearch`, `ruleParse`, `handle`의 text 분기, `filterStores`, 점수 계산부, `concessions`/`zero`, `chips`), `lib/prompts.js`, `lib/llm/index.js`, `test/recommend.test.js`, `test/llm.test.js`를 읽는다. 그런 다음 아래 설계가 현재 구조와 어긋나는 부분이 있으면 구현 전에 짧게 보고한다.

## 새로 뽑을 조건 (cond에 추가)

| 필드 | 타입 | 의미 | 추천 반영 방식 |
|---|---|---|---|
| `eaten` | `[{ meal, menu, dish }]` (최대 5개) | 오늘 이미 먹은 음식. `meal`은 `breakfast`/`lunch`/`dinner`/`snack`/`null`, `menu`는 `CATEGORIES` 중 하나 또는 null, `dish`는 원문 음식명 | 같은 `dish`(DISH_ALIASES·`dishMatches` 기준)는 **제외**한다. 같은 `menu` 카테고리는 **감점**만 한다(제외하지 않음). |
| `avoid` | `[{ menu, dish }]` (최대 5개) | "X는 싫어/빼고/말고"처럼 명시적으로 거부한 음식 | **제외** |
| `meal_time` | `breakfast`/`lunch`/`dinner`/`late_night`/`null` | 이번에 추천받을 끼니 | 점심·저녁이면 `카페·디저트`·`편의점`을 약하게 감점하고, `late_night`이면 `야식`을 가점한다. 단, 손님이 그 카테고리를 직접 요청하면 적용하지 않는다. |
| `season` | `winter`/`summer`/`rainy`/`null` | 날씨·계절 맥락 ("겨울", "추워", "쌀쌀", "더워", "비 와") | 아래 표의 근거어를 기준으로 가점·감점한다(소프트 선호). |
| `delivery_tip_max` | 정수 또는 null | 0 = 배달팁 무료("배달팁 안 내는", "배달비 없는", "무료배달"), 그 밖의 숫자는 상한("배달비 2천원 이하") | `store.tip <= delivery_tip_max`로 **필터** |

`season` 반영 규칙은 프롬프트에 흩어 두지 말고 `engine.js`에 상수 표로 둔다. 규칙 모드에서도 똑같이 동작해야 하기 때문이다.

```js
const SEASON_HINTS = {
  winter: { boost: /국물|탕|찌개|전골|국밥|칼국수|수제비|우동|라멘|쌀국수|마라탕|샤브|짬뽕|어묵|죽|뜨끈|따뜻|얼큰/, penalty: /냉면|콩국수|빙수|아이스|샐러드|물회|냉모밀/ },
  summer: { boost: /냉면|콩국수|모밀|메밀|물회|빙수|샐러드|시원|냉/, penalty: /전골|뚝배기|뜨끈/ },
  rainy:  { boost: /전|파전|칼국수|수제비|짬뽕|국물|부침/, penalty: null },
};
```

- 근거는 메뉴 이름, 설명, `details`(맛·특징)에서 찾는다. 기존 `menuEvidence`/`keywordJudge` 방식과 맞춘다.
- 손님이 "날씨에 맞춰서"라고만 하고 계절을 말하지 않으면 요청 시각(Asia/Seoul) 기준 월로 추정한다(12~2월은 winter, 6~8월은 summer, 그 외는 null). 실시간 날씨 API는 이번 범위가 아니다.

## 핵심 구현 포인트

1. **"먹은 것" 절을 먼저 떼어내기.** `splitEatenClauses(text)`를 만든다. 반환값은 `{ eaten, rest }`이다.
   - 패턴: `(아침|점심|저녁|야식|아까|어제|오늘)?(에|엔|은|는|으로)? … (먹었|먹음|먹어서|먹었으니|먹었는데|먹었고|먹었어)`
   - "먹고 싶", "먹을래", "먹자"는 먹은 것이 **아니다**.
   - `rest`만 기존 `readFood`/`readFoodList`/`findStoreName`/`storeQuery`/AI `dish` 판정에 넘긴다. 그래야 "국밥"이 원하는 음식으로 잡히지 않는다.
   - AI parse의 `rawDish` 검사(`compact(newText).includes(...)`)도 `rest` 기준으로 바꾼다.
2. **AI 파서 확장.** LLM 호출을 새로 추가하지 않는다. 기존 `parse` 한 번의 스키마에 필드를 더한다(턴 예산 12초 유지).
   - `PARSE_SCHEMA`에 위 5개 필드를 추가한다. 모든 키를 required로 두고 nullable 처리한다.
   - `validate()`가 지원하는 부분집합(object/array/string/integer/null, enum, anyOf)만 쓴다.
   - `PARSE_SYSTEM`에는 아래 "AI 파서 규칙 추가분"을 덧붙인다.
3. **규칙 파서 확장.** `ruleParse()`에 같은 필드를 뽑는 정규식을 넣는다. 규칙 결과와 AI 결과를 합칠 때 우선순위는 지금처럼 규칙이 확실히 잡은 값 > AI 값이다.
4. **상태 관리.**
   - `setCond`의 키 목록, `load`의 정제 로직, `aiParseCond`에 새 필드를 추가한다.
   - `eaten`/`avoid`는 대화 중에 누적한다(새 항목 추가, 중복 제거).
   - "처음부터"를 누르면 초기화한다.
   - 새 조건이 바뀌면 기존처럼 `resetSearch`가 돈다.
5. **필터·점수.**
   - `delivery_tip_max`, `eaten.dish`, `avoid`는 `filterStores`/메뉴 선택 단계의 **하드 조건**이다.
   - `eaten.menu`, `meal_time`, `season`은 점수 단계의 **소프트 가중치**로 넣는다. 기존 가격·평점 점수를 뒤집지 않을 정도의 가중치로 시작하고, 상수로 빼 둔다.
   - 소프트 조건 때문에 후보가 0곳이 되면 안 된다.
6. **명시 요청이 맥락보다 우선한다.** "아침에 국밥 먹었는데 또 국밥 먹고 싶어"처럼 같은 음식을 직접 다시 원하면 `dish`=국밥으로 처리하고 eaten 제외를 적용하지 않는다.
7. **결과 0곳 처리.** 배달팁 조건 때문에 결과가 0곳이면 기존 `zero()`/`concessions()` 흐름에 "배달팁 조건 풀기" 대안을 추가한다. 다른 하드 조건이 원인일 때 쓰는 방식과 같게 한다.
8. **설명과 칩.**
   - 결과 상단 문구에 반영한 조건을 한 문장으로 요약한다. 예: "아침 국밥·점심 도시락과 겹치지 않게, 겨울에 어울리는 따뜻한 메뉴 위주로 배달팁 없는 가게만 골랐어요."
   - `chips()`에 `저녁` · `겨울` · `배달팁 무료` · `제외: 국밥` 같은 칩을 추가해 손님이 확인하고 지울 수 있게 한다.
   - `JUDGE_SYSTEM`의 "reason에 가격·총액 언급 금지" 규칙은 유지한다. 배달팁 정보는 reason이 아니라 카드·칩으로 보여 준다.

## AI 파서 규칙 추가분 (PARSE_SYSTEM 뒤에 붙일 문장)

```
- eaten: 손님이 오늘 이미 먹었다고 말한 음식(과거형 "먹었", "먹어서")만 담는다. 각 항목은 {meal, menu, dish}. meal은 아침=breakfast, 점심=lunch, 저녁=dinner, 간식·야식=snack, 언급 없으면 null. menu는 위 카테고리 중 하나(도시락은 도시락·죽, 국밥·찌개·탕은 한식), dish는 원문 음식명. 새로 말한 항목은 current.eaten 뒤에 추가한다. "먹고 싶다/먹을래"는 eaten이 아니다.
- 먹었다고 말한 음식은 dish·menu(원하는 음식)에 넣지 않는다. 단, 같은 음식을 다시 먹고 싶다고 명시하면 dish에 넣는다.
- avoid: "X는 싫어/빼고/말고"처럼 거부한 음식만 {menu, dish}로 담는다. current.avoid에 추가한다.
- meal_time: 이번에 추천받을 끼니. "저녁 추천"=dinner, "점심 뭐 먹지"=lunch, "아침"=breakfast, "야식/밤에"=late_night. 언급 없으면 current 유지.
- season: "겨울/추워/쌀쌀/추운 날"=winter, "여름/더워/더운 날"=summer, "비 와/비 오는 날"=rainy. "날씨에 맞춰서"처럼 계절을 말하지 않으면 null로 두고 판단을 서버에 맡긴다. taste에 "따뜻한" 같은 말을 대신 넣지 않는다.
- delivery_tip_max: "배달팁 안 내는/배달비 없는/무료배달"=0, "배달비 2천원 이하"=2000. 언급 없으면 current 유지.
```

## 완료 기준 (테스트로 고정)

`test/recommend.test.js`와 `test/llm.test.js`에 다음 케이스를 추가한다. AI 모드는 기존 테스트처럼 가짜 provider로, 규칙 모드는 `ai` 없이 검증한다. **규칙 모드와 AI 모드 둘 다** 통과해야 한다.

1. "아침에는 국밥을 먹었고, 점심은 도시락을 먹었는데 저녁 추천 좀 해봐 겨울 날씨에 맞춰서 배달팁 안 내는 곳으로"
   - cond: `eaten`=[{breakfast, 한식, 국밥}, {lunch, 도시락·죽, 도시락}], `meal_time`=dinner, `season`=winter, `delivery_tip_max`=0, `menu`=null, `dish`=null
   - 결과: 모든 가게가 `tip === 0`이고, 국밥 계열 메뉴는 추천하지 않으며, 도시락·죽 가게는 상위에 오지 않는다. 국물·따뜻한 근거가 있는 메뉴(예: 마라탕, 짬뽕, 쌀국수, 우동)가 근거 없는 메뉴보다 위에 온다.
2. "국밥 먹고 싶어" → `dish`=국밥, `eaten`=[] (먹은 것으로 오인하지 않음)
3. "아침에 국밥 먹었는데 또 국밥 땡겨" → `dish`=국밥, 국밥을 제외하지 않음
4. "점심에 치킨 먹었어. 저녁은 매운 걸로, 피자는 싫어" → `eaten`에 치킨이 들어가 치킨 카테고리는 감점, `avoid`에 피자가 들어가 피자는 제외, `taste`에 매운
5. "더우니까 시원한 거, 배달비 2천원 이하로" → `season`=summer, `delivery_tip_max`=2000
6. 결과를 받은 뒤 "배달팁 무료인 곳으로" → `delivery_tip_max`만 0으로 바뀌고 나머지 조건은 유지
7. 배달팁 0원 가게가 없는 지역 → 0곳 안내와 함께 "배달팁 조건 풀기" 대안이 나옴
8. 기존 테스트 전부 통과(`node --test`)

## 지켜야 할 것

- 기존 동작(치킨 순살/뼈, 안 매운, 치즈 듬뿍, 프랜차이즈, 예산, 다중 음식)을 깨지 않는다.
- LLM 호출 횟수를 늘리지 않는다. 손님이 말하지 않은 조건은 추측하지 않는다(계절 자동 추정만 예외이며, 이 경우 칩에 "(오늘 기준)"으로 표시한다).
- 정규식·가중치·계절 표는 상수로 분리해 나중에 조정하기 쉽게 한다.
- 작업이 끝나면 바꾼 파일, 추가한 테스트, 시연할 때 넣어 볼 문장 3개를 짧게 정리해서 보고한다.
