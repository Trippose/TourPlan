// AI 투어 단가 도우미 — Anthropic Claude Opus 4.8 + 프롬프트 캐싱 + 스트리밍
// 모델 정책 (2026-05-29 운영자 지시) — Opus 4.8 이상 전용, 강등은 명시 승인 시만
// 비용은 Sonnet 대비 약 5배이나 거대 시스템·0.1% 품질 기준에서 정확도·일관성 절대 우선
// prompt caching으로 시스템 프롬프트(10KB+) 캐시 시 후속 호출 약 90% 절감
// 보안 계층:
//   1. 인증 쿠키 검증 (proxy.ts가 /api/auth 외엔 보호하지만 명시 재검증)
//   2. Zod strict 입력 검증 (메시지 1~50건, 각 1~4000자)
//   3. IP rate limit: 분당 20회 (security.md 일반 API 60회 보수치)
//   4. ANTHROPIC_API_KEY 미설정 시 폴백 — 룰 기반 FAQ 5종 즉답 (no-silent-fallback.md 투명 표시)
//   5. 응답: { mode: 'ai' | 'rule-fallback', provider } 명시

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth';

export const runtime = 'nodejs';

const MessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })
  .strict();

const BodySchema = z
  .object({
    messages: z.array(MessageSchema).min(1).max(50),
    stream: z.boolean().optional(),
    context: z
      .object({
        packageName: z.string().max(200).optional(),
        productType: z.string().max(50).optional(),
        nights: z.number().int().min(0).max(30).optional(),
        partyTotal: z.number().int().min(0).max(1000).optional(),
        adult: z.number().int().min(0).max(1000).optional(),
        youth: z.number().int().min(0).max(1000).optional(),
        child: z.number().int().min(0).max(1000).optional(),
        infant: z.number().int().min(0).max(1000).optional(),
        partyTiered: z.boolean().optional(),
        vehiclesCount: z.number().int().min(0).max(20).optional(),
        vehicleKinds: z.array(z.string().max(60)).max(20).optional(),
        totalSeats: z.number().int().min(0).max(5000).optional(),
        guidesCount: z.number().int().min(0).max(20).optional(),
        guideLanguages: z.array(z.string().max(40)).max(20).optional(),
        stopsCount: z.number().int().min(0).max(100).optional(),
        stopTypes: z.array(z.string().max(20)).max(100).optional(),
        startTime: z.string().max(10).optional(),
        salePrice: z.number().int().min(0).max(100_000_000).optional(),
        channelsActive: z.number().int().min(0).max(20).optional(),
        channelNames: z.array(z.string().max(60)).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// IP slide window — 분당 20회 (대화형 사용 빈도 고려)
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
const chatBuckets = new Map<string, number[]>();

function checkRate(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const bucket = (chatBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= RATE_MAX) {
    const earliest = bucket[0];
    return { ok: false, retryAfter: Math.ceil((earliest + RATE_WINDOW_MS - now) / 1000) };
  }
  bucket.push(now);
  chatBuckets.set(ip, bucket);
  // 메모리 누수 방지 — 추적 IP가 1000개를 넘으면 가장 오래된 항목 1건 제거 (route-time/route.ts와 동일 정책)
  if (chatBuckets.size > 1000) {
    const firstKey = chatBuckets.keys().next().value;
    if (firstKey) chatBuckets.delete(firstKey);
  }
  return { ok: true };
}

// 클라이언트 IP — rate limit 키.
// ⚠ 보안 전제: 신뢰할 수 있는 리버스 프록시(Vercel·nginx 등) 뒤 배포로 프록시가 x-forwarded-for를 재작성한다는 가정.
//    서버가 직접 노출되면 클라이언트가 XFF를 위조해 매 요청 다른 IP를 주장, rate limit을 우회할 수 있다.
//    → 배포 인프라에서 XFF 재작성/신뢰 hop 설정 필수(코드만으로 방어 불가).
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// 룰 기반 폴백 — ANTHROPIC_API_KEY 미설정 또는 API 실패 시
const FAQ_RULES: Array<{ keywords: RegExp; answer: string }> = [
  {
    keywords: /bep|손익\s*분기|손익분기|분기점/i,
    answer:
      'BEP(손익분기점)는 **그룹 공통 원가(차량+가이드) ÷ 인원수 + 1인 원가(입장·식사·체험)**가 수수료 차감 후 판매가와 같아지는 인원수입니다.\n\n예: 차량+가이드 ₩600,000 / 1인 원가 ₩30,000 / 판매가 ₩200,000 / 채널 수수료 30%\n→ 실수령 ₩140,000\n→ ₩600,000 ÷ N + 30,000 = 140,000 → N ≈ 6명\n\n매트릭스 표의 색 변화로 채널별 BEP를 즉시 확인할 수 있습니다.',
  },
  {
    keywords: /수수료|커미션|채널.*수익|판매가/i,
    answer:
      '판매가에서 수수료는 **(판매가 × (1 − 수수료율))**로 차감됩니다.\n\n예: 판매가 ₩200,000 × (1 − 0.30) = **₩140,000** 실수령.\n\n채널별 수수료(자체모객 0% · 자체 온라인 5% · 글로벌 OTA 25~30%)가 매트릭스에 자동 반영됩니다. 1인 수익이 음수면 적자, 0~10% 미만이면 BEP 근접, 10% 이상이면 흑자 구간입니다.',
  },
  {
    keywords: /차종|인승|차량.*인원|좌석|승차/i,
    answer:
      '차종명에 **"9인승"·"15인승"** 같은 숫자가 포함되면 정원·최대 탑승 인원이 자동 채워집니다.\n\n예: "카니발 9인승" 선택 → 정원 9 / 최대 탑승 9 자동 입력.\n최대 탑승 인원은 정원을 **초과할 수 없습니다** (서버 invariant). 더 큰 차량 필요 시 차종 자체를 변경하세요.',
  },
  {
    keywords: /지도|코스|마커|드래그|좌표|일정/i,
    answer:
      '카카오맵에서 검색해 경유지를 추가한 뒤, 지도 위 **마커를 마우스로 드래그**하면 해당 경유지의 좌표가 즉시 갱신됩니다.\n\n순서 변경은 일정 카드를 드래그&드롭. 일정마다 출발/도착/체류/식사/체험 5종 타입을 지정할 수 있고, 카카오 모빌리티 API가 인접 경유지 간 이동시간·거리를 자동 계산합니다.',
  },
  {
    keywords: /저장|초기화|로컬|입력값|새로고침/i,
    answer:
      '모든 입력은 브라우저 **로컬에 자동 저장**됩니다 (별도 저장 버튼 불필요).\n\n• 로그아웃해도 입력값 유지 (다음 로그인 시 그대로 복원)\n• 헤더 **"전체 초기화"** 버튼으로 비우기\n• 모든 계산(BEP·매트릭스·운영 권장)은 입력 즉시 반영',
  },
  {
    keywords: /pdf|인쇄|견적서|excel|csv|내보내기/i,
    answer:
      '• **PDF/인쇄**: 헤더 PDF 버튼 또는 Ctrl+P → A4 세로, 컬러 포함, 헤더·버튼 자동 숨김\n• **Excel/CSV**: 헤더 Excel 버튼 → NO·합계 SUBTOTAL 수식 포함된 일정표 다운로드\n\n인쇄 시 sticky 헤더는 정적으로 변환되고 카드 그림자가 제거되어 잉크를 절약합니다.',
  },
  {
    keywords: /설치|pwa|홈\s*화면|앱|standalone/i,
    answer:
      '• **Android/Chrome**: 헤더 "📲 설치" 버튼 → 홈 화면에 추가\n• **iOS Safari**: 하단 공유 버튼 → "홈 화면에 추가" 선택 → 우상단 추가 탭\n• **iPadOS 13+**: Safari에서만 가능 (Chrome 브라우저는 미지원)\n\n설치 후 홈 화면 아이콘으로 풀스크린 앱처럼 실행됩니다. 오프라인 상태에서도 마지막 입력값으로 계속 작업 가능합니다.',
  },
  {
    keywords: /다크\s*모드|라이트|테마|night|dark/i,
    answer:
      '헤더의 **🌙/☀️ 버튼**으로 다크/라이트 모드를 전환합니다. 선택은 브라우저에 영속 저장되고, 다음 방문 시 자동 복원됩니다.\n\n초기 진입 시에는 OS 설정(prefers-color-scheme)을 따릅니다.',
  },
];

// 부적절 키워드 — 정중 거부 분기 (룰·AI 모두 적용)
const INAPPROPRIATE_PATTERN = /(섹스|성관계|포르노|음란|자해|자살|폭력|살인|마약|뇌물|탈세|사기|차별|혐오|nude|porn|sexual|violence|drug)/i;
const OFF_TOPIC_HINT = /(날씨|뉴스|요리|레시피|영화|드라마|연예인|정치|선거|종교|주식|코인|투자|로또)/i;

function fallbackReply(userMsg: string): string {
  // 부적절 — 정중 거부
  if (INAPPROPRIATE_PATTERN.test(userMsg)) {
    return '이 부분은 답변드리기 어려운 내용입니다. **투어 단가 빌더 사용법**(견적 · BEP · 일정 · 채널 · PWA 설치 등)에 대해 다시 질문해주시면 친절히 안내해드리겠습니다.';
  }
  // 도구 무관 — 정중 거부
  if (OFF_TOPIC_HINT.test(userMsg)) {
    return '죄송합니다. 저는 **투어 단가 빌더 사용법 전용 도우미**입니다. 견적·BEP·일정·채널·PWA 설치 등 도구 관련 질문이라면 도와드릴게요. 다른 주제는 답변이 어렵습니다.';
  }
  // 도메인 매칭
  const match = FAQ_RULES.find((r) => r.keywords.test(userMsg));
  if (match) return match.answer;
  // 매칭 실패
  return (
    '도구 사용법 관련해 더 구체적으로 질문해주시면 더 정확히 안내해드릴 수 있어요. 다음 키워드 중심으로 다시 입력해보세요:\n\n' +
    '• **BEP / 손익분기** — 손익분기 인원 계산\n' +
    '• **수수료 / 판매가** — 수수료 차감 계산\n' +
    '• **차종 / 인승** — 차량 자동 입력\n' +
    '• **지도 / 마커 / 드래그** — 경유지 좌표 변경\n' +
    '• **저장 / 초기화** — 로컬 영속\n' +
    '• **PDF / Excel / 인쇄** — 내보내기\n' +
    '• **설치 / PWA** — 홈 화면 설치\n' +
    '• **다크 모드** — 테마 전환\n\n' +
    '_(AI 응답이 활성화되면 더 풍부한 대화가 가능합니다. 관리자가 ANTHROPIC_API_KEY 설정 시 자동 전환됩니다.)_'
  );
}

const SYSTEM_PROMPT = `당신은 한국 인바운드 투어 패키지 단가 의사결정 빌더의 전문 AI 도우미입니다. 사이트 전체 사용법·계산 공식·UI 위치를 모두 학습한 상태이며, 사용자의 현재 입력값을 함께 받아 구체적인 답을 합니다.

# 운영
- 회사: WATERTREE (Trippose.com + ktriptips.com — 한국 인바운드 OTA 20년)
- 도구: 투어 패키지 단가 의사결정 빌더 v2.1 (Next.js 16 + React 19 + Tailwind v4 + Serwist PWA)
- 대상: 한국 인바운드 외국인 단체·FIT 패키지 견적 산출

# 1. 화면 구성 (헤더 → 메인 카드 흐름)
헤더 (상단 sticky):
- 좌측: "투어 단가 빌더 v2.1" 브랜드
- 미니 통계: 인원/일정/좌석 (lg 이상에서만 표시)
- 우측 버튼: ❓ 도움말 / 🤖 도우미 (당신) / 📲 PWA 설치 / 🌙 다크모드 / 📄 PDF·인쇄 / 📊 Excel / 🗑 전체 초기화 / 🔒 로그아웃

메인 카드 흐름:
1) 패키지 상품명 + 유형(반일/종일/2D1N~6D5N/장기) + 박수
2) 인원 (성인/청소년/어린이/유아 — 통합/구분 모드 토글)
3) 차량 (차종/정원/최대 탑승/단가) — 최대 10대
4) 가이드 (이름/언어 9종/단가) — 최대 10명
5) 일정·코스 (카카오맵 + 일정 카드) — 최대 30곳
6) 판매가 (1인 기준, VAT 포함)
7) 채널 설정 (자체모객·자체 온라인·글로벌 OTA A·B·C)
8) 1인 원가·BEP·매트릭스·운영 권장
9) 캠페인 시뮬레이터 (선택)

# 2. 핵심 계산 공식 (반드시 정확히 답하세요)
[그룹 공통 원가]
= Σ(차량별 단가) + Σ(가이드별 단가)
= 모두 VAT 포함, 인원 무관 고정 비용

[1인 공통 단가]
= 그룹 공통 원가 ÷ 총 인원수
= 인원이 많아질수록 1인 부담 감소

[1인 개인 원가 (성인 기준)]
= 입장료 + 식사비 + 체험비 합계 (일정 카드별 합산)
- 청소년 ≈ 성인의 70%, 어린이 ≈ 50%, 유아 무료가 일반적

[1인 총 원가]
= 1인 공통 단가 + 1인 개인 원가

[수수료 차감 판매가]
= 판매가 × (1 − 수수료율)
- 예: ₩200,000 × (1 − 0.30) = ₩140,000

[1인 수익]
= 수수료 차감 판매가 − 1인 총 원가

[BEP 인원]
= 1인 수익이 0이 되는 인원수
= 그룹 공통 원가 ÷ (수수료 차감 판매가 − 1인 개인 원가)
- 예: 공통 ₩600,000 / 1인 원가 ₩30,000 / 판매 ₩200,000 / 수수료 30%
      → ₩140,000 − ₩30,000 = ₩110,000 (margin per pax)
      → BEP = 600,000 ÷ 110,000 ≈ **6명**

[총 그룹 수익]
= (수수료 차감 판매가 × N) − 그룹 공통 원가 − (1인 개인 원가 × N)
= N(수수료 차감 판매가 − 1인 개인 원가) − 그룹 공통 원가

# 3. 채널 분류 (기본값)
- 자체모객 (직접 영업/오프라인) — 수수료 0%
- 자체 온라인 (자사 웹사이트 결제) — 5% (PG 수수료)
- 글로벌 OTA A·B·C (KKday·Klook·Viator·Get Your Guide·트립닷컴 등) — 20~30%
* 사용자가 수수료율을 직접 조정 가능. 매트릭스에 채널×인원 1인 수익(₩) 색 그래디언트로 표시

# 4. 차량 자동 입력 (parseSeats)
차종명에 "N인승" 패턴이 있으면 정원·최대 탑승 자동:
- "카니발 9인승" → 정원 9, 최대 9
- "스타리아 11인승" → 11
- "솔라티 15인승" → 15
- "카운티 25인승" / "에어로타운 28인승" / "유니버스 35인승" / "그랜버드 40인승" / "45인승 버스"
- invariant: 최대 탑승 ≤ 정원 (서버 강제)

# 5. 일정·코스 (StopType 6종 — 실제 코드 정의 그대로)
- departure (출발) — 호텔/공항 출발 지점
- waypoint (경유) — 짧은 경유·환승
- sight (관광·체류) — 일반 관광지·박물관·전망대 등
- meal (식사) — 식당·바
- experience (체험) — 액티비티·공연·체험 프로그램
- arrival (도착) — 최종 도착 지점

기능:
- 카카오맵 검색으로 경유지 추가
- 마커 마우스 드래그로 좌표 즉시 갱신
- 카카오 모빌리티 API가 인접 경유지 이동시간·거리 자동 계산
- 일정 카드 드래그&드롭 순서 변경

# 6. UI 라벨·작성 도움말 (사용자가 "이거 뭐예요?" 물으면 정확히)
- "그룹 공통 총 원가" = 차량 + 가이드 합산 (인원 무관)
- "1인 공통 단가" = 그룹 공통 ÷ 인원
- "1인 원가 (성인): 입장권, 식사, 체험 등" = 개인별 원가
- "판매가 (1인)" = VAT 포함 1인 판매가
- "수수료 차감 판매가" = 판매가 × (1 − 수수료율)
- "BEP (손익분기)" = 1인 수익 = 0이 되는 인원수
- "1인 × N명 = 합계" 보조 표시: 매트릭스 셀 클릭/hover로 N명 총 수익 ₩ 확인
- 통합/구분 모드 토글: 인원·일정 입장료를 한 가격으로 처리할지(통합) 연령별로(구분) 처리할지
- 자체모객·자체 온라인·글로벌 OTA 각 채널은 매트릭스 컬럼

# 7. 저장 / 영속 / 인쇄 / Excel
- localStorage 자동 영속 (별도 저장 버튼 불필요)
- 로그아웃해도 입력값 유지
- 헤더 "전체 초기화"로 비움
- PDF/인쇄: 헤더 PDF 또는 Ctrl+P → A4 세로, 헤더·버튼 자동 숨김
- Excel/CSV: 헤더 Excel 버튼 → NO·합계 SUBTOTAL 수식 포함

# 8. PWA / 다크모드 / 접근성
- Android Chrome: 헤더 📲 설치 버튼 → 홈 화면 추가
- iOS Safari: 공유 → 홈 화면 추가 → 추가
- 다크모드: 헤더 🌙/☀️ — localStorage 영속, OS prefers 폴백
- 키보드: Tab 이동·Enter 활성화·:focus-visible 강조
- 색 대비 WCAG AA 통과 (모든 진한색 4.5:1↑)
- 분당 5회 로그인·20회 채팅 rate limit (security.md 준수)

# 9. 오프라인 / Serwist SW
- 한 번 진입한 페이지는 오프라인에서도 로드 가능
- 마지막 입력값은 로컬에 영속이라 오프라인에서도 계산 가능
- 카카오맵·모빌리티는 네트워크 필요

# 10. 인증·보안
- 1차+2차 비밀번호 (총 17자 권장)
- 4지선다 산술 보안 (1자리+1자리)
- HMAC-SHA256 서명 쿠키 (HttpOnly + Secure + SameSite=Lax)
- 24시간 세션 / 분당 5회 로그인 시도 제한

# 11. 응답 범위 (Scope) — 매우 중요
당신은 **투어 패키지 단가 의사결정 빌더의 사용 안내 전용 도우미**입니다. 응답 가능 주제:
✅ 가능
- 도구 사용법 (필드 입력·버튼 위치·화면 전환)
- 견적·BEP·매트릭스·1인 원가·채널 수익 계산 공식·예시
- 차량·가이드·일정·코스 입력 방법
- 카카오맵·모빌리티 API 동작 설명
- PWA 설치·다크모드·인쇄·Excel 내보내기
- localStorage 영속·로그아웃·세션
- 한국 인바운드 투어 도메인의 **일반 운영 상식** (예: VAT 포함 표기, 채널 수수료 통상 범위, 차량 유형별 정원 등 — 단, 정책·법률 판단은 회피)

❌ 불가 (정중히 거부)
- 도구와 무관한 일반 질문 (날씨·뉴스·일반 상식·코딩·요리 등)
- 회사 내부 정책·인사·계약·법률·세무 자문
- 다른 OTA·경쟁사 비교 평가
- 사용자에 대한 개인 정보 수집·저장 요청
- 도덕적·법적으로 부적절한 내용:
  · 성적·폭력적·차별적·혐오·자해 관련
  · 불법 활동 (탈세·뇌물·미신고 노동 등)
  · 사기·과대광고·허위 견적 작성 유도
  · 타인 비방·험담
- 사용자의 잘못 입력을 조롱하거나 비판하기

# 12. 거부 응답 템플릿 (해당 경우 정확히 이 패턴 사용)
도구 무관 질문:
> "죄송합니다. 저는 투어 단가 빌더 사용법 전용 도우미입니다. 견적·BEP·일정·채널·PWA 설치 등 도구 관련 질문이라면 도와드릴게요. 다른 주제는 답변이 어렵습니다."

부도덕·법적 부적절:
> "이 부분은 답변드리기 어려운 내용입니다. 도구 사용법이나 견적 계산 관련해 다시 질문해주시면 친절히 안내해드리겠습니다."

회사 정책·법률·세무:
> "정책·법률·세무 관련 자문은 운영자 또는 전문가에게 직접 문의해주세요. 저는 단가 빌더 화면 사용법만 안내해드릴 수 있습니다."

# 13. 응답 원칙 (모든 답변에 반드시 준수)
1. **친절하고 정중**한 어조 (사용자가 잘못 알아도 비판 금지, 부드럽게 정정).
2. 사용자의 현재 입력 컨텍스트를 활용해 **구체적 수치**로 답.
   - 예: "현재 인원 8명 · 판매가 ₩200,000" 있으면 그 수치로 직접 계산.
3. 마크다운 사용 가능 (**굵게**, * 목록, \`코드\`).
4. 계산 답변엔 **공식 + 대입 수치 + 단계별 결과**를 모두.
5. UI 위치 답변엔 정확한 경로 (예: "헤더 우측 → 🌙 다크모드 버튼", "메인 → 일정 카드 → 일정 추가").
6. 모르거나 확신 없는 답은 추측하지 말고 **"확실치 않습니다"** 명시 + 가능한 정보만 안내.
7. 한국어로만, 2~6문단 이내 간결하게.
8. 수치는 ₩ 표기 + 천단위 콤마 (예: ₩1,200,000).
9. 정치·종교·민감 사회 이슈 언급 회피.
10. 거부 시에도 **친절·정중**, 해결 가능한 다른 방향 제시.`;

type InboundContext = z.infer<typeof BodySchema>['context'];

function makeContextNote(ctx?: InboundContext): string | null {
  if (!ctx) return null;
  const lines: string[] = [];
  if (ctx.packageName) lines.push(`• 패키지명: ${ctx.packageName}`);
  if (ctx.productType) {
    const map: Record<string, string> = {
      'half-day': '반일', 'full-day': '종일', '2d1n': '1박2일',
      '3d2n': '2박3일', '4d3n': '3박4일', '5d4n': '4박5일',
      '6d5n': '5박6일', 'longstay': '장기',
    };
    lines.push(`• 유형: ${map[ctx.productType] ?? ctx.productType}${ctx.nights ? ` (${ctx.nights}박)` : ''}`);
  }
  if (ctx.partyTotal !== undefined && ctx.partyTotal > 0) {
    const detail: string[] = [];
    if (ctx.adult) detail.push(`성인 ${ctx.adult}`);
    if (ctx.youth) detail.push(`청소년 ${ctx.youth}`);
    if (ctx.child) detail.push(`어린이 ${ctx.child}`);
    if (ctx.infant) detail.push(`유아 ${ctx.infant}`);
    lines.push(`• 인원: 총 ${ctx.partyTotal}명${detail.length ? ` (${detail.join(' · ')})` : ''}${ctx.partyTiered ? ' [구분 모드]' : ' [통합 모드]'}`);
  }
  if (ctx.vehiclesCount !== undefined && ctx.vehiclesCount > 0) {
    const kinds = ctx.vehicleKinds && ctx.vehicleKinds.length > 0 ? ` (${ctx.vehicleKinds.join(', ')})` : '';
    lines.push(`• 차량: ${ctx.vehiclesCount}대${kinds}${ctx.totalSeats ? ` · 좌석 ${ctx.totalSeats}석` : ''}`);
  }
  if (ctx.guidesCount !== undefined && ctx.guidesCount > 0) {
    const langs = ctx.guideLanguages && ctx.guideLanguages.length > 0 ? ` (${ctx.guideLanguages.join(', ')})` : '';
    lines.push(`• 가이드: ${ctx.guidesCount}명${langs}`);
  }
  if (ctx.stopsCount !== undefined && ctx.stopsCount > 0) {
    const types = ctx.stopTypes;
    let typeCount = '';
    if (types && types.length > 0) {
      const counts: Record<string, number> = {};
      for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
      const labelMap: Record<string, string> = { departure: '출발', arrival: '도착', waypoint: '경유', sight: '관광', meal: '식사', experience: '체험' };
      const parts = Object.entries(counts).map(([k, v]) => `${labelMap[k] ?? k} ${v}`);
      typeCount = ` (${parts.join(' · ')})`;
    }
    lines.push(`• 일정: ${ctx.stopsCount}곳${typeCount}${ctx.startTime ? ` · 출발 ${ctx.startTime}` : ''}`);
  }
  if (ctx.salePrice !== undefined && ctx.salePrice > 0) {
    lines.push(`• 판매가 (1인): ₩${ctx.salePrice.toLocaleString('ko-KR')}`);
  }
  if (ctx.channelsActive !== undefined && ctx.channelsActive > 0) {
    const names = ctx.channelNames && ctx.channelNames.length > 0 ? ` (${ctx.channelNames.join(', ')})` : '';
    lines.push(`• 활성 채널: ${ctx.channelsActive}개${names}`);
  }
  if (lines.length === 0) return null;
  return `[사용자 현재 입력값 — 답변 시 이 수치를 활용하세요]\n${lines.join('\n')}`;
}

export async function POST(req: NextRequest) {
  // 인증 재검증 (proxy.ts에서 보호하지만 명시 보강)
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ success: false, error: 'auth-not-configured' }, { status: 500 });
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const authOk = await verifyAuthToken(secret, token);
  if (!authOk) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  // rate limit
  const ip = getClientIp(req);
  const rate = checkRate(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { success: false, error: 'rate-limited', retryAfter: rate.retryAfter, mode: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter ?? 60) } },
    );
  }

  // 입력 검증
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'invalid-input', detail: parsed.error.format() }, { status: 422 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid-json' }, { status: 400 });
  }

  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    return NextResponse.json({ success: false, error: 'no-user-message' }, { status: 422 });
  }

  // ANTHROPIC_API_KEY 미설정 → 룰 폴백 (no-silent-fallback.md — mode·provider 명시)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length < 20) {
    return NextResponse.json({
      success: true,
      mode: 'rule-fallback',
      provider: 'rule-engine',
      reason: 'ANTHROPIC_API_KEY 미설정 — 운영자가 .env.local에 추가하면 AI 응답 활성화',
      reply: fallbackReply(lastUserMsg.content),
    });
  }

  // Anthropic SDK 호출 — stream:true 시 SSE 스트리밍, 아니면 일괄 응답
  try {
    const client = new Anthropic({ apiKey });
    const contextNote = makeContextNote(body.context);
    const userMessages = body.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    if (contextNote && userMessages.length > 0) {
      const lastIdx = userMessages.length - 1;
      if (userMessages[lastIdx].role === 'user') {
        userMessages[lastIdx] = {
          ...userMessages[lastIdx],
          content: `${contextNote}\n\n${userMessages[lastIdx].content}`,
        };
      }
    }

    const commonParams = {
      model: 'claude-opus-4-8' as const,
      max_tokens: 1024,
      system: [
        {
          type: 'text' as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: userMessages,
    };

    // ──────── 스트리밍 모드 (SSE) ────────
    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sse = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          try {
            sse('meta', { mode: 'ai', provider: 'claude-opus-4-8' });
            const anthropicStream = await client.messages.stream(commonParams);
            for await (const chunk of anthropicStream) {
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                sse('delta', { text: chunk.delta.text });
              }
            }
            const final = await anthropicStream.finalMessage();
            sse('done', {
              usage: {
                input_tokens: final.usage.input_tokens,
                output_tokens: final.usage.output_tokens,
                cache_read: final.usage.cache_read_input_tokens ?? 0,
                cache_write: final.usage.cache_creation_input_tokens ?? 0,
              },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // 스트리밍 도중 실패 → 룰 폴백 메시지를 한 번에 전송
            sse('meta', { mode: 'rule-fallback', provider: 'rule-engine', reason: `Anthropic 스트림 실패: ${msg.substring(0, 200)}` });
            sse('delta', { text: fallbackReply(lastUserMsg.content) });
            sse('done', {});
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // ──────── 일괄 응답 모드 ────────
    const response = await client.messages.create(commonParams);
    const textBlocks = response.content.filter((b) => b.type === 'text');
    const reply = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');

    return NextResponse.json({
      success: true,
      mode: 'ai',
      provider: 'claude-opus-4-8',
      reply: reply || '응답을 생성하지 못했습니다. 다시 시도해주세요.',
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read: response.usage.cache_read_input_tokens ?? 0,
        cache_write: response.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (err) {
    // API 호출 실패 → 룰 폴백 + 실패 사실 투명 노출 (no-silent-fallback.md)
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      success: true,
      mode: 'rule-fallback',
      provider: 'rule-engine',
      reason: `Anthropic API 호출 실패: ${msg.substring(0, 200)}`,
      reply: fallbackReply(lastUserMsg.content),
    });
  }
}
