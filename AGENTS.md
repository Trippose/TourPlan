<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 이 프로젝트 운영 사실 (로컬 포트·카카오 도메인·배포)

## 로컬 dev 포트 — 3100 전용 (고정)
- 이 프로젝트(투어패키지단가계산)의 로컬 dev 포트는 **3100 전용**이다 (`next dev --port 3100`).
- **다른 모든 Claude Code 작업/프로젝트에서 포트 3100을 쓰지 말 것** (운영자 지시 2026-06-16). 포트 충돌 시 다른 포트를 쓰고 이 프로젝트는 3100을 보장한다.
- 포트를 바꾸면 카카오 지도가 깨진다 (아래 도메인 등록 참조). 과거 3000→3100 변경으로 지도 SDK가 `net::ERR_BLOCKED_BY_ORB`(401 domain mismatched)로 차단된 이력.

## 카카오 지도 도메인 등록 (필수)
- 카카오 JS SDK는 **등록된 도메인에서만** 로드된다. 미등록 도메인은 401 → 브라우저 ORB 차단 → 지도/검색 실패.
- 카카오 개발자 콘솔(developers.kakao.com → 내 애플리케이션 → 플랫폼 → Web)에 **반드시 등록할 주소**:
  - `http://localhost:3100` (로컬 dev — 2026-06-16 등록 완료)
  - 실서비스 도메인 (아래 Vercel 주소) — 운영 지도 작동에 필수
- 포트·도메인을 추가/변경하면 **콘솔에도 즉시 추가**할 것.

## 실서비스 배포 = Vercel (자동배포)
- 실제 서비스: **https://tour-plan-2026.vercel.app**
- 배포 경로: GitHub **`Trippose/TourPlan`** 의 `main` 브랜치 push → Vercel 자동 빌드/배포.
- **로컬 수정은 commit + `git push origin main` 해야 실서비스에 반영된다.** 로컬에서만 고치면 Vercel은 옛 코드를 계속 서비스한다.
- 검수·QA는 로컬(localhost:3100)뿐 아니라 **실서비스(Vercel)도 함께 확인**할 것 (로컬만 보면 실사용 문제를 놓친다).
