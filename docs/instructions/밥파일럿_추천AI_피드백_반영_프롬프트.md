# 밥파일럿 추천 AI — 피드백 반영 작업 프롬프트

너는 Seoul_AI_HACKATHON 저장소에서 **음식 추천 AI 서비스(밥파일럿)** 부분만 맡은 엔지니어다. 손님이 말로 조건을 말하면 AI가 조건을 정리·질문·설명하고, 코드가 필터·점수·순위를 계산해 동네 가게 3곳을 추천하는 기능이다. 해커톤 현직자 피드백 중 이 추천 기능에 해당하는 것만 반영한다. 본선은 6시간 안에 끝까지 동작하는 데모가 목표이므로 **데모 안정성 > 화면 개선 > 지표 > 확장** 순으로 처리한다.

**작업 범위 밖** (건드리지 않는다): 당겨요 주문자 홈·장바구니·주문(`dist/index.html`, `customer.js`, `cart.js`), 사장님 라운지(`merchant.*`), 주문 데모 테이블·RPC(`delivery_orders`, `seoul_delivery_demo` 등). 추천 카드의 "장바구니 담기" 버튼은 지금 동작 그대로 둔다.

## 추천 기능 파일 지도

| 위치 | 역할 |
|---|---|
| `api/recommend.js` | Vercel 함수. Supabase RPC `seoul_recommendation_snapshot`으로 가게·메뉴를 받아 2분 캐시 → `createEngine` → `handle(state, action, ai)` |
| `lib/ai.js` | Gemini 호출(`createGemini`) + AI ① 조건 정리(`PARSE_SYSTEM`), ② 좁히기 질문(`QUESTION_SYSTEM`), ③ 맞음 판단(`JUDGE_SYSTEM`) 프롬프트와 JSON 스키마 |
| `lib/engine.js` | 규칙 파서(`ruleParse`), 기준가·총액(`ctx`), 필터(`filterStores`), 점수(`priceScore`, `ratingScore`), AI 실패 시 판단(`keywordJudge`), 질문(`question`), 결과(`results`), 양보안(`concessions`, `zero`), 노출 횟수(`exposure`), 진입점 `handle` |
| `dist/recommend.html` | 추천 화면 (조건 칩, 남은 가게 수, 카드, `/api/recommend` 호출) |
| `supabase/migrations/*recommendation*` | `recommendation_catalog.stores/menus` 테이블과 snapshot 함수 |
| `stores_excel`, `menus_excel` | 추천용 원본 데이터 (가게 242곳, 메뉴 1,181개) |
| `test/recommend.test.js` | 엔진 테스트 14개. 실행: `node --test test/recommend.test.js` |

## 0. 먼저 할 일

1. 위 지도가 맞는지 확인하고, 아래 각 항목이 **이미 구현됨 / 일부 / 미구현** 중 무엇인지 표로 정리한다.
2. 파일별 변경 계획을 먼저 보여주고 확인받은 뒤 구현한다.
3. 항목별로 작은 커밋, 메시지에 항목 번호 (예: `[P0-1] LLM 호출 어댑터 분리`).
4. 매 커밋 전 `node --test test/recommend.test.js` 통과. 새 기능에는 테스트 추가.

## 1. 지켜야 할 추천 원칙

- 판단·계산(필터, 점수, 순위, 총액, 가격 비교)은 코드, 말 이해·질문·설명은 AI.
- AI가 돌려준 store_id·menu_id는 코드가 검증하고 없는 id는 버린다.
- AI ③에는 가격을 넘기지 않는다.
- 점수 = 조건 일치 50 + 가격 30 + 별점 20. 광고·할인·브랜드·주문 수는 0.
- 1등과 5점 이내인 가게 중에서는 덜 노출된 가게를 먼저 보여준다.
- 대화 내용은 저장하지 않는다. `GEMINI_API_KEY` 등 키는 Vercel 환경 변수에만.

---

## 2. 작업 목록

### P0 — 추천 데모 안정성

**P0-1. AI 호출과 프롬프트·응답 검증 분리** (`lib/ai.js`, `api/recommend.js`)
피드백: 핵심 모델이 정해지지 않았음. 모델이 바뀌어도 같은 JSON을 받도록 분리할 것.
- `lib/prompts.js`: AI ①②③ 프롬프트와 스키마
- `lib/llm/gemini.js` (+ 필요하면 다른 provider): `complete({ system, payload, schema }) → 문자열`만 구현
- `lib/llm/index.js`: `createLLM()`이 `LLM_PROVIDER`(기본 gemini)로 어댑터를 고르고, 지금 `createGemini()`와 같은 모양(`used`, `parse`, `question`, `judge`)을 돌려준다
- 응답 검증 공통 함수: JSON 파싱 → 필수 필드·enum 검사 → 실패 시 1번 재요청 → 그래도 실패하면 throw (엔진의 규칙 기반 폴백으로 넘어감)
- 지금 `callJson`은 한 번 실패하면 `failed = true`로 그 턴의 나머지 AI 호출을 모두 건너뛴다. 1번 재요청하도록 고치되, 타임아웃·키 없음처럼 재시도가 소용없는 실패는 바로 폴백.
- 응답의 `provider` 값은 실제 쓰인 provider 이름으로.

