# 회귀 방지 가이드 — 투어 패키지 단가 빌더

> **목적**: 한 번이라도 발생한 이슈가 다시 들어오지 않도록 영구 정착.
> **메커니즘**: 정적 분석 스크립트(30 invariant) + npm prebuild hook + Claude Agent.

## 빠른 검증

```bash
# 단독 실행
npm run check:regressions

# build 직전 자동 실행 (prebuild hook)
npm run build

# dev 직전 자동 실행 (predev hook)
npm run dev
```

통과 시 `✅ 모든 invariant 통과 — 빌드 진행 가능.` + exit 0.
위반 시 항목별 상세 + `❌ 회귀 검출 — 빌드 차단.` + exit 1.

## Claude Agent 자동 호출

```
Agent({
  subagent_type: 'tour-pricing-regression-guard',
  prompt: '빌드 전 회귀 점검 실행'
})
```

`.claude/agents/tour-pricing-regression-guard.md`에 정의됨.

---

## 이슈 이력 + 방지 메커니즘

### Issue #1 — 무한 깜빡임 (5회 reload 시 layout shift)
- **발생**: 2026-06-01
- **증상**: form이 매 reload마다 1420px → 418px 점프, 4지선다 영역 있고 없고
- **원인 분석** (4건 동시):
  1. `public/sw.js` 잔존 — 이전 production 빌드 SW가 브라우저 캐시에 살아 있어 dev HTML 가로채기
  2. `reactStrictMode: true` — dev에서 모든 컴포넌트 mount→unmount→mount 2회 실행 → dynamic ssr:false placeholder→real→unmount→placeholder→real 사이클
  3. `reloadOnOnline: true` — 네트워크 ping마다 자동 reload 트리거
  4. `@import url(...)` + `<link preload>` Pretendard CSS 중복 다운로드 → FOIT 깜빡
- **박멸**:
  - `public/sw.js`·`swe-worker-*.js` 삭제
  - `next.config.ts` 3종 비활성 (strictMode·reloadOnOnline·devIndicators)
  - `layout.tsx`에 SW cleanup inline script (localhost 한정 강제 unregister + Cache Storage 삭제)
  - `globals.css` @import url() 제거, layout.tsx preload+stylesheet 한 쌍만
- **방지 invariant**: R01 · R02 · R04 · R09 · R12 · R14

### Issue #2 — 콜드 컴파일 첫 페인트 form 1420px 풀폭
- **발생**: 2026-06-01
- **증상**: 첫 페인트 후 0.x초 동안 form이 가로 풀폭(1420px)으로 나타났다가 max-w-md(418px)로 점프
- **원인**: Tailwind CSS 다운로드 전 SSR이 form을 출력했는데 `max-w-md` 클래스 적용 안 됨
- **박멸**: login form 안 inline `style={{ maxWidth: '28rem', width: '100%' }}`. Tailwind 로드 전에도 SSR 첫 페인트부터 28rem 고정. 추가로 layout.tsx에 critical inline CSS 주입.
- **방지 invariant**: R13 · R16

### Issue #3 — Pretendard CDN net::ERR_FAILED
- **발생**: 2026-06-02
- **증상**: console에 `Failed to load resource: net::ERR_FAILED @ https://cdn.jsdelivr.net/.../pretendardvariable-dynamic-subset.min.css`
- **원인**: cdn.jsdelivr.net 외부 의존. 네트워크 차단·CDN 장애 시 console error 발생
- **박멸**:
  - layout.tsx Pretendard preload/stylesheet 제거
  - globals.css `@import url()` 제거
  - font-family를 한국어 시스템 폰트 체인으로 교체 (`Apple SD Gothic Neo` macOS·iOS / `Malgun Gothic` Windows / `Noto Sans CJK KR` Android·Linux)
  - next.config.ts CSP `style-src`·`font-src`에서 jsdelivr 제거
- **방지 invariant**: R06 · R12 · R13 · R14 · R15

### Issue #4 — Router action HMR error
- **발생**: 2026-06-02
- **증상**: dev console에 `Uncaught Error: Internal Next.js error: Router action dispatched before initialization`
- **원인**: Next.js 16 webpack dev HMR 내부 race condition. `WebSocket.handleMessage → hmrRefresh → dispatchAppRouterAction`이 router 초기화 전 호출. 스택 트레이스에 사용자 코드 0건. production HMR 없으므로 production 영향 0
- **박멸**: layout.tsx에 localhost 한정 dev silencer (window.error · unhandledrejection · console.error 3 채널 가로채기). 패턴 일치만 필터 — `Router action dispatched before initialization`·`Internal Next.js error`·`state update on a component that hasn't mounted yet`. 다른 에러는 그대로 통과
- **방지 invariant**: R11

### Issue #5 — /api/chat fetch Failed
- **발생**: 2026-06-02
- **증상**: console에 `Failed to load resource: net::ERR_SSL_PROTOCOL_ERROR @ https://localhost:3000/login?from=/api/chat`
- **원인** (2건 동시):
  1. CSP `upgrade-insecure-requests` — localhost HTTP fetch를 https로 강제 업그레이드 → SSL 핸드셰이크 실패
  2. proxy.ts가 미인증 시 `/api/chat`도 `/login` HTML로 redirect → fetch가 redirect 따라가서 HTML 받음 → JSON 파싱 실패
- **박멸**:
  - CSP에서 `upgrade-insecure-requests` 제거 (HSTS 헤더가 HTTPS 강제 담당)
  - proxy.ts에 `/api/*` 경로는 redirect 대신 JSON 401 응답 분기
- **방지 invariant**: R05 · R17

