# 개발 환경 맞추기 (SETUP)

clone한 뒤 아래 순서대로 하면 작업한 사람과 **같은 테스트·평가 숫자**가 나온다. 외부 패키지는 없다(Node 기본 기능만 사용).

## 1. 준비

| 항목 | 값 |
|---|---|
| Node | 24 (`.nvmrc`), 최소 22.9 (`package.json` engines). `nvm use`로 맞춘다 |
| 패키지 | 의존성 없음. `npm ci`는 lock 확인만 하고 끝난다 |
| AI 키 | 없어도 된다 (규칙 모드로 동작) |

```bash
git clone https://github.com/wjdgustn491-collab/Seoul_AI_HACKATHON.git
cd Seoul_AI_HACKATHON
git checkout feature/recommend-questions-20261121
nvm use            # 또는 Node 24 설치
npm ci
```

## 2. 환경변수 (선택)

```bash
cp .env.example .env.local   # 값은 비워 두면 규칙 모드
```

| 변수 | 설명 |
|---|---|
| `GEMINI_API_KEY` | Gemini 키. 비우면 AI 없이 규칙 기반 |
| `GEMINI_MODEL` | 모델 이름 (비우면 코드 기본값) |
| `LLM_PROVIDER` | `gemini` / `none`. 로컬 dev 서버는 비어 있으면 `none` |
| `RECOMMENDATION_MODE` | `rules`면 키가 있어도 AI를 부르지 않는다 |
| `PORT`, `DEV_DELAY_MS` | 로컬 서버 포트(기본 4173), 응답 지연(로딩 화면 확인용) |

`.env.local`은 `.gitignore` 대상이다. 키를 커밋하지 않는다.

**Gemini 없이 규칙 모드로 돌리기**: `.env.local`을 비워 두거나 `RECOMMENDATION_MODE=rules`를 넣는다. 테스트와 평가 스크립트는 기본이 규칙 모드다.

## 3. 데이터 빌드 → 테스트 → 평가

```bash
npm run build:data   # 루트 원본 CSV(stores_excel, hackathon_menus_part1~4.csv, dong_centroids, delivery_zone) → dist/data (약 2초, 58MB)
npm test             # node --test "test/*.test.js"
npm run eval         # 고객 질문 1,200 + 예외 질문 432 평가 (규칙 모드, 약 2~3분)
```

- `dist/data`가 없으면 동 데이터 테스트(`recommend-dong`, `recommend-api`)는 **skip**된다 → 테스트 수가 달라진다. 반드시 `build:data` 먼저.
- 평가 옵션: `--only customer|edge`, `--show N`(실패 예 N개), `--json 파일`, `--sample N`, `--ai`(Gemini 표본 평가, 키 필요), `--seed N`.
- 분석 스크립트(`scripts/analysis/*.mjs`)는 Supabase 스냅샷 캐시가 필요하다: `npm run fetch:catalog` → `local/catalog.json`.

## 4. 로컬 실행

```bash
npm run dev          # http://localhost:4173/recommend.html
```

`scripts/dev.mjs`가 `dist/` 정적 파일과 `/api/recommend`(Vercel 함수 그대로)를 띄운다. 추천은 `dist/data`를 읽는다.

## 5. "같은 결과"의 기준

아래 숫자가 나오면 환경이 맞은 것이다 (기준 커밋: 이 브랜치의 최신 커밋, Node 24.9, Windows 11에서 측정).

| 항목 | 기준값 |
|---|---|
| `npm test` | 106개 중 106 통과, 0 실패, 0 skip |
| 평가 · 고객 질문 필드 정확도 | 인원·예산·제외·배달팁·별점·착한가게·신규·프랜차이즈 100%, 카테고리 99.8% (1198/1200), 맛 98.2% (1178/1200) |
| 평가 · 빼달라는 음식 오인 / "매운 거 안 돼"→매운 | 0/733건, 0/105건 |
| 평가 · 예외 질문 전체 | 389/432, 변형 문장 일치 274/274 |

### 실행할 때마다 달라질 수 있는 부분과 고정 방법

| 부분 | 서버(실제) | 테스트·평가 |
|---|---|---|
| 점수가 5점 이내인 가게 순서 섞기 (`Math.random`) | 무작위 | 평가는 `createEngine(..., { random: seeded(20261121) })` 고정 시드. 테스트는 순서와 무관한 것만 검사(3회 연속 같은 결과 확인) |
| 노출 횟수 (서버 메모리, 매일 0시 초기화) | 인스턴스마다 다르고 재시작하면 사라짐 | 평가는 문항 순서가 고정이라 매번 같게 쌓인다 |
| 시간대·계절 판단 (되묻기 버튼, "날씨에 맞춰서") | 요청 시각(서울) | 평가는 `now: 2026-11-21 12:00 KST` 고정 |
| Gemini 응답 | 매번 다를 수 있음 | 기본은 규칙 모드라 영향 없음 (`--ai`일 때만) |

## 6. Supabase 마이그레이션

`supabase/migrations/`의 파일은 **팀 합의 없이 운영 DB에 적용하지 않는다**.

| 마이그레이션 | 운영 DB 상태 (2026-11-21 확인) |
|---|---|
| `20261121120000_connect_merchant_menus_to_recommendations.sql` | **미적용**: `seoul_delivery_demo`에 `recommendation_menu_changes`를 보내면 "지원하지 않는 시연 요청입니다"가 돌아온다 (API는 이 경우 빈 목록으로 처리) |
| 그 밖의 파일 | 공개 키로는 확인 불가. 관리자가 `supabase migration list`로 확인 |
| (아직 없음) snapshot에 `review_count` 추가, 노출 횟수 +1 RPC | 파일 미작성. 근거: `docs/instructions/analysis-rating-impressions.md` |

적용 방법 (관리자, 팀 합의 후):

```bash
supabase login
supabase link --project-ref pgkbazrskvxehbkgqbcv
supabase migration list     # 적용 여부 확인
supabase db push            # 미적용 파일 적용
```

또는 Supabase 대시보드 SQL Editor에서 파일 내용을 순서대로 실행한다. Edge Function(`supabase/functions/customer-enroll`)은 `SUPABASE_SERVICE_ROLE_KEY` 등을 Supabase 쪽 비밀값으로만 쓴다(저장소에 넣지 않는다).

## 7. 배포 (Vercel)

`vercel.json`의 `buildCommand`가 `node scripts/build-data.mjs`를 실행하고, `api/recommend.js`는 `includeFiles: dist/data/**`로 데이터를 함께 올린다. 실제 Vercel 빌드는 아직 확인하지 않았다.