**P0-2. AI 입력 상한을 상수로** (`lib/engine.js`의 `question`, `results`)
피드백: 선택지 질문은 남은 가게 메뉴 설명을 모두 읽어 후보가 많으면 토큰·지연이 커짐.
- 현재: `question` 가게 16곳 × 메뉴 8개 × 설명 100자, `results` 후보 8곳 × 메뉴 10개 × 설명 100자.
- 상수로 모으고 줄인다 [제안, 벤치마크 후 조정]: `AI2_MAX_STORES = 12`, `AI2_MAX_MENUS_PER_STORE = 3`, `AI2_DESC_MAX_CHARS = 60`, `AI3_MAX_CANDIDATES = 8`, `AI3_MAX_MENUS_PER_STORE = 5`, `AI3_DESC_MAX_CHARS = 100`.
- `AI2_MAX_STORES`를 넘으면 사전 점수(가격+별점, 동점은 노출 적은 순)로 고른다. `left.slice(0, 16)`처럼 앞부분만 자르지 않는다.

**P0-3. 응답 시간 측정과 대기 표시** (`api/recommend.js`, `lib/llm/*`, `dist/recommend.html`)
피드백: 한 턴에 AI 최대 2번 + 질문 최대 3번이라 대기가 쌓임.
- 카탈로그 로드, AI ①②③, 전체 처리 시간을 측정해 응답에 `timing` 필드로. 화면 표시는 `?debug=1`일 때만.
- 턴 전체 시간 예산(예: 12초)을 두고 부족하면 재요청 없이 규칙 기반 폴백. (현재 Gemini 6.5초 × 2 + Supabase 6.5초, `maxDuration` 30초)
- `scripts/bench.js`: 시연 질문 5개를 실제 Gemini로 돌려 단계별 평균·최대 시간 출력. 목표 턴당 5초 안팎.
- 추천 화면 대기 중 단계 문구("조건 정리 중 → 가게 찾는 중 → 추천 이유 정리 중"), 중복 전송 방지.

**P0-4. 추천 데이터를 설계와 맞추기** (`supabase/migrations/`, `stores_excel`, `lib/engine.js`)
피드백: 시연 데이터를 미리 넣어 둘 것 / 리뷰가 적은 가게의 별점 기준을 정할 것.
현재 확인된 차이:
- `stores_excel`은 앞 42줄 쉼표, 나머지 200줄 탭 구분이 섞여 있다 → 쉼표 CSV 하나로 정리, 확장자 `.csv`.
- CSV의 `review_count`, `is_open`이 추천 테이블·snapshot에 없다 → **영업중 필터 없음**, **보정 별점 미구현**(`ratingScore`가 리뷰 수 없이 원래 별점만 사용), 최소주문금액은 `minOrder: 0` 고정.
- 테이블의 `rating`이 `not null`인데 CSV에는 별점 빈 신규 가게가 많다. 0으로 들어갔다면 `rating >= 3.5` 필터에 걸려 **신규 가게가 전부 빠지는 중**이니 가장 먼저 확인하고 고친다.
- 할 일:
  1. 마이그레이션: `stores`에 `review_count`, `is_open`, `min_order` 추가, `rating` null 허용, `menus`에 `is_main`(null 허용). snapshot에 포함.
  2. 시드 스크립트 `scripts/seed-catalog.js`: CSV 재적재, 빈 별점은 null.
  3. 엔진: `filterStores`에 영업 여부, `minOrder`는 DB 값, 메인 메뉴는 `is_main` 우선 + 없으면 지금의 중앙값 50% 규칙.
  4. `ratingScore` = 보정 별점 (리뷰 수 × 별점 + 10 × 동네 평균) ÷ (리뷰 수 + 10), 리뷰 0개면 동네 평균. 별점 문턱 3.5는 별점이 있는 가게에만.
  5. 테스트: 리뷰 1개 5.0 가게가 1등이 안 됨 / 리뷰 0개 가게가 안 빠짐 / 영업 안 하는 가게는 빠짐.

### P1 — 추천 화면 개선 (`dist/recommend.html`, `lib/engine.js`의 `chips`, `concessions`, `zero`)

