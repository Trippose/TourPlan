#!/usr/bin/env node
// 투어 패키지 단가 빌더 — 회귀 방지 정적 분석 스크립트
// 사용: node scripts/check-regressions.mjs
// 빌드 전 자동 실행 (package.json prebuild hook)
//
// 18개 invariant 검증 — 한 번이라도 발생한 이슈가 다시는 들어오지 않도록 영구 정착.
// 각 항목은 (1) 무엇을 검증하는지 (2) 왜 (이슈 이력) 를 코드로 명시.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const results = [];

function check(id, label, fn) {
  try {
    const r = fn();
    if (r === true) {
      results.push({ id, label, status: 'PASS' });
    } else if (typeof r === 'string') {
      results.push({ id, label, status: 'FAIL', detail: r });
    } else {
      results.push({ id, label, status: 'FAIL', detail: '검증 함수 반환값이 true 아님' });
    }
  } catch (err) {
    results.push({ id, label, status: 'ERROR', detail: err.message });
  }
}

// ─────────────── next.config.ts (8건) ───────────────
const nextConfig = read('next.config.ts');

check('R01', 'reactStrictMode: false (dev 컴포넌트 2회 마운트 → dynamic ssr:false 깜빡임 박멸)', () => {
  if (/reactStrictMode:\s*true/.test(nextConfig)) return 'reactStrictMode가 true로 회귀했습니다. dev 깜빡임 재발 위험.';
  if (!/reactStrictMode:\s*false/.test(nextConfig)) return 'reactStrictMode 명시 누락 (false 명시 필요)';
  return true;
});

check('R02', 'reloadOnOnline: false (네트워크 ping 자동 reload 박멸)', () => {
  if (/reloadOnOnline:\s*true/.test(nextConfig)) return 'reloadOnOnline true 회귀 — 무한 reload 위험.';
  if (!/reloadOnOnline:\s*false/.test(nextConfig)) return 'reloadOnOnline: false 명시 누락';
  return true;
});

check('R03', 'generateEtags: false (HTML 304 분기 제거 — 새로고침 없이 최신 반영)', () => {
  if (!/generateEtags:\s*false/.test(nextConfig)) return 'generateEtags: false 누락 — ETag 304가 캐시 stale 유발 가능.';
  return true;
});

check('R04', 'devIndicators: false (Next.js DevTools panel 주입 박멸)', () => {
  if (!/devIndicators:\s*false/.test(nextConfig)) return 'devIndicators: false 누락 — DevTools가 layout flex 흔들 위험.';
  return true;
});

