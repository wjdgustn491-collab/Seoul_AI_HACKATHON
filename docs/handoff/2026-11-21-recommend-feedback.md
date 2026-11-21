# 밥파일럿 추천 — 인수인계 (2026-11-21, 이전 단계)

> 이 문서는 이전 단계 기록이다. 최신 상태는 `docs/handoff/2026-11-21-recommend-questions.md`를 먼저 본다.

> 이 문서의 기준: 로컬 `C:\3th_project\Seoul_AI_HACKATHON`, 브랜치 `feature/recommend-feedback`.
> 참고: 요청 양식에 있던 "조건 기억 버그 수정 · 질문 세트 대응 · 평가 스크립트"는 이번 작업에서 다루지 않았다(해당 코드·스크립트 없음). 아래 "평가"는 실제로 있는 테스트·분석 스크립트 기준이다.

## 목표
추천 화면(밥파일럿)을 **동 단위 실데이터 + 대화형 흐름**으로 바꾸고, 복합 문장의 **맥락 조건**(먹은 것·피할 것·끼니·계절·배달팁)을 추천에 반영한다. 필터·점수·순위·총액 계산의 기본 규칙은 유지한다.

## 현재 상태
- 브랜치 PR #1(P0~P1 피드백 반영)은 `main`에 병합됨. 그 뒤 작업은 **이 브랜치 로컬에만** 있다. 2026-11-21 `origin/main`(7e96503)을 합침(아래 1번).
- 실행: `node scripts/build-data.mjs` (루트 원본 CSV → dist/data, 약 2초) → `npm run dev` → http://localhost:4173/recommend.html
  - dev 서버는 `scripts/dev.mjs`(`DEV_DELAY_MS=3000`으로 응답 지연 가능). `local/`은 캐시 폴더(.gitignore).
- AI 없이 동작: `LLM_PROVIDER=none` 또는 `RECOMMENDATION_MODE=rules`(로컬 dev 서버 기본값은 none).

## 완료한 것 (파일 → 이유)
| 파일 | 내용 |
|---|---|
| `data/*` | 팀 `main`의 가게 62,000·메뉴 323,828(4분할, 메뉴 `review_count` 포함)·동 중심점·3km 표·`search_rule.py`를 **원본 그대로** 복사(이름만 프롬프트에 맞춤) |
| `scripts/build-data.mjs`, `lib/csv.js`, `lib/catalog.js` | CSV(BOM·따옴표) → 동별 JSON. 서버는 **주문자 동 + 3km 동만** 읽음(Supabase 전체 로드는 8~16초라 대체) |
| `dist/searchRule.js` | `search_rule.py`를 JS로 이식(`searchStores`, `nearestDong`, 0km="같은 동네"). 시연 시나리오 A~C2 원본과 결과 동일 |
| `api/recommend.js` | 동별 엔진 캐시(30개), 노출 횟수 공유, `guided: true` |
| `lib/engine.js` | 동 단위 검색(같은 동→0곳·더 보기·"다른 지역도 괜찮아요" 시 3km), 0곳 양보안(우리 동 예산↑ / 주변 동), 착한가게·신규 배지, 세부 메뉴 단계, 대화형 단계(`state.step`), 맥락 조건(`readContext`·`splitEatenClauses`·`contextScore`·`SEASON_HINTS`·`CONTEXT_WEIGHTS`), 공정 비교(1인분당 가격, 고기 g 환산), 업종별 대표 메뉴 규칙 |
| `lib/prompts.js`, `lib/llm/*` | 프롬프트 분리, 응답 스키마 검사·1회 재요청, 맥락 필드 5개 추가 |
| `dist/recommend.html`, `dist/home.js`, `dist/suggest.js`, `dist/seoul-gu.js` | 설계안 카드, 자동 스크롤·로딩 스켈레톤, [현재 위치]=등록 주소(없으면 광진구 화양동), 상황 추천 문장(날씨·시간) |

**테스트 (모두 통과)**: `node --test test/*.test.js` → **99개 통과**(main 병합 후, 팀 테스트 포함). `dist/data`가 없으면 동 데이터 테스트(`recommend-dong`, `recommend-api`)는 skip된다.

**평가(분석) 스크립트**: `node scripts/analysis/rating.mjs`, `node scripts/analysis/impressions.mjs`(세부 메뉴 질문에 "상관없어요"로 답하게 고침). 병합 전후 숫자 같음.