**P1-1. 시작 화면: 동네 → 말하기 순서로 묶기**
- 동네 선택, 예시, 입력창을 "① 배달받을 동네 → ② 먹고 싶은 음식 말하기" 한 덩어리로.
- 예시는 조합 가능한 짧은 칩: `혼자 먹어요` `둘이 먹어요` `2만 원 이하` `가성비` `프랜차이즈 말고` `매운 거`. 누르면 입력창에 이어 붙음.
- 음성 입력은 안 하면 입력창 옆 "말로 하기" 큰 마이크 버튼 자리만.

**P1-2. 결과 카드: 세 가게의 차이가 보이게**
- 메뉴명·총액을 가장 크게, 위로.
- 메뉴 사진(있으면), 구성·양·맛 차이를 세 카드 같은 위치에.
- "사장님 설명" → "사장님 메뉴 소개", 인용은 짧게(예: 40자).
- 세 카드에 똑같은 ✓는 결과 위에 한 번만("세 곳 모두: 영업중 · 프랜차이즈 아님"), 카드엔 그 가게만 다른 항목.
- `JUDGE_SYSTEM`에 "reason에는 quote 표현을 반복하지 말고 손님 조건과 어떻게 맞는지만 한 줄로" 추가.

**P1-3. 0곳 화면: 바뀌는 조건을 숫자로** (`concessions`)
- "2,000원만 더 쓰면 2곳 있어요" 아래에 "예산 25,000원 → 27,000원". 다른 양보안도 같은 형식("순살 → 상관없음", "프랜차이즈 제외 → 포함").
- 양보안 객체에 `change: { from, to }` 추가.

**P1-4. 결과 화면에서 조건만 수정**
- 결과 화면의 조건 칩을 눌러 예산·음식만 고치면 v3 재계산 표대로 다시 계산(처음부터 X). 예산 칩 → [2만][2.5만][3만][직접 입력], 음식 칩 → 업종 버튼.

### P1 — 공정한 노출 지표

**P1-5. 노출 횟수 저장 + 지표**
- `exposure`가 서버 메모리라 인스턴스마다 초기화됨 → Supabase 테이블(날짜, store_id, 횟수)로 옮기고 snapshot으로 읽기, RPC 하나로 쓰기.
- 추천 결과 단위 익명 집계(날짜, 동, 업종, 가격 모드, TOP3 store_id, 프랜차이즈 여부). 입력 문장은 저장 안 함.
- 지표: TOP3 중 비프랜차이즈 비율 / 상위 20% 가게의 노출 비중 / 한 번도 노출 안 된 가게 수. `scripts/metrics.js` 또는 `dist/metrics.html`.

**P1-6. 손님 만족도**
- 결과 아래 "이 추천 괜찮았어요? 👍 / 👎", P1-5 집계 행에 붙여서만 저장.

### P2 — 여유가 있으면

**P2-1. 메뉴 설명 유불리**
- `JUDGE_SYSTEM`의 "설명 없으면 이름으로 최소 '일부'", "근거 없는 자랑은 '일부'까지" 규칙이 `keywordJudge`(AI 실패 시)에도 똑같이 적용되는지 확인하고 테스트 추가. 설명 빈 메뉴 122개로 확인.

**P2-2. 기존 방식 vs 밥파일럿 비교**
- 같은 요청을 ① 필터 없이 Gemini에 가게 목록을 주고 추천받기(또는 별점순) ② 밥파일럿 엔진으로 처리해 나란히 보여주는 `scripts/compare.js` 또는 `dist/compare.html`. 편의점 섞임, 총액 누락, 프랜차이즈 쏠림, 영업 안 하는 가게 포함 차이가 드러나게.

**P2-3. AI 호출 합치기 실험**
- AI ①과 ③을 한 번에 부르는 방식을 플래그(`MERGE_AI_CALLS`, 기본 off)로 실험하고 벤치마크로 비교해 보고만.

---

## 3. 문서 (코드 아님)

- `docs/data-source.md` — 현재 추천 데이터는 합성(`is_synthetic`, `data_source`)임을 밝히고 본선 데이터 출처, 공공배달앱 측 협의 가능성. 팀이 채울 곳은 `TODO(팀)`.
- `docs/fairness-metrics.md` — P1-5·P1-6 지표 정의와 목표값.

## 4. 완료 기준

- `node --test test/recommend.test.js` 전부 통과 + 새 테스트 포함.
- 신규 가게(리뷰 0개)는 후보에 남고, 영업 안 하는 가게는 빠진다.
- `LLM_PROVIDER`만 바꿔도 나머지 수정 없이 동작한다.
- 벤치마크 결과(단계별 평균·최대 시간) 보고.
- 항목별 구현함 / 일부 / 보류(이유) 표로 최종 보고.