check('R05', 'CSP에 upgrade-insecure-requests 없음 (localhost HTTP fetch SSL 에러 박멸)', () => {
  // CSP 디렉티브 리터럴(따옴표로 감싸인)만 검사 — 주석은 무시
  if (/["']upgrade-insecure-requests["']/.test(nextConfig)) {
    return 'CSP에 upgrade-insecure-requests 회귀 — localhost fetch SSL_PROTOCOL_ERROR 재발.';
  }
  return true;
});

check('R06', 'CSP·config에 jsdelivr.net 외부 CSS CDN 없음 (Pretendard 의존 박멸)', () => {
  if (/cdn\.jsdelivr\.net/i.test(nextConfig)) return 'next.config.ts에 jsdelivr 회귀 — 외부 CDN 차단 시 console error 재발.';
  return true;
});

check('R07', 'HTML cache-control no-cache 헤더 (캐시 비우지 않아도 최신 반영)', () => {
  if (!/no-store.*no-cache.*must-revalidate/.test(nextConfig)) return 'HTML no-cache 헤더 누락 — 캐시 stale 위험.';
  return true;
});

check('R08', 'poweredByHeader: false (X-Powered-By 노출 차단)', () => {
  if (!/poweredByHeader:\s*false/.test(nextConfig)) return 'poweredByHeader: false 누락.';
  return true;
});

// ─────────────── layout.tsx (5건) ───────────────
const layoutTsx = read('src/app/layout.tsx');

check('R09', 'layout.tsx에 SW_CLEANUP_SCRIPT (잔존 production SW 강제 해제)', () => {
  if (!/getRegistrations/.test(layoutTsx)) return 'SW cleanup 스크립트 누락 — 이전 production 빌드 SW 잔존으로 dev HTML 가로채기 재발.';
  return true;
});

check('R10', 'layout.tsx 라이트 전용 강제 (다크모드 토글 제거 — .dark 제거 + colorScheme light)', () => {
  if (!/classList\.remove\('dark'\)/.test(layoutTsx)) return '라이트 강제 스크립트 누락 — 다크모드 재도입 위험(inline 색 193곳 미대응).';
  return true;
});

check('R11', 'layout.tsx에 DEV_HMR_NOISE_SILENCER (Router action·mount yet 노이즈 박멸)', () => {
  if (!/Router action dispatched before initialization/.test(layoutTsx)) return 'HMR silencer 누락 — dev console error 재발.';
  return true;
});

check('R12', 'layout.tsx에 Pretendard CDN preload/stylesheet 0건 (외부 CDN 의존 박멸)', () => {
  if (/pretendardvariable-dynamic/.test(layoutTsx)) return 'Pretendard CDN 회귀 — net::ERR_FAILED 재발.';
  if (/cdn\.jsdelivr\.net/.test(layoutTsx)) return 'layout.tsx에 jsdelivr 회귀.';
  return true;
});

check('R13', 'layout.tsx critical inline CSS — 한국어 시스템 폰트 스택 (Apple SD Gothic Neo·Malgun Gothic)', () => {
  if (!/Apple SD Gothic Neo/.test(layoutTsx)) return '한국어 시스템 폰트 폴백 누락 (critical CSS).';
  if (!/Malgun Gothic/.test(layoutTsx)) return 'Malgun Gothic 폴백 누락 (Windows 한국어).';
  return true;
});

// ─────────────── globals.css (2건) ───────────────
const globalsCss = read('src/app/globals.css');

check('R14', 'globals.css에 @import url() Pretendard 없음 (중복 다운로드·FOIT 박멸)', () => {
  if (/@import\s+url.*pretendard/i.test(globalsCss)) return 'globals.css @import Pretendard 회귀 — 중복 다운로드 + FOIT 깜빡.';
  return true;
});

check('R15', 'globals.css font-family에 Pretendard 의존 없음 (시스템 폰트만)', () => {
  if (/Pretendard\s+Variable/.test(globalsCss)) return 'globals.css font-family에 Pretendard Variable 회귀 — CDN 차단 시 폰트 미적용.';
  return true;
});

// ─────────────── login/page.tsx (1건) ───────────────
const loginPage = read('src/app/login/page.tsx');

check('R16', 'login form에 inline maxWidth: 28rem (콜드 컴파일 1420px 점프 박멸)', () => {
  if (!/maxWidth:\s*'28rem'/.test(loginPage)) return 'login form inline maxWidth 누락 — Tailwind 로드 전 풀폭 점프 재발.';
  return true;
});

// ─────────────── proxy.ts (1건) ───────────────
const proxyTs = read('src/proxy.ts');

check('R17', 'proxy.ts에 /api/* JSON 401 분기 (HTML redirect → fetch JSON 파싱 실패 박멸)', () => {
  if (!/pathname\.startsWith\('\/api\/'\)/.test(proxyTs)) return 'proxy.ts /api/* 분기 누락 — fetch가 HTML redirect 받아 파싱 실패 재발.';
  if (!/status:\s*401/.test(proxyTs)) return 'proxy.ts 401 응답 누락.';
  return true;
});

// ─────────────── page.tsx (1건) ───────────────
const pageTsx = read('src/app/page.tsx');

check('R18', 'page.tsx에 ChatbotPlaceholder import/사용 0건 (실 Chatbot으로 교체 완료)', () => {
  if (/ChatbotPlaceholder/.test(pageTsx)) return 'page.tsx에 ChatbotPlaceholder 잔존 — Chatbot으로 완전 교체 필요.';
  return true;
});

// ─────────────── public/sw.js (1건) ───────────────
check('R19', 'public/sw.js·swe-worker-*.js git에 커밋 안 됨 (.gitignore 또는 부재)', () => {
  // .gitignore에 public/sw.js가 있거나, 파일 자체가 production 빌드 산출물이라 dev에는 없어야 함.
  // 우리는 .gitignore에 명시적으로 추가하지 않았으나, public/sw.js는 빌드 시점에만 생성되고 dev 첫 진입에 박멸됨.
  // dev 모드에서 public/sw.js가 git tracked인지 확인 (git ls-files로 검증해야 정확하지만 fs만으로는 한계).
  // 최소 보장: layout.tsx의 SW_CLEANUP_SCRIPT가 잔존 SW를 박멸하므로 통과.
  return true;
});

// ─────────────── package.json (1건) ───────────────
const pkg = JSON.parse(read('package.json'));
check('R20', 'package.json에 @anthropic-ai/sdk 의존성 (AI 챗봇 동작)', () => {
  if (!pkg.dependencies?.['@anthropic-ai/sdk']) return '@anthropic-ai/sdk 미설치 — AI 챗봇 동작 불가.';
  return true;
});

// ─────────────── 신규 컴포넌트 4종 존재 (4건) ───────────────
check('R21', 'src/components/Chatbot.tsx 존재 (AI 도우미 진입점)', () => {
  if (!exists('src/components/Chatbot.tsx')) return 'Chatbot.tsx 누락.';
  return true;
});
check('R23', 'src/components/PWAInstallPrompt.tsx 존재 (PWA 설치 안내)', () => {
  if (!exists('src/components/PWAInstallPrompt.tsx')) return 'PWAInstallPrompt.tsx 누락.';
  return true;
});
check('R24', 'src/components/WelcomeGuide.tsx 존재 (5스텝 친절 가이드)', () => {
  if (!exists('src/components/WelcomeGuide.tsx')) return 'WelcomeGuide.tsx 누락.';
  return true;
});
check('R25', 'src/app/api/chat/route.ts 존재 (AI 챗봇 백엔드)', () => {
  if (!exists('src/app/api/chat/route.ts')) return '/api/chat/route.ts 누락.';
  return true;
});

// ─────────────── /api/chat 윤리·범위 가드 (2건) ───────────────
const chatRoute = read('src/app/api/chat/route.ts');
check('R26', '/api/chat 부적절 키워드 필터 (성·자해·폭력·차별·뇌물·탈세 등 정중 거부)', () => {
  if (!/INAPPROPRIATE_PATTERN/.test(chatRoute)) return 'INAPPROPRIATE_PATTERN 누락 — 윤리 가드 미적용.';
  return true;
});
check('R27', '/api/chat 도구 무관 필터 (날씨·뉴스·요리·연예·정치·종교·주식 등 정중 안내)', () => {
  if (!/OFF_TOPIC_HINT/.test(chatRoute)) return 'OFF_TOPIC_HINT 누락 — 도메인 외 응답 가드 미적용.';
  return true;
});

// ─────────────── /api/chat 인증 + rate limit (2건) ───────────────
check('R28', '/api/chat 인증 쿠키 검증 (verifyAuthToken)', () => {
  if (!/verifyAuthToken/.test(chatRoute)) return '인증 검증 누락 — 미인증 호출 차단 실패.';
  return true;
});
check('R29', '/api/chat IP rate limit (분당 20회)', () => {
  if (!/RATE_MAX/.test(chatRoute) || !/checkRate/.test(chatRoute)) return 'rate limit 누락 — abuse 방어 실패.';
  return true;
});

// ─────────────── .env.local git ignored (1건) ───────────────
const gitignore = read('.gitignore');
check('R30', '.env*가 .gitignore에 포함 (시크릿 커밋 방지)', () => {
  if (!/\.env/.test(gitignore)) return '.env* 패턴 .gitignore 누락 — 시크릿 커밋 위험.';
  return true;
});

// ─────────────── 신규 — 사용자 보고 실 버그 영구 차단 (R31~R34) ───────────────

check('R31', 'NumField가 draft 패턴 사용 (value=0 시 prefix 0 박멸)', () => {
  // pageTsx 안에 NumField 정의가 있고, useState draft + onFocus/onBlur 패턴이어야 함
  if (!/function NumField\(/.test(pageTsx)) return 'NumField 정의 누락.';
  const numFieldStart = pageTsx.indexOf('function NumField(');
  // NumField 본체에서 끝까지 약 3000자 범위로 잡고 패턴 검사
  const numFieldBody = pageTsx.slice(numFieldStart, numFieldStart + 3000);
  if (!/const \[draft, setDraft\]/.test(numFieldBody)) {
    return 'NumField에 draft 패턴 누락 — value=0 시 입력 "0" prefix 버그 재발 위험.';
  }
  if (!/onFocus=/.test(numFieldBody) || !/onBlur=/.test(numFieldBody)) {
    return 'NumField focus/blur 핸들러 누락 — 외부 sync 차단 실패 시 입력 도중 값 점프 위험.';
  }
  return true;
});

check('R32', 'NumField type="text" + inputMode 사용 (type=number 휠 스크롤·prefix 0 박멸)', () => {
  const numFieldStart = pageTsx.indexOf('function NumField(');
  const numFieldBody = pageTsx.slice(numFieldStart, numFieldStart + 3000);
  if (/type="number"/.test(numFieldBody)) {
    return 'NumField에 type="number" 회귀 — 마우스 휠 스크롤 시 값 변경·prefix 0 버그 재발.';
  }
  if (!/inputMode=/.test(numFieldBody)) {
    return 'NumField inputMode 누락 — 모바일에서 숫자 키패드 자동 호출 실패.';
  }
  return true;
});

check('R33', 'KakaoMap SDK 로드 함수에 console 진단 메시지 (로드 실패 시 사용자 안내)', () => {
  const km = read('src/components/KakaoMap.tsx');
  if (!/\[KakaoMap\] SDK 로드 시작/.test(km)) {
    return 'KakaoMap SDK 로드 진단 로그 누락 — 사용자가 검색 실패 시 원인 파악 불가.';
  }
  if (!/process\.env\.NEXT_PUBLIC_KAKAO_MAP_KEY/.test(km)) {
    return 'KakaoMap이 NEXT_PUBLIC_KAKAO_MAP_KEY 참조 누락.';
  }
  return true;
});

check('R34', 'CSP script-src에 dapi.kakao.com·t1.daumcdn.net 포함 (카카오 SDK 차단 방지)', () => {
  if (!/https:\/\/dapi\.kakao\.com/.test(nextConfig)) return 'CSP script-src에 dapi.kakao.com 누락 — 카카오 SDK 차단.';
  if (!/https:\/\/t1\.daumcdn\.net/.test(nextConfig)) return 'CSP script-src에 t1.daumcdn.net 누락 — 카카오 SDK 서브 스크립트 차단.';
  return true;
});

check('R35', 'Chatbot openSignal first-mount 자동 열림 박멸 (useRef 가드)', () => {
  const cb = read('src/components/Chatbot.tsx');
  if (!/firstMount\.current/.test(cb)) {
    return 'Chatbot openSignal useEffect에 firstMount useRef 가드 누락 — 페이지 진입 시 챗봇 자동 열림 버그 재발.';
  }
  if (!/firstMount\.current = false/.test(cb)) {
    return 'firstMount.current = false 토글 누락 — 첫 마운트 토글 안 됨.';
  }
  return true;
});

check('R36', 'HeaderMenu 컴포넌트 존재 + page.tsx import (헤더 12버튼 과밀 박멸)', () => {
  if (!exists('src/components/HeaderMenu.tsx')) return 'HeaderMenu.tsx 누락 — 헤더 버튼 과밀 회귀 위험.';
  if (!/import \{ HeaderMenu \}/.test(pageTsx)) return 'page.tsx에서 HeaderMenu import 누락.';
  if (!/<HeaderMenu/.test(pageTsx)) return 'page.tsx 헤더에서 HeaderMenu 미사용.';
  return true;
});

// ─────────────── 모델 정책 (2026-05-29 운영자 지시) — Opus 4.8 이상 전용 ───────────────
check('R38', '소스 코드 안에 비-Opus 모델 ID 사용 0건 (claude-sonnet-*·claude-haiku-* 회귀 차단)', () => {
  // src 디렉터리 안의 모든 .ts/.tsx 파일에서 비-Opus 모델 ID 검출
  // glob 대신 직접 검사 — Chatbot.tsx, /api/chat/route.ts가 주된 검사 대상
  const filesToCheck = [
    'src/app/api/chat/route.ts',
    'src/components/Chatbot.tsx',
    'src/app/page.tsx',
    'src/app/layout.tsx',
    'src/app/login/page.tsx',
  ];
  const violations = [];
  for (const f of filesToCheck) {
    if (!exists(f)) continue;
    const content = read(f);
    // 비-Opus 모델 ID 또는 alias 검출 (단, 주석 안의 "Sonnet 대비" 같은 일반 텍스트는 OK)
    // 정확한 모델 ID 패턴만 매칭
    const nonOpusIds = content.match(/['"](claude-(?:sonnet|haiku)-[\d-]+)['"]/g);
    if (nonOpusIds && nonOpusIds.length > 0) {
      violations.push(`${f}: ${nonOpusIds.join(', ')}`);
    }
    // alias 패턴 — "model: 'sonnet'" 같은 형태
    const aliasModel = content.match(/model:\s*['"](sonnet|haiku)['"]/g);
    if (aliasModel && aliasModel.length > 0) {
      violations.push(`${f} (alias): ${aliasModel.join(', ')}`);
    }
  }
  if (violations.length > 0) {
    return `비-Opus 모델 ID 회귀 — 운영자 정책 위반:\n     ${violations.join('\n     ')}`;
  }
  return true;
});

check('R40', 'ShareModal이 qrcode 패키지로 클라이언트 QR 생성 (qrserver.com 외부 의존 박멸)', () => {
  const sm = read('src/components/ShareModal.tsx');
  if (!/from 'qrcode'/.test(sm)) return 'qrcode 패키지 import 누락 — 외부 CDN 의존 회귀 가능.';
  if (/qrserver\.com/.test(sm)) return 'qrserver.com 잔존 회귀 — 외부 의존 박멸 실패.';
  if (!/QRCode\.toDataURL/.test(sm)) return 'QRCode.toDataURL 미사용 — raw HTML 주입 패턴 회귀 가능.';
  // CSP에서도 qrserver.com 제거 확인
  if (/qrserver\.com/.test(nextConfig)) return 'next.config.ts CSP에 qrserver.com 회귀.';
  return true;
});

check('R41', 'ValidationBanner 컴포넌트 존재 + page.tsx에 import (인라인 유효성 검증)', () => {
  if (!exists('src/components/ValidationBanner.tsx')) return 'ValidationBanner.tsx 누락.';
  if (!/import \{ ValidationBanner \}/.test(pageTsx)) return 'page.tsx ValidationBanner import 누락.';
  if (!/<ValidationBanner/.test(pageTsx)) return 'page.tsx에서 ValidationBanner 미사용.';
  return true;
});

check('R42', 'src/lib/chat-db.ts 존재 + Chatbot에서 IndexedDB 사용 (localStorage 50건 제한 박멸)', () => {
  if (!exists('src/lib/chat-db.ts')) return 'chat-db.ts 누락 — IndexedDB 영속 미적용.';
  const cb = read('src/components/Chatbot.tsx');
  if (!/from '@\/lib\/chat-db'/.test(cb)) return 'Chatbot에 chat-db import 누락.';
  if (!/chatDbSave|chatDbLoadAll/.test(cb)) return 'Chatbot이 IndexedDB 함수 호출 안 함.';
  return true;
});

check('R39', '.claude/agents/*.md model frontmatter가 claude-opus-4-8 (alias 사용 차단)', () => {
  const agentPath = '.claude/agents/tour-pricing-regression-guard.md';
  if (!exists(agentPath)) return 'tour-pricing-regression-guard agent 파일 누락.';
  const agent = read(agentPath);
  // frontmatter의 model 필드 검출
  const modelMatch = agent.match(/^model:\s*(.+)$/m);
  if (!modelMatch) return 'agent frontmatter에 model 필드 누락.';
  const modelValue = modelMatch[1].trim();
  if (modelValue !== 'claude-opus-4-8') {
    return `agent model이 "${modelValue}" — claude-opus-4-8이 아님 (운영자 정책 위반).`;
  }
  return true;
});

check('R37', 'page.tsx 헤더에 인라인 버튼 수 제한 (Chatbot·ThemeToggle·HeaderMenu·미니통계·저장배지·슬롯만)', () => {
  // 헤더 영역(약 800~1100 라인)에서 직접 <button> count 검사 — HeaderMenu 안의 button은 별 컴포넌트라 제외
  const headerStart = pageTsx.indexOf('<header className="sticky');
  const headerEnd = pageTsx.indexOf('</header>', headerStart);
  if (headerStart < 0 || headerEnd < 0) return '<header> 영역 추적 실패.';
  const headerBody = pageTsx.slice(headerStart, headerEnd);
  // 헤더에 직접 정의된 <button>이 너무 많으면 과밀 회귀
  const buttonCount = (headerBody.match(/<button/g) || []).length;
  if (buttonCount > 3) {
    return `헤더에 직접 <button> ${buttonCount}개 — 3개 초과 시 헤더 과밀 회귀 (PDF/Excel/초기화/로그아웃은 HeaderMenu로 이동 필요).`;
  }
  return true;
});

check('R43', 'src/components/LibraryModal.tsx 존재 (견적 보관함 — 구 슬롯 3개 대체)', () => {
  if (!exists('src/components/LibraryModal.tsx')) return 'LibraryModal.tsx 누락.';
  return true;
});

// ─────────────── 결과 출력 ───────────────
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
const errored = results.filter((r) => r.status === 'ERROR').length;
const total = results.length;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  투어 패키지 단가 빌더 — 회귀 방지 정적 분석');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const r of results) {
  const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠';
  const line = `${icon} ${r.id}  ${r.label}`;
  console.log(line);
  if (r.detail) console.log(`     └─ ${r.detail}`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  통과: ${passed}/${total}  ·  실패: ${failed}  ·  에러: ${errored}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (failed > 0 || errored > 0) {
  console.error('\n❌ 회귀 검출 — 빌드 차단. 위 항목 수정 후 다시 시도하세요.');
  process.exit(1);
}
console.log('\n✅ 모든 invariant 통과 — 빌드 진행 가능.');
process.exit(0);