## 남은 것 (순서대로)
1. ~~최신 `main`과 합치기~~ — **완료**. 정리한 것:
   - `lib/engine.js`: 팀의 `details`(인분·맛·특징)·엄격 조건(안 매운·순살/뼈)·순살/뼈 질문 + 이 브랜치의 업종별 대표 메뉴·맥락 조건·가게별 기준가를 합침. `seasonOf`에 `menu.details` 반영. 세부 메뉴 질문은 비대화형에서도 예산을 말하면 건너뜀(팀 테스트 기대). 동 단위 0곳일 때도 "맵지 않다고 표기된 … 못 찾았어요" 이유를 보여 줌.
   - `api/recommend.js`: `RECOMMENDATION_MODE=rules`면 AI 없이(팀 코드). **사장님 메뉴 수정(browserKey)이 있는 브라우저만 팀의 Supabase 카탈로그 + 수정 내역으로 추천**, 나머지는 동 단위 데이터. 이유: 데모 카탈로그와 `dist/data`는 가게·메뉴 id 체계가 달라(같은 id·이름 메뉴 244/50,354) 수정 내역을 동 데이터에 덮을 수 없음. → **팀 결정 필요**: 사장님 가게를 `dist/data` id로 맞출지.
   - `dist/recommend.html`: 팀의 폰 프레임 디자인·로그인 세션 채택(다크 모드 제거됨). 스크롤 컨테이너가 `<main>`으로 바뀌어 자동 스크롤을 거기에 맞춤 — **브라우저에서 눈으로 확인은 아직**.
   - 테스트: `recommend-api`는 동 데이터 기준으로, `merchant-menu`의 "수정 없는 브라우저" 확인은 동 데이터 경로 기준으로 바꿈.
   - 실데이터에서 "안 매운 치킨"은 화양동 0곳(메뉴에 '맵지 않음' 표기가 드묾) — 팀의 엄격 규칙대로 동작하는 것. 완화 여부는 6번 튜닝에서.
2. ~~배포용 데이터~~ — **완료(배포 확인 전)**. `scripts/build-data.mjs`가 저장소 루트의 팀 원본(`stores_excel`, `dong_centroids`, `delivery_zone`, `hackathon_menus_part1~4.csv`)을 직접 읽는다(전과 출력 동일 확인) → 로컬 `data/` 폴더는 더 필요 없음. `vercel.json`에 `buildCommand`·`includeFiles: dist/data/**` 추가, `.gitignore`에 `dist/data/`. 남은 확인: 실제 Vercel 빌드·함수 크기. 참고: `outputDirectory`가 `dist`라 동별 JSON도 정적 파일로 공개된다(원본 CSV가 이미 공개 저장소에 있으므로 문제는 아님).
3. **DB 후속(팀 합의 필요)** — `supabase/migrations`의 snapshot에 `review_count` 추가, 노출 횟수 +1 RPC. 근거: `C:\3th_project\서울_해커톤\analysis-rating-impressions.md`.
4. **장바구니** — `dist/recommend.html`의 `renderCards` 주문 버튼은 Supabase 데모 카탈로그(4,672곳)로 조회해서, 새 데이터에만 있는 가게는 담기 실패 가능.
5. **새로고침 정책 결정** — 지금은 새로고침=처음부터(`SESSION_KEY` 처리부), 다른 화면 갔다 오면 `state.step`에서 이어짐. 요청이 엇갈려 결정 필요.
6. **튜닝** — `CONTEXT_WEIGHTS.mealCafe`(화양동 "겨울 저녁" 데모에서 크로플이 1등), `SEASON_HINTS` 오탐(크로플 설명의 "따뜻" 등), 대화형 카테고리 목록에 카페·디저트 포함 여부(`askCategory`).
7. **미착수** — 실제 Gemini 응답 시간(`GEMINI_API_KEY=... node scripts/bench.js`, 키가 없어 미측정), 피드백 P2(비교 화면, `docs/data-source.md`·`docs/fairness-metrics.md`).

## 확인된 사실
- **보정 별점**: 공식은 요청과 같지만 운영 snapshot에 `review_count`가 없어 원래 별점이 쓰인다 → 리뷰 1개 5.0 가게가 300개 4.8 가게를 이김. 로컬 데이터(review_count 있음)에선 4.8 가게 1위(별점 점수 17.22 > 14.39). 재현: `node scripts/analysis/rating.mjs`.
- **노출 횟수**: DB 저장 없음(서버 메모리, 인스턴스·캐시 갱신 시 사라짐). 같은 질문 반복 시 2·3등 교대는 메모리 값 덕분(무작위 고정해도 2/2 교대). 재현: `node scripts/analysis/impressions.mjs`.
- **동 중심점 중복**: 20개 동(8묶음, 예: 서초1~4동, 성수2가1·3동)은 중심점이 같아 GPS로 구분 불가 → 그래서 [현재 위치]는 등록 주소 기준으로 바꿈.
- **데이터 특성**: 배달팁 0원 가게 약 11%(화양동 49곳, 성수1가1동 2곳). 화양동은 카페가 가장 많음.

## 주의할 점
- **데이터 값을 고치지 말 것**(FE 프롬프트 조건). 복사 검증은 `git cat-file blob origin/main:<파일> | cmp - data/<파일>` — CSV가 BOM+CRLF라 `git hash-object` 비교는 거짓으로 "다름"이 나온다.
- **DB(마이그레이션·시드)는 팀 합의 없이 실행하지 말 것.** `main`에 force push 금지.
- 기존 테스트는 **비대화형 엔진**(합성 데이터) 기준이다. 대화형 흐름은 `createEngine(…, { guided: true })`에서만 켜지고 서버는 항상 켠다. 새 테스트도 이 구분을 지킬 것.
- 성별 단어는 조건으로 쓰지 않는다(`GENDER_WORDS`로 제거). 계절 자동 추정은 12~2월·6~8월만(11월엔 null).
- Windows 셸에서 한글이 든 heredoc·python 인라인이 깨지는 경우가 있었다 → 스크립트를 파일로 써서 실행.
