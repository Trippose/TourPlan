# UI/UX 디자인 최적화 — 입력 칸·페이지 구성·작성 편의

작성: 2026-06-18 · 대상: src/app/page.tsx + src/components/ui/input.tsx + globals.css
근거: design-reviewer 감사 63점/100(blocker 4·high 3·medium 3·low 2) + 전체 화면 실측(ux-audit-full.png)

## 사용자 요구 (핵심 의도)
"텍스트 작성 공간·작성하는 칸 표시·페이지 구성을 더 편리하게." 입력 칸이 작고 빽빽하며(높이 6종 혼재·글씨 10~11px), 섹션 이모지 남용·정보 위계 흐림.

## 성공기준 (검증 가능)
1. 입력 칸 일관 — height 1종(h-10/40px) · focus ring 1종(브랜드 분홍) · 입력 글씨 ≥ text-sm(14px). grep으로 height 종 수·임의 px 글씨 0건 확인
2. 회귀 0 — `npx tsc --noEmit` exit 0 · 회귀가드 49/49 · 로컬 dev(3100) live 콘솔 0 error · 기존 기능(계산·저장·지도·인쇄) 동작 유지
3. 로컬 검증 후 배포 — 각 단계 커밋 → 로컬 확인 → main push → Vercel 반영 실측

## 단계 (우선순위 — 사용자 핵심부터)

### 1단계: 입력 칸 통일·확대 (작성 편의 직접) [blocker]
- input.tsx 기본 h-8→h-10, 글씨 text-base 유지·focus ring 통일
- page.tsx NumField·PercentInput·직접 input height를 h-10 단일화(현 h-6~h-12 6종)
- focus ring을 globals.css 브랜드 분홍 1종으로 통일(현 3종)
- 빈 칸 식별 — placeholder 명확화, 미입력 시 옅은 보더 강조

### 2단계: 글씨·레이블 가독성 [high]
- text-[10px]·[11px]·[15px] 임의 24건 → text-xs/sm/base 스케일로
- globals.css 강제 override 삭제(선언값=렌더값 일치)
- 입력 레이블을 칸 위로 분리·명확화

### 3단계: 페이지 구성·간격·위계 [high/medium]
- 섹션 간격 8pt 그리드 정리, 그룹핑 시각 구분
- 이모지 섹션 제목 → 텍스트 weight/색 위계로(의미 이모지만 유지)
- SummaryBox 좌측 정렬, StopCard 폭 유동화(clamp)

### 4단계: 디자인 토큰 일관성 [medium/low]
- rgba 리터럴 11건 → PAL tint 토큰
- border-radius 5종→3종, font-weight 5종→3종
- 7색 동시노출 → 역할 분리(브랜드/성공/정보 + 일정카드 한정)

## 방식·안전장치
- 로컬 dev 서버(포트 3100)로 작업·실시간 확인 (실서비스 직접 수정 금지)
- 단계별 원자 커밋 → 단계마다 회귀가드+tsc → 로컬 live 확인 → 배포
- page.tsx 거대 파일: 공통 컴포넌트(input.tsx·NumField·PercentInput) 우선 수정으로 일괄 개선 효과
- 기능 로직 불변 — className·레이아웃만 수정(Surgical Changes)
