# Seoul_AI_HACKATHON
서울AI해커톤

## AI 메뉴 추천

주문자 앱 하단의 **✧ 메뉴 추천** 탭 → `dist/recommend.html`.
설계: [`docs/AI_서비스_동작_설계_v3.pdf`](docs/AI_서비스_동작_설계_v3.pdf) — 판단·계산은 코드가, 말 이해·질문·설명은 AI가 한다.

| 파일 | 역할 |
|---|---|
| `api/recommend.js` | `POST /api/recommend` (Vercel 함수). 대화 상태는 브라우저가 들고 다님 |
| `lib/engine.js` | 필터 · 기준가 · 주문 수량 · 점수(조건 50 + 가격 30 + 별점 20) · TOP3 · 양보안 · 후속 대화 |
| `lib/ai.js` | Claude 호출: ① 조건 정리 ② 좁히기 질문 ③ 맞음 판단 (JSON 형식 고정) |
| `dist/recommend.html` | 채팅 화면 (칩 · 선택지 · TOP3 카드) |
| `stores_excel`, `menus_excel` | 가게·메뉴 데이터 (CSV) |

```bash
npm install
npm test     # 설계서 숫자·흐름 자가 검사 (키 불필요)
npm start    # http://localhost:3000 → 주문자 앱 + 메뉴 추천
```

- **API 키**: 로컬은 `.env`에 `ANTHROPIC_API_KEY=...`, 배포는 Vercel 환경 변수. 키가 없거나 AI가 실패하면 설계서 4장대로 **AI 없이 코드만으로** 결과를 낸다 (조건은 키워드 규칙, 질문 생략, 판단은 메뉴 키워드).
- **데이터 칸 추가 시 자동 반영**: 메뉴 `is_main`(없으면 가게 메뉴 중앙값 50% 미만 = 사이드), 가게 `min_order`(없으면 최소주문 필터 없음).
- **알려진 한계**: 노출 횟수는 서버 메모리(재시작 시 초기화, 유지하려면 Supabase로) · 찜·탕은 1인당 1개로 계산(리허설에서 조정).