### Issue #6 — ChatbotPlaceholder 잔존
- **발생**: 2026-06-02
- **증상**: 실 Chatbot.tsx 작성 후에도 page.tsx에 ChatbotPlaceholder import 잔존 위험
- **박멸**: 파일 삭제 + page.tsx grep 0건 검증
- **방지 invariant**: R18

### Issue #7 — 시크릿 노출 위험
- **발생**: 운영 중 상시
- **증상**: `.env.local`이 실수로 git 커밋되면 AUTH_PW·AUTH_SECRET·ANTHROPIC_API_KEY 등 노출
- **박멸**: `.gitignore`에 `.env*` 패턴 명시
- **방지 invariant**: R30

### Issue #8 — 금액 입력 시 "0" prefix 버그 (사용자 보고 2026-06-02)
- **발생**: 2026-06-02 (사용자 실 사용 중 발견 — 검증 한계 노출)
- **증상**: NumField가 `value=0` 상태에서 "0" 표시 → 사용자가 "5000" 타이핑하면 "05000"으로 보이고, 그 사이 onChange가 호출되며 controlled value가 5000으로 갱신되지만 사용자 입력 시점에 prefix 0 보임
- **근본 원인**:
  - controlled `<input type="number" value={value}>` 패턴 + value=0
  - `type="number"`는 prefix 0을 정규화하지 않고 그대로 표시
  - 사용자가 prepend 입력 시 cursor가 0 뒤에 위치
- **박멸**:
  - NumField에 **draft 패턴 적용** (PercentInput 같은 방식)
  - `type="text"` + `inputMode="numeric"` (모바일 숫자 키패드 자동 호출)
  - `value=0`이면 빈 string 표시 + `placeholder="0"`
  - focus 중에는 외부 sync 차단 (useEffect 의존성)
  - blur 시 정규화 (`String(Number(draft))` — prefix 0 자동 제거)
- **방지 invariant**: R31 · R32
- **검증 교훈**: 정적 분석·HTTP 응답·console error 0건 검증만으로는 **실 사용자 입력 시나리오 버그를 잡을 수 없음**. 향후 controlled input에 대한 draft 패턴 invariant 강제.

### Issue #10 — 모델 정책 위반 (Opus 4.8 미달 모델 사용)
- **발생**: 2026-06-02 (운영자 정책 점검)
- **증상**: `/api/chat/route.ts`와 `Chatbot.tsx`에 `claude-sonnet-4-5` 사용 — 글로벌 CLAUDE.md(2026-05-29 운영자 지시 Opus 4.8 이상 전용) 위반
- **운영자 정책 원문**: "Opus 4.8 이상 전용. 메인 세션·전 에이전트·서브에이전트를 `claude-opus-4-8`로 통일. Sonnet 4.6·Haiku 4.5 강등은 운영자 명시 승인 시에만. 근거는 거대 시스템 개발·0.1% 품질 기준에서 비용보다 정확도·일관성 절대 우선."
- **박멸**:
  - `/api/chat/route.ts` model 필드·provider 필드·주석 모두 `claude-opus-4-8`로 일괄 교체
  - `Chatbot.tsx`의 receivedProvider 기본값·title 텍스트 모두 `claude-opus-4-8` 반영
  - `.claude/agents/tour-pricing-regression-guard.md`는 이미 `claude-opus-4-8` (확인 완료)
- **방지 invariant**: R38 (소스 코드 비-Opus 모델 ID 0건) · R39 (agent frontmatter model=claude-opus-4-8)
- **검출 검증**: receivedProvider를 일시적으로 `claude-sonnet-4-5`로 되돌렸을 때 스크립트가 정확히 exit 1 검출 → 즉시 원복

### Issue #9 — 카카오맵 검색 실패 진단 어려움 (사용자 보고 2026-06-02)
- **발생**: 2026-06-02 (사용자 보고 — 검색이 작동 안 함)
- **증상**: 카카오맵 검색 버튼 클릭 시 결과 없음 또는 SDK 로드 실패
- **가능 원인**:
  - `.env.local`에 `NEXT_PUBLIC_KAKAO_MAP_KEY` 미설정 (가장 가능성 높음)
  - 카카오 개발자 콘솔에서 도메인 화이트리스트 `localhost:3000` 미등록
  - CSP가 dapi.kakao.com·t1.daumcdn.net 차단
- **박멸**:
  - `ensureKakaoSdk`에 `console.log('[KakaoMap] SDK 로드 시작:', url)` 진단 메시지 (이미 있음)
  - 실패 시 사용자에게 친절 안내 (`F12 콘솔의 [KakaoMap] 메시지 확인`)
  - CSP `script-src`에 두 도메인 명시 포함 보장
- **방지 invariant**: R33 · R34
- **사용자 액션 필요**: `.env.local`에 `NEXT_PUBLIC_KAKAO_MAP_KEY=발급키` 추가 + 카카오 개발자 콘솔(developers.kakao.com) → 내 애플리케이션 → 플랫폼 → Web → 사이트 도메인에 `http://localhost:3000` 등록

---

## Invariant 추가 절차

새 이슈가 발생해서 박멸했을 때, 다시는 안 들어오게 하려면:

1. `scripts/check-regressions.mjs`에 신규 `check('RXX', '라벨', () => { ... })` 추가
2. 이 문서(`docs/REGRESSION-GUARD.md`) "이슈 이력"에 항목 추가
3. `.claude/agents/tour-pricing-regression-guard.md`에 invariant 요약 추가
4. `npm run check:regressions` 실행해 30/30 통과 재확인

## 의도적 검출 동작 검증 방법

스크립트가 정말 검출하는지 확인하려면:

```bash
# 1. 임시 위반 도입 (예: reactStrictMode를 true로)
# 2. 스크립트 실행 — exit 1 + 위반 항목 출력 확인
# 3. 원복
```

위반 검출 확인 후 반드시 원복하세요.
