// 투어 패키지 단가 의사결정 빌더 (제작기획서 v2.1 S28·S31·S33·S35·S43 통합)
// 글로벌 트렌드 파스텔×진한 팔레트 · 가로 레이아웃 · 인라인 툴팁 · 룰 기반 AI 요약 · 카카오맵
'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ensureKakaoSdk, kakaoPlacesSearch, type PlaceResult } from '@/components/KakaoMap';

// KakaoMap·CampaignSimulator는 초기 화면에 필수 아니므로 dynamic import로 코드 스플릿
// → First Paint·LCP 단축, 카카오 SDK·캠페인 코드는 클라이언트 렌더 시점에 fetch
const KakaoMap = dynamic(
  () => import('@/components/KakaoMap').then((m) => ({ default: m.KakaoMap })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-[#E7E2D5] bg-white text-sm text-[#6B7280]">
        지도 로드 중…
      </div>
    ),
  },
);
const CampaignSimulator = dynamic(
  () => import('@/components/CampaignSimulator').then((m) => ({ default: m.CampaignSimulator })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border bg-white p-6 text-center text-sm text-[#6B7280]">
        캠페인 시뮬레이터 로드 중…
      </div>
    ),
  },
);
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { WelcomeGuide } from '@/components/WelcomeGuide';
import { Chatbot } from '@/components/Chatbot';
import { ShareModal } from '@/components/ShareModal';
import { LibraryModal } from '@/components/LibraryModal';
import { HeaderMenu } from '@/components/HeaderMenu';
import { ValidationBanner } from '@/components/ValidationBanner';
import { analyzeChannels, computeCost, DEFAULT_CHANNELS } from '@/lib/pricing';
import type {
  CalculationInput,
  PaymentType,
  PriceMode,
  SalesChannel,
  StopType,
} from '@/lib/pricing';
import { computeItinerary, formatMin } from '@/lib/itinerary';
import {
  loadState, saveState, clearState, debounce,
  loadLibrary, saveToLibrary, deleteFromLibrary, migrateSlotsToLibrary, LIBRARY_MAX,
  type LibraryItem,
} from '@/lib/storage';

// ──────────────── 상수 ────────────────
const MAX_STOPS = 30;
const MAX_VEHICLES = 10;
const MAX_GUIDES = 10;

const VEHICLE_KINDS = [
  '카니발 9인승',
  '스타리아 11인승',
  '솔라티 15인승',
  '카운티 25인승',
  '에어로타운 28인승',
  '유니버스 35인승',
  '그랜버드 40인승',
  '45인승 버스',
];
const LANGUAGES = [
  '한국어',
  '영어',
  '일본어',
  '중국어(간체)',
  '중국어(번체)',
  '스페인어',
  '프랑스어',
  '독일어',
  '러시아어',
];

// 통일 파스텔×진한 팔레트 — OKLCH 기반 채도·명도 정렬 (Linear/Stripe/Notion 톤 참조)
// 진한색 모두 L≈42 ± 3 / 채도 일관, 파스텔 모두 L≈93 ± 1 / 채도 ≈ 0.04 (어울리는 조합 보장)
// WCAG 2.2 AA — 모든 진한색은 흰 배경 대비 4.5:1 이상 확보 (텍스트·아이콘 사용 가능)
const PAL = {
  bg: '#FAF7F2',       // 따뜻한 크림 (배경)
  surface: '#FFFFFF',
  line: '#E7E2D5',     // 톤 일치 보더
  ink: '#1F2937',
  inkSoft: '#4B5563',
  mute: '#52606D',     // 보조 정보 가독성 (WCAG AA 4.5:1 확보)
  // ── 진한색 (foreground·아이콘·강조) — L 약 42, 채도 일관 ──
  rose:    '#C0306B',  // 브랜드 1차 (rose-600 정렬)
  emerald: '#138060',  // 성공·흑자·도착 (emerald-700 정렬)
  violet:  '#6E37CC',  // 정보·실시간·체험 (violet-700 정렬)
  amber:   '#B27821',  // 출발 (amber-700 정렬)
  orange:  '#C45A33',  // 식사 (orange-700 정렬)
  yellow:  '#A38420',  // 경유 (yellow-700 정렬)
  teal:    '#0F807A',  // 체류 — 출발/도착과 명확히 구분 (teal-700 정렬)
  // ── 파스텔 (배경·칩) — L 약 93, 채도 약 0.04 일관 ──
  rosePale:    '#FBE0E8',
  emeraldPale: '#CDEDDB',
  violetPale:  '#E4DCF6',
  amberPale:   '#F9E9C9',
  orangePale:  '#FCDFCE',
  yellowPale:  '#F7EBC4',
  tealPale:    '#CCEDEB',
} as const;

const STOP_META: Record<StopType, { label: string; color: string; bg: string; hasPrice: boolean }> = {
  departure: { label: '출발', color: PAL.amber, bg: PAL.amberPale, hasPrice: false },
  waypoint: { label: '경유', color: PAL.yellow, bg: PAL.yellowPale, hasPrice: false },
  sight: { label: '관광', color: PAL.rose, bg: PAL.rosePale, hasPrice: true },
  meal: { label: '식사', color: PAL.orange, bg: PAL.orangePale, hasPrice: true },
  experience: { label: '체험', color: PAL.violet, bg: PAL.violetPale, hasPrice: true },
  arrival: { label: '도착', color: PAL.emerald, bg: PAL.emeraldPale, hasPrice: false },
};
const STOP_ORDER: StopType[] = ['departure', 'waypoint', 'sight', 'meal', 'experience', 'arrival'];

// 패키지 유형 한글 라벨 — select가 @media print에서 숨겨지므로 인쇄 견적서에 텍스트로 병기할 때 사용
const PRODUCT_TYPE_LABELS: Record<string, string> = {
  'half-day': '반일 (4시간)',
  'full-day': '1일 풀데이',
  '2d1n': '1박 2일',
  '3d2n': '2박 3일',
  '4d3n': '3박 4일',
  '5d4n': '4박 5일',
  '6d5n': '5박 6일',
  longstay: '롱스테이 (6박+)',
};

// ──────────────── 타입 ────────────────
interface VehicleRow {
  kind: string;
  capacity: number;
  maxBoard: number;
  dailyKrw: number;
  days: number;
}
interface GuideRow {
  language: string;
  dailyKrw: number;
  days: number;
}
interface StopRow {
  stopType: StopType;
  productName: string;
  note: string;
  address: string;
  latitude: number | '';
  longitude: number | '';
  stayMin: number;
  // 이전 카드에서 현재 카드로 오는 이동시간 (분) — 사용자 수동 입력 (빈 값 = 자동 추정)
  travelFromPrevMin: number | '';
  // 이동시간 고정 여부 — true면 카카오 실시간 교통 갱신 대상에서 제외(수동/현재값 유지),
  // false면 좌표 기반 추정 + 카카오 실시간 갱신 반영.
  travelLocked: boolean;
  // 도착시각 고정 (HH:MM) — 값이 있으면 누적 계산을 무시하고 그 시각으로 도착을 못박는다.
  // 이후 카드는 이 시각(+체류)을 기점으로 누적 재시작. 빈 값이면 자동 누적 계산.
  arriveFixed: string;
  // 다년도 패키지의 일자 (1=1일차, 2=2일차, ...). 기본 1.
  dayNumber: number;
  tiered: boolean;
  unifiedPrice: number;
  applyAgeTier: boolean;
  adultPrice: number;
  youthPrice: number;
  childPrice: number;
}
interface ChannelState {
  code: string;
  name: string;
  commission: number;
  cardFee: number;
  enabled: boolean;
}
interface Insight {
  level: 'good' | 'warn' | 'critical' | 'info';
  text: string;
}

const emptyVehicle = (): VehicleRow => ({ kind: '', capacity: 0, maxBoard: 0, dailyKrw: 0, days: 1 });
const emptyGuide = (): GuideRow => ({ language: '', dailyKrw: 0, days: 1 });
const emptyStop = (t: StopType = 'sight', dayNumber = 1): StopRow => ({
  stopType: t,
  productName: '',
  note: '',
  address: '',
  latitude: '',
  longitude: '',
  stayMin: 0,
  travelFromPrevMin: '',
  travelLocked: false,
  arriveFixed: '',
  dayNumber,
  tiered: false,
  unifiedPrice: 0,
  applyAgeTier: true,
  adultPrice: 0,
  youthPrice: 0,
  childPrice: 0,
});

// ── 복원 데이터 정규화 ──
// 공유 URL(외부 조작 가능)·localStorage(확장/수동 조작) 복원 시 NaN·잘못된 타입이 state로 유입돼
// 지도·계산을 깨뜨리는 것을 방지. 배열 요소 형태·숫자 유한성·enum 유효성을 검증한다.
const finiteNum = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const finiteOrEmpty = (v: unknown): number | '' => {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
};
const safeStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
function sanitizeVehicle(v: unknown): VehicleRow {
  const o = (v ?? {}) as Record<string, unknown>;
  return { kind: safeStr(o.kind, 60), capacity: finiteNum(o.capacity), maxBoard: finiteNum(o.maxBoard), dailyKrw: finiteNum(o.dailyKrw), days: finiteNum(o.days, 1) };
}
function sanitizeGuide(g: unknown): GuideRow {
  const o = (g ?? {}) as Record<string, unknown>;
  return { language: safeStr(o.language, 40), dailyKrw: finiteNum(o.dailyKrw), days: finiteNum(o.days, 1) };
}
function sanitizeStop(s: unknown): StopRow {
  const o = (s ?? {}) as Record<string, unknown>;
  const stopType = (typeof o.stopType === 'string' && o.stopType in STOP_META ? o.stopType : 'sight') as StopType;
  return {
    stopType,
    productName: safeStr(o.productName, 200),
    note: safeStr(o.note, 500),
    address: safeStr(o.address, 200),
    latitude: finiteOrEmpty(o.latitude),
    longitude: finiteOrEmpty(o.longitude),
    stayMin: finiteNum(o.stayMin),
    travelFromPrevMin: finiteOrEmpty(o.travelFromPrevMin),
    travelLocked: o.travelLocked === true,
    arriveFixed: parseHHMM(safeStr(o.arriveFixed, 5)) !== null ? safeStr(o.arriveFixed, 5) : '',
    dayNumber: Math.max(1, finiteNum(o.dayNumber, 1)),
    tiered: o.tiered === true,
    unifiedPrice: finiteNum(o.unifiedPrice),
    applyAgeTier: o.applyAgeTier !== false,
    adultPrice: finiteNum(o.adultPrice),
    youthPrice: finiteNum(o.youthPrice),
    childPrice: finiteNum(o.childPrice),
  };
}
function sanitizeChannel(c: unknown, idx = 0): ChannelState {
  const o = (c ?? {}) as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' && o.code ? o.code.slice(0, 40) : `ch-${idx}`,
    name: safeStr(o.name, 40) || '채널',
    commission: finiteNum(o.commission),
    cardFee: finiteNum(o.cardFee),
    enabled: o.enabled !== false,
  };
}

const DEFAULT_CHANNEL_STATE: ChannelState[] = DEFAULT_CHANNELS.map((c) => ({
  code: c.code,
  name: c.name,
  commission: c.commissionRate,
  cardFee: c.cardFeeRate,
  enabled: true,
}));

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
// 차종 이름에서 "N인승" 숫자 추출 — 매칭 실패 시 null
// 예: "카니발 9인승" → 9, "45인승 버스" → 45, "그랜버드 40인승" → 40
const parseSeats = (kind: string): number | null => {
  const m = kind.match(/(\d+)\s*인승/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
};
const fmtTime = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
// "HH:MM" → 하루 기준 분(0~1439). 형식·범위가 유효하지 않으면 null. 도착시각 고정 파싱용.
const parseHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
};
// 원형 숫자 ① ~ ㉚ (1~30). 30 초과 시 일반 숫자.
const CIRCLE_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚';
const circleNum = (n: number): string => (n >= 1 && n <= CIRCLE_NUMS.length ? CIRCLE_NUMS[n - 1] : `${n}.`);

// ──────────────── 페이지 ────────────────
export default function BuilderPage() {
  // 도움말(WelcomeGuide) 강제 재오픈 상태 — 헤더 '?' 버튼 클릭 시 토글
  const [forceGuide, setForceGuide] = useState(false);
  // 패키지 상품명 — 견적 전체를 식별하는 최상위 이름
  const [packageName, setPackageName] = useState('');
  // 패키지 유형 + 박수 — 다년도 패키지 지원
  // '' = 미선택(사용자가 직접 선택). calc 경계에서 full-day로 좁힘.
  const [productType, setProductType] = useState<'' | 'half-day' | 'full-day' | '2d1n' | '3d2n' | '4d3n' | '5d4n' | '6d5n' | 'longstay'>('');
  const [nights, setNights] = useState(0);
  // 인원
  const [partyTiered, setPartyTiered] = useState(false);
  const [totalPax, setTotalPax] = useState(0);
  const [adult, setAdult] = useState(0);
  const [youth, setYouth] = useState(0);
  const [child, setChild] = useState(0);
  const [infant, setInfant] = useState(0);
  // 차량·가이드
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [guides, setGuides] = useState<GuideRow[]>([]);
  // 일정
  const [stops, setStops] = useState<StopRow[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // 투어 시작 시각 (HH:MM) — 동선별 도착·출발 시각 누적 계산 기준
  const [startTime, setStartTime] = useState('08:00');
  // 판매가
  const [salePrice, setSalePrice] = useState(0);
  // 채널
  const [channels, setChannels] = useState<ChannelState[]>(DEFAULT_CHANNEL_STATE);
  // 지도 표시 형태 — wide(가로 길게) / square(정사각형). 사용자 토글.
  const [mapShape, setMapShape] = useState<'wide' | 'square'>('wide');
  // 카카오 모빌리티 갱신 상태
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [kakaoMsg, setKakaoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // localStorage 자동 저장·복원 상태
  const [storageMsg, setStorageMsg] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // 자동 저장 상태 — 'idle' | 'dirty' | 'saved' (헤더 배지 표시용)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'dirty' | 'saved'>('idle');
  // 챗봇 글로벌 토글 신호 (Ctrl+K 단축키에서 사용)
  const [chatbotSignal, setChatbotSignal] = useState(0);
  // 견적 보관함 — 이름 붙여 다수 저장/불러오기 (구 슬롯 3개 대체)
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  // 공유 모달
  const [showShareModal, setShowShareModal] = useState(false);

  // 인쇄용 지도 이미지(html2canvas 캡처 결과) + 캡처 대상 ref
  const [printMapSrc, setPrintMapSrc] = useState<string | null>(null);
  const mapCaptureRef = useRef<HTMLDivElement>(null);

  // PDF·인쇄 — 카카오 지도 타일은 print 캡처가 보장되지 않으므로, html2canvas로 미리
  // 이미지를 떠서 인쇄용 <img>에 넣은 뒤 window.print() 한다 (라이브 지도는 인쇄 시 숨김).
  const handlePrint = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const el = mapCaptureRef.current;
    if (el) {
      try {
        const html2canvas = (await import('html2canvas-pro')).default;
        // 카카오 지도 타일(daumcdn.net)은 CORS 헤더가 없어 직접 캡처 불가. html2canvas의 onclone에서
        // 캡처용 복제 DOM의 타일 img src만 same-origin 프록시(/api/img-proxy)로 교체하면 CORS 없이
        // 캡처된다. 라이브 지도(원본 DOM)는 건드리지 않으므로 화면 영향 없음.
        const canvas = await html2canvas(el, {
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          imageTimeout: 20000,
          onclone: (clonedDoc) => {
            const origin = window.location.origin;
            clonedDoc.querySelectorAll('img').forEach((img) => {
              const s = img.getAttribute('src') || '';
              if (/(?:daumcdn\.net|kakao\.com)/.test(s) && !s.startsWith(origin)) {
                img.setAttribute('crossorigin', 'anonymous');
                img.setAttribute('src', `${origin}/api/img-proxy?url=${encodeURIComponent(s)}`);
              }
            });
          },
        });
        setPrintMapSrc(canvas.toDataURL('image/png'));
        // 인쇄용 <img>가 DOM에 반영될 시간을 준다
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.warn('[print] 지도 캡처 실패 — 지도 없이 인쇄:', err);
        setPrintMapSrc(null);
      }
    }
    window.print();
  }, []);

  // URL fragment(#q=...) 복원 — 공유 링크 진입 시 우선 적용 (localStorage보다 우선)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#q=')) return;
    try {
      const encoded = hash.slice(3).replace(/-/g, '+').replace(/_/g, '/');
      const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
      const bin = atob(encoded + pad);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const data = JSON.parse(json);
      if (typeof data.packageName === 'string') setPackageName(data.packageName);
      if (typeof data.partyTiered === 'boolean') setPartyTiered(data.partyTiered);
      if (typeof data.totalPax === 'number') setTotalPax(data.totalPax);
      if (typeof data.adult === 'number') setAdult(data.adult);
      if (typeof data.youth === 'number') setYouth(data.youth);
      if (typeof data.child === 'number') setChild(data.child);
      if (typeof data.infant === 'number') setInfant(data.infant);
      if (Array.isArray(data.vehicles)) setVehicles(data.vehicles.map(sanitizeVehicle));
      if (Array.isArray(data.guides)) setGuides(data.guides.map(sanitizeGuide));
      if (Array.isArray(data.stops)) setStops(data.stops.map(sanitizeStop));
      if (typeof data.startTime === 'string') setStartTime(data.startTime);
      if (typeof data.salePrice === 'number') setSalePrice(data.salePrice);
      if (Array.isArray(data.channels) && data.channels.length > 0) setChannels(data.channels.map(sanitizeChannel));
      setStorageMsg('✓ 공유 링크에서 입력값 복원됨');
      setTimeout(() => setStorageMsg(null), 3000);
      // fragment 클리어 (이중 적용 방지)
      window.history.replaceState(null, '', window.location.pathname);
    } catch (err) {
      console.warn('[share] URL fragment 복원 실패:', err);
    }
  }, []);

  // 마운트 시 localStorage 복원 (1회)
  useEffect(() => {
    type PersistedShape = {
      packageName?: string;
      partyTiered?: boolean;
      totalPax?: number;
      adult?: number;
      youth?: number;
      child?: number;
      infant?: number;
      vehicles?: VehicleRow[];
      guides?: GuideRow[];
      stops?: StopRow[];
      startTime?: string;
      salePrice?: number;
      channels?: ChannelState[];
      productType?: string;
      nights?: number;
    };
    const saved = loadState<PersistedShape>();
    if (saved) {
      if (typeof saved.packageName === 'string') setPackageName(saved.packageName);
      if (typeof saved.partyTiered === 'boolean') setPartyTiered(saved.partyTiered);
      if (typeof saved.totalPax === 'number') setTotalPax(saved.totalPax);
      if (typeof saved.adult === 'number') setAdult(saved.adult);
      if (typeof saved.youth === 'number') setYouth(saved.youth);
      if (typeof saved.child === 'number') setChild(saved.child);
      if (typeof saved.infant === 'number') setInfant(saved.infant);
      if (Array.isArray(saved.vehicles)) setVehicles(saved.vehicles.map(sanitizeVehicle));
      if (Array.isArray(saved.guides)) setGuides(saved.guides.map(sanitizeGuide));
      if (Array.isArray(saved.stops)) setStops(saved.stops.map(sanitizeStop));
      if (typeof saved.startTime === 'string') setStartTime(saved.startTime);
      if (typeof saved.salePrice === 'number') setSalePrice(saved.salePrice);
      if (Array.isArray(saved.channels) && saved.channels.length > 0) setChannels(saved.channels.map(sanitizeChannel));
      if (typeof saved.productType === 'string') setProductType(saved.productType as typeof productType);
      if (typeof saved.nights === 'number') setNights(saved.nights);
      setStorageMsg('✓ 이전 입력값 복원됨');
      // 3초 후 메시지 자동 해제
      const t = setTimeout(() => setStorageMsg(null), 3000);
      return () => clearTimeout(t);
    }
    setHydrated(true);
  }, []);

  // hydrate 완료 표시 (복원 분기 후)
  useEffect(() => {
    if (!hydrated) setHydrated(true);
  }, [hydrated]);

  // 구 슬롯(slot-0/1/2) → 보관함 1회 마이그레이션. 잔존 데이터 손실 없이 이전.
  useEffect(() => {
    const n = migrateSlotsToLibrary();
    if (n > 0) {
      setLibraryItems(loadLibrary());
      setStorageMsg(`✓ 이전 슬롯 ${n}건을 보관함으로 옮겼습니다 (헤더 ⋯ 메뉴 → 견적 보관함)`);
      const t = setTimeout(() => setStorageMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, []);

  // 디바운스된 저장 함수 (입력 변화 후 800ms 후 1회 저장)
  const debouncedSave = useMemo(
    () =>
      debounce((payload: unknown) => {
        saveState(payload);
      }, 800),
    [],
  );

  // 파생
  const partyTotal = partyTiered ? adult + youth + child + infant : totalPax;
  const totalSeats = vehicles.reduce((s, v) => s + v.maxBoard, 0);
  const seatGap = totalSeats - partyTotal;
  const vehicleTotal = vehicles.reduce((s, v) => s + v.dailyKrw * v.days, 0);
  const guideTotal = guides.reduce((s, g) => s + g.dailyKrw * g.days, 0);

  const tiers = partyTiered
    ? {
        adult: { count: adult, multiplier: 1.0 },
        youth: { count: youth, multiplier: 0.7 },
        child: { count: child, multiplier: 0.5 },
        infant: { count: infant, multiplier: 0.0 },
      }
    : { adult: { count: totalPax, multiplier: 1.0 } };

  const input: CalculationInput = useMemo(
    () => ({
      productType: productType === '' ? 'full-day' : productType, // 미선택('')이면 계산은 full-day로 진행(표시는 미선택 유지)
      nights: nights > 0 ? nights : undefined,
      productName: packageName || '단가 빌더',
      party: { mode: partyTiered ? 'detailed' : 'simple', tiers },
      days: [
        {
          dayNumber: 1,
          items: stops.map((s, i) => ({
            categorySlug: `item-${i}`,
            stopType: s.stopType,
            productName: s.productName,
            address: s.address || undefined,
            latitude: typeof s.latitude === 'number' ? s.latitude : undefined,
            longitude: typeof s.longitude === 'number' ? s.longitude : undefined,
            recommendedStayMin: s.stayMin,
            priceMode: (s.tiered ? 'tiered' : 'unified') as PriceMode,
            unitPriceKrw: s.unifiedPrice,
            pricesByTier: s.tiered
              ? { adult: s.adultPrice, youth: s.youthPrice, child: s.childPrice, infant: 0 }
              : undefined,
            applyAgeTier: s.applyAgeTier,
            paymentType: (STOP_META[s.stopType].hasPrice ? 'included' : 'free') as PaymentType,
          })),
        },
      ],
      partyShared: [
        { categorySlug: 'vehicle', totalKrw: vehicleTotal },
        { categorySlug: 'guide', totalKrw: guideTotal },
      ],
      season: { multiplier: 1.0, appliesTo: [] },
      margin: { net: 0.12, retail: 0.35 },
      // 모든 입력 금액은 VAT 포함 기준 — 별도 VAT 곱셈 안 함
      vatRate: 0,
      exchangeRate: { krwToUsd: 0.00072 },
    }),
    [partyTiered, tiers, stops, vehicleTotal, guideTotal, productType, nights, packageName],
  );

  const cost = useMemo(() => computeCost(input), [input]);

  // 현재 폼 → 저장 payload (자동저장·보관함 저장 공통). productType·nights 포함(미선택 보존).
  const buildPayload = useCallback(() => ({
    packageName, productType, nights,
    partyTiered, totalPax, adult, youth, child, infant,
    vehicles, guides, stops, startTime, salePrice, channels,
  }), [packageName, productType, nights, partyTiered, totalPax, adult, youth, child, infant, vehicles, guides, stops, startTime, salePrice, channels]);

  // 자동 저장 — hydrate 완료 후 상태 변경마다 디바운스 호출 + saveStatus 가시화 (현재 작업본 1개)
  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus('dirty');
    const payload = buildPayload();
    debouncedSave(payload);
    // 즉시 저장(디바운스 없이) — 항상 최신 작업본 보존
    saveState(payload);
    // 디바운스 800ms + 약간의 여유 — 저장 완료 추정 후 'saved'로 전환
    const t = setTimeout(() => setSaveStatus('saved'), 1000);
    return () => clearTimeout(t);
  }, [hydrated, debouncedSave, buildPayload]);

  // 저장 payload → 폼 setter 일괄 적용 (보관함 불러오기 공통). sanitize 경유로 손상 데이터 방어.
  const applyPayload = (d: Record<string, unknown>) => {
    setPackageName(typeof d.packageName === 'string' ? d.packageName : '');
    setProductType(typeof d.productType === 'string' ? (d.productType as typeof productType) : '');
    setNights(typeof d.nights === 'number' ? d.nights : 0);
    setPartyTiered(typeof d.partyTiered === 'boolean' ? d.partyTiered : false);
    setTotalPax(typeof d.totalPax === 'number' ? d.totalPax : 0);
    setAdult(typeof d.adult === 'number' ? d.adult : 0);
    setYouth(typeof d.youth === 'number' ? d.youth : 0);
    setChild(typeof d.child === 'number' ? d.child : 0);
    setInfant(typeof d.infant === 'number' ? d.infant : 0);
    setVehicles(Array.isArray(d.vehicles) ? d.vehicles.map(sanitizeVehicle) : []);
    setGuides(Array.isArray(d.guides) ? d.guides.map(sanitizeGuide) : []);
    setStops(Array.isArray(d.stops) ? d.stops.map(sanitizeStop) : []);
    setStartTime(typeof d.startTime === 'string' ? d.startTime : '08:00');
    setSalePrice(typeof d.salePrice === 'number' ? d.salePrice : 0);
    setChannels(Array.isArray(d.channels) && d.channels.length > 0 ? d.channels.map(sanitizeChannel) : DEFAULT_CHANNEL_STATE);
  };

  // 보관함 — 현재 견적을 이름 붙여 저장
  const handleSaveToLibrary = (name: string) => {
    const saved = saveToLibrary(name, buildPayload());
    if (saved) {
      setLibraryItems(loadLibrary());
      setStorageMsg(`✓ "${saved.name}" 보관함에 저장됨`);
    } else {
      setStorageMsg(`⚠ 저장 실패 — 보관함이 가득 찼습니다 (최대 ${LIBRARY_MAX}건). 불필요한 견적을 삭제하세요.`);
    }
    setTimeout(() => setStorageMsg(null), 3000);
  };

  // 보관함 — 불러오기 (현재 작업 덮어쓰기, confirm)
  const handleLoadFromLibrary = (item: LibraryItem) => {
    if (typeof window !== 'undefined' && !window.confirm(`"${item.name}"을(를) 불러오면 현재 작업이 덮어쓰여집니다. 계속할까요?`)) return;
    applyPayload((item.data ?? {}) as Record<string, unknown>);
    setShowLibraryModal(false);
    setStorageMsg(`✓ "${item.name}" 불러옴`);
    setTimeout(() => setStorageMsg(null), 3000);
  };

  // 보관함 — 삭제
  const handleDeleteFromLibrary = (id: string) => {
    deleteFromLibrary(id);
    setLibraryItems(loadLibrary());
  };

  // 보관함 열기 (목록 새로고침 후 모달 오픈)
  const openLibrary = () => {
    setLibraryItems(loadLibrary());
    setShowLibraryModal(true);
  };

  // 새 견적 — 폼을 빈 양식으로 초기화 (보관함 불러오기 전 새로 작성). applyPayload({}) = 모든 기본값.
  const handleNewQuote = () => {
    if (typeof window !== 'undefined' && !window.confirm('현재 작업을 비우고 새 견적을 빈 양식으로 시작할까요? (저장하지 않은 변경은 사라집니다)')) return;
    applyPayload({});
    setShowLibraryModal(false);
    setStorageMsg('✓ 새 견적 — 빈 양식으로 시작합니다');
    setTimeout(() => setStorageMsg(null), 3000);
  };

  // 글로벌 키보드 단축키 — Ctrl+K 챗봇 토글 · Ctrl+/ 저장 알림 · ? 도움말 · Esc 모달 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 중인 input/textarea에서는 단축키 무시
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setChatbotSignal((s) => s + 1);
      } else if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setStorageMsg('✓ 자동 저장은 항상 활성 — 800ms 후 자동 반영');
        setTimeout(() => setStorageMsg(null), 2500);
      } else if (!isTyping && e.key === '?') {
        e.preventDefault();
        setForceGuide((s) => !s);
      } else if (e.key === 'Escape') {
        if (showShareModal) setShowShareModal(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showShareModal]);

  const activeChannels: SalesChannel[] = useMemo(
    () =>
      channels
        .filter((c) => c.enabled)
        .map((c) => ({
          code: c.code,
          name: c.name,
          commissionRate: c.commission,
          cardFeeRate: c.cardFee,
          fixedFeeKrw: 0,
        })),
    [channels],
  );

  const channelAnalysis = useMemo(
    () =>
      analyzeChannels({
        perPersonItems: cost.byTier.adult?.perPersonItems ?? 0,
        partySharedTotal: cost.partySharedTotal,
        salePrice,
        channels: activeChannels.length > 0 ? activeChannels : DEFAULT_CHANNELS,
        includeBepRows: true, // 채널별 BEP 인원을 매트릭스에 별도 행으로 자동 삽입·강조
      }),
    [cost, salePrice, activeChannels],
  );

  // 각 채널별 "첫 흑자 도달 인원" — 매트릭스 cell 강조용 (BEP와 동일하지만 표시 위치 명확)
  const firstProfitablePaxByChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of channelAnalysis.matrix) {
      for (const cell of row.cells) {
        if (cell.profitRate >= 0 && !map.has(cell.channelCode)) {
          map.set(cell.channelCode, row.pax);
        }
      }
    }
    return map;
  }, [channelAnalysis]);

  const itinerary = useMemo(
    () =>
      computeItinerary(
        stops.map((s) => ({
          productName: s.productName,
          latitude: typeof s.latitude === 'number' ? s.latitude : undefined,
          longitude: typeof s.longitude === 'number' ? s.longitude : undefined,
          recommendedStayMin: s.stayMin,
          travelFromPrevMin: typeof s.travelFromPrevMin === 'number' ? s.travelFromPrevMin : undefined,
        })),
      ),
    [stops],
  );

  // 총 일자 수 — 박수(nights) + 1, 최소 1
  const totalDays = useMemo(() => Math.max(1, nights + 1), [nights]);

  // 일자별 도착·출발 시각 누적 계산. 일자 바뀔 때 startTime으로 reset, 이동시간 0.
  // 도착시각 고정(arriveFixed)이 있는 카드는 그 시각으로 못박고, 이후 카드는 거기서 누적 재시작.
  const scheduleTimes = useMemo(() => {
    if (stops.length === 0) return [];
    const [hh, mm] = startTime.split(':').map((s) => Number(s) || 0);
    const dayStartMin = (hh % 24) * 60 + (mm % 60);
    let cursor = dayStartMin;
    let prevDay = 0;
    return stops.map((s, i) => {
      const curDay = s.dayNumber ?? 1;
      const dayChanged = curDay !== prevDay;
      if (dayChanged) {
        cursor = dayStartMin; // 일자가 바뀌면 시각 reset
      }
      const moveMin = dayChanged || i === 0 ? 0 : itinerary.legs[i - 1]?.minutes ?? 0;
      // 도착시각 고정 우선 — 유효한 HH:MM이면 누적값을 무시하고 그 시각으로 도착 확정.
      const fixedArrive = parseHHMM(s.arriveFixed);
      const fixed = fixedArrive !== null;
      const arrive = fixed ? fixedArrive : cursor + moveMin;
      const depart = arrive + (s.stayMin || 0);
      cursor = depart;
      prevDay = curDay;
      return { arrive, depart, day: curDay, fixed };
    });
  }, [stops, startTime, itinerary]);

  // AI 인사이트 (룰 기반)
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    if (partyTotal === 0) {
      out.push({ level: 'info', text: '인원을 입력하면 채널별 손익분기를 자동 계산합니다.' });
    }
    if (stops.length === 0) {
      out.push({ level: 'info', text: '관광 일정을 추가하면 동선·체류시간·이동시간이 자동 산출됩니다.' });
    }
    if (vehicles.length > 0 && partyTotal > 0) {
      if (totalSeats < partyTotal) {
        out.push({
          level: 'critical',
          text: `차량 좌석 ${partyTotal - totalSeats}석 부족 — 차량 추가 또는 인원 조정 필요`,
        });
      } else {
        out.push({
          level: 'good',
          text: `좌석 ${totalSeats}석 / 인원 ${partyTotal}명 · 여유 ${seatGap}석`,
        });
      }
    }
    if (salePrice > 0 && cost.costPerAdult > 0) {
      const bep = channelAnalysis.bep.bestMin;
      if (bep === null) {
        out.push({
          level: 'critical',
          text: '모든 채널에서 손익분기 도달 불가 — 판매가 인상 또는 1인 원가 절감 필요',
        });
      } else if (partyTotal > 0) {
        if (partyTotal >= bep) {
          out.push({
            level: 'good',
            text: `현재 ${partyTotal}명 · 최선 채널 BEP ${bep}명 충족 — 수익 발생 구간 진입`,
          });
        } else {
          out.push({
            level: 'warn',
            text: `현재 ${partyTotal}명 · BEP ${bep}명까지 ${bep - partyTotal}명 추가 필요`,
          });
        }
      }
    }
    if (itinerary.totalMin > 0) {
      const h = itinerary.totalMin / 60;
      if (h > 12)
        out.push({ level: 'warn', text: `전체 일정 ${h.toFixed(1)}시간 — 풀데이 한도 초과, 1박 추가 권장` });
      else if (h > 0 && partyTotal > 0)
        out.push({ level: 'info', text: `전체 일정 ${h.toFixed(1)}시간 (체류시간 ${formatMin(itinerary.totalStayMin)} + 이동시간 ${formatMin(itinerary.totalTravelMin)})` });
    }
    const reached = channelAnalysis.bep.byChannel.filter((b) => b.breakEvenN !== null);
    if (reached.length >= 2 && salePrice > 0) {
      const best = reached.reduce((a, b) => (a.breakEvenN! < b.breakEvenN! ? a : b));
      const worst = reached.reduce((a, b) => (a.breakEvenN! > b.breakEvenN! ? a : b));
      const bn = channels.find((c) => c.code === best.channelCode)?.name ?? best.channelCode;
      const wn = channels.find((c) => c.code === worst.channelCode)?.name ?? worst.channelCode;
      out.push({
        level: 'info',
        text: `채널 우위 — ${bn} BEP ${best.breakEvenN}명 · ${wn} BEP ${worst.breakEvenN}명 (차이 ${worst.breakEvenN! - best.breakEvenN!}명)`,
      });
    }
    return out;
  }, [partyTotal, stops.length, vehicles.length, totalSeats, seatGap, salePrice, cost.costPerAdult, channelAnalysis, channels, itinerary]);

  // ──────────────── 핸들러 ────────────────
  const patchStop = (i: number, p: Partial<StopRow>) =>
    setStops((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const removeStop = (i: number) => setStops((rs) => rs.filter((_, j) => j !== i));
  const addStop = (t: StopType = 'sight', dayNumber = 1) =>
    setStops((rs) => (rs.length >= MAX_STOPS ? rs : [...rs, emptyStop(t, dayNumber)]));
  const resetStops = () => {
    if (stops.length === 0) return;
    if (confirm(`일정 ${stops.length}개를 모두 비우시겠습니까?`)) setStops([]);
  };
  const reorderStops = (from: number, to: number) => {
    if (from === to) return;
    setStops((rs) => {
      if (from < 0 || from >= rs.length || to < 0 || to >= rs.length) return rs;
      const cp = [...rs];
      const [removed] = cp.splice(from, 1);
      cp.splice(to, 0, removed);
      return cp;
    });
  };
  const moveStop = (i: number, dir: -1 | 1) =>
    setStops((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const cp = [...rs];
      [cp[i], cp[j]] = [cp[j], cp[i]];
      return cp;
    });
  // 차량 패치 — invariant: 실 탑승 최대 인원(maxBoard) ≤ 최대 탑승 인원(capacity)
  // 사용자가 maxBoard 를 capacity 초과로 입력하거나, capacity 를 maxBoard 미만으로 줄이면 자동 클램프
  const patchVehicle = (i: number, p: Partial<VehicleRow>) =>
    setVehicles((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...p };
        if (next.capacity > 0 && next.maxBoard > next.capacity) {
          next.maxBoard = next.capacity;
        }
        return next;
      }),
    );
  const patchGuide = (i: number, p: Partial<GuideRow>) =>
    setGuides((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const patchChannel = (code: string, p: Partial<ChannelState>) =>
    setChannels((rs) => rs.map((c) => (c.code === code ? { ...c, ...p } : c)));
  // 신규 채널 추가 — 사용자 정의 이름·수수료·카드%로 매트릭스 확장
  const addChannel = () => {
    if (channels.length >= 10) return; // 상한
    const code = `custom-${Date.now()}`;
    setChannels((cs) => [
      ...cs,
      { code, name: `신규 채널 ${cs.length + 1}`, commission: 0, cardFee: 0, enabled: true },
    ]);
  };
  // 채널 삭제 — 최소 1개 유지
  const removeChannel = (code: string) => {
    if (channels.length <= 1) return;
    setChannels((cs) => cs.filter((c) => c.code !== code));
  };

  // Excel/CSV 내보내기 — 일정 요약을 SUBTOTAL 수식 포함해 다운로드.
  // NO 열: =SUBTOTAL(103,$B$2:B2) (필터링 시에도 연번 자동), 합계 행: =SUBTOTAL(9,H2:H{lastRow})
  const exportToExcel = () => {
    if (stops.length === 0) {
      alert('일정 카드를 먼저 추가하세요.');
      return;
    }
    // CSV (Excel 호환). UTF-8 BOM + 따옴표 escape + Formula Injection 방어.
    const escape = (v: string | number) => {
      let s = String(v);
      // CSV Formula Injection 방어 — 사용자 자유입력 문자열이 수식 트리거(= + - @ \t \r)로 시작하면
      // 앞에 작은따옴표를 붙여 텍스트로 강제. 단, 우리가 의도적으로 생성한 =SUBTOTAL 수식과 숫자(number)는 제외.
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !s.startsWith('=SUBTOTAL(')) {
        s = `'${s}`;
      }
      s = s.replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['NO', 'Day', '유형', '상품명', '비고', '주소', '도착', '체류시간(분)', '출발', '이동(km)', '이동시간(분)', '1인 가격'];
    const rows: (string | number)[][] = stops.map((s, i) => {
      const meta = STOP_META[s.stopType];
      const time = scheduleTimes[i];
      const leg = i > 0 ? itinerary.legs[i - 1] : null;
      const priceVal = !meta.hasPrice ? 0 : s.tiered ? (s.adultPrice || 0) : (s.unifiedPrice || 0);
      const excelRow = i + 2; // 1-based + 헤더
      return [
        `=SUBTOTAL(103,$B$2:B${excelRow})`,
        s.dayNumber ?? 1,
        meta.label,
        s.productName || '',
        s.note || '',
        s.address || '',
        time ? fmtTime(time.arrive) : '',
        s.stayMin || 0,
        time && s.stayMin > 0 ? fmtTime(time.depart) : '',
        leg && leg.km !== null ? Number(leg.km.toFixed(1)) : 0,
        leg && leg.minutes !== null ? Math.round(leg.minutes) : 0,
        priceVal,
      ];
    });
    const lastRow = stops.length + 1; // 1-based 헤더 포함
    const sumRow: (string | number)[] = [
      '합계',
      '',
      '',
      packageName || '(상품명 미입력)',
      '',
      '',
      '',
      `=SUBTOTAL(9,H2:H${lastRow})`,
      '',
      `=SUBTOTAL(9,J2:J${lastRow})`,
      `=SUBTOTAL(9,K2:K${lastRow})`,
      `=SUBTOTAL(9,L2:L${lastRow})`,
    ];

    const allRows = [headers, ...rows, sumRow];
    const csv = '﻿' + allRows.map((r) => r.map((c) => escape(c)).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (packageName || '투어패키지').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    a.href = url;
    a.download = `${safeName}-일정.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 카카오 모빌리티 API로 실시간 차량 이동시간 가져와 모든 leg.travelFromPrevMin 일괄 갱신
  const updateTravelFromKakao = async () => {
    setKakaoLoading(true);
    setKakaoMsg(null);
    try {
      // 좌표가 있는 인접 leg만 호출 대상. 단, 고정(travelLocked) 또는 도착시각 고정(arriveFixed) 카드는 제외.
      const targets: { idx: number; payload: { originLat: number; originLng: number; destLat: number; destLng: number } }[] = [];
      let lockedSkipped = 0;
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (
          typeof a.latitude === 'number' && typeof a.longitude === 'number' &&
          typeof b.latitude === 'number' && typeof b.longitude === 'number'
        ) {
          // 고정된 이동시간·도착시각은 실시간 교통 갱신에서 보호 (덮어쓰지 않음)
          if (b.travelLocked || parseHHMM(b.arriveFixed) !== null) {
            lockedSkipped++;
            continue;
          }
          targets.push({
            idx: i,
            payload: {
              originLat: a.latitude,
              originLng: a.longitude,
              destLat: b.latitude,
              destLng: b.longitude,
            },
          });
        }
      }
      if (targets.length === 0) {
        setKakaoMsg({
          ok: false,
          text: lockedSkipped > 0
            ? `실시간 갱신 대상이 없습니다 — 좌표 있는 카드 ${lockedSkipped}건이 모두 고정 상태입니다 (고정 해제 후 시도)`
            : '좌표가 있는 인접 카드가 없습니다 — 일정에 위도·경도 입력 후 시도',
        });
        setKakaoLoading(false);
        return;
      }
      const res = await fetch('/api/route-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs: targets.map((t) => t.payload) }),
      });
      const json = await res.json();
      if (!json.ok) {
        setKakaoMsg({ ok: false, text: json.error || `HTTP ${res.status}` });
        setKakaoLoading(false);
        return;
      }
      // 응답을 stops 에 일괄 적용
      setStops((rs) => {
        const cp = [...rs];
        targets.forEach((t, i) => {
          const r = json.results[i];
          if (r && typeof r === 'object' && 'minutes' in r) {
            cp[t.idx] = { ...cp[t.idx], travelFromPrevMin: r.minutes };
          }
        });
        return cp;
      });
      const s = json.summary ?? { succeeded: 0, failed: 0, total: targets.length };
      setKakaoMsg({
        ok: s.failed === 0,
        text: `카카오 모빌리티 갱신 완료 — 성공 ${s.succeeded}/${s.total}${s.failed > 0 ? ` (실패 ${s.failed}건, 실패한 leg는 자동 추정값 유지)` : ''}${lockedSkipped > 0 ? ` · 고정 ${lockedSkipped}건 제외` : ''}`,
      });
    } catch (e) {
      setKakaoMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setKakaoLoading(false);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: PAL.bg, color: PAL.ink }}>
      <header className="sticky top-0 z-10 border-b backdrop-blur" style={{ borderColor: PAL.line, backgroundColor: 'rgba(255,255,255,0.85)' }}>
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4 sm:py-3 lg:px-6">
          <div className="min-w-0 flex-1">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider" style={{ backgroundColor: PAL.emeraldPale, color: PAL.emerald }}>
              한국 인바운드 · 의사결정 빌더
            </span>
            <h1 className="truncate text-base font-bold tracking-tight sm:mt-1 sm:text-xl">
              투어 <span style={{ color: PAL.rose }}>단가 빌더</span>
              <span className="ml-2 hidden text-xs font-normal sm:inline" style={{ color: PAL.mute }}>
                v2.1 엔진 · 글로벌 톤
              </span>
            </h1>
          </div>
          <div className="relative flex shrink-0 items-center gap-1.5 text-xs sm:gap-2" style={{ color: PAL.inkSoft }}>
            {/* 미니 통계 — xl 이상에서만 (1280px+) */}
            <div className="hidden xl:flex items-center gap-2">
              <Stat mini label="인원" value={`${partyTotal}명`} />
              <Stat mini label="일정" value={`${stops.length}/${MAX_STOPS}`} />
              <Stat mini label="좌석" value={`${totalSeats}석`} />
            </div>
            {/* 자동 저장 상태 배지 — lg 이상 (1024px+) */}
            <span
              className="hidden lg:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider no-print"
              style={{
                backgroundColor: saveStatus === 'saved' ? PAL.emeraldPale : saveStatus === 'dirty' ? PAL.amberPale : PAL.line,
                color: saveStatus === 'saved' ? PAL.emerald : saveStatus === 'dirty' ? PAL.amber : PAL.mute,
              }}
              title={
                saveStatus === 'saved'
                  ? '모든 변경이 로컬에 저장됨'
                  : saveStatus === 'dirty'
                  ? '변경 중 — 800ms 후 자동 저장'
                  : '저장 상태 대기'
              }
              aria-live="polite"
            >
              {saveStatus === 'saved' ? '✓ 저장됨' : saveStatus === 'dirty' ? '● 변경 중' : '○ 대기'}
            </span>
            {/* 견적 보관함 빠른 열기 — md 이상 (모바일은 ⋯ 메뉴에서 접근) */}
            <button
              type="button"
              onClick={openLibrary}
              className="hidden md:inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border bg-white px-2.5 text-xs font-bold no-print"
              style={{ borderColor: PAL.line, color: PAL.violet }}
              title="견적 보관함 — 이름 붙여 저장하고 목록에서 불러오기"
              aria-label="견적 보관함 열기"
            >
              📚 보관함
            </button>
            {/* AI 도우미 — 항상 표시 (자주 사용) */}
            <Chatbot
              openSignal={chatbotSignal}
              context={{
                packageName,
                productType,
                nights,
                partyTotal,
                adult,
                youth,
                child,
                infant,
                partyTiered,
                vehiclesCount: vehicles.length,
                vehicleKinds: vehicles.map((v) => v.kind).filter(Boolean),
                totalSeats,
                guidesCount: guides.length,
                guideLanguages: guides.map((g) => g.language).filter(Boolean),
                stopsCount: stops.length,
                stopTypes: stops.map((s) => s.stopType),
                startTime,
                salePrice,
                channelsActive: channels.filter((c) => c.enabled).length,
                channelNames: channels.filter((c) => c.enabled).map((c) => c.name),
              }}
            />
            {/* 작업 메뉴 (⋯) — 공유·도움말·설치·PDF·Excel·초기화·로그아웃 7종 통합 */}
            <HeaderMenu
              items={[
                {
                  id: 'help',
                  label: '사용법 가이드',
                  icon: '❓',
                  color: PAL.violet,
                  onClick: () => setForceGuide((s) => !s),
                  description: '5스텝 빠른 시작 가이드를 다시 보기 (단축키: ?)',
                },
                {
                  id: 'share',
                  label: '공유 (URL · QR)',
                  icon: '🔗',
                  color: PAL.teal,
                  onClick: () => setShowShareModal(true),
                  description: '현재 견적을 URL·QR로 공유',
                },
                {
                  id: 'library',
                  label: '견적 보관함',
                  icon: '📚',
                  color: PAL.violet,
                  emphasized: true,
                  onClick: openLibrary,
                  description: '견적을 이름 붙여 저장하고 목록에서 불러오기·삭제 (여러 상품 보관)',
                },
                {
                  id: 'pdf',
                  label: 'PDF · 인쇄',
                  icon: '📄',
                  color: PAL.violet,
                  emphasized: true,
                  onClick: handlePrint,
                  description: '견적서 PDF 저장·인쇄 (지도 포함, A4 세로)',
                },
                {
                  id: 'excel',
                  label: 'Excel · CSV 내보내기',
                  icon: '📊',
                  color: PAL.emerald,
                  emphasized: true,
                  onClick: exportToExcel,
                  description: '일정표 Excel/CSV (NO·합계 SUBTOTAL 수식 포함)',
                },
                {
                  id: 'reset',
                  label: '전체 초기화',
                  icon: '🗑',
                  color: PAL.mute,
                  onClick: () => {
                    if (confirm('저장된 모든 입력값을 삭제하고 빈 패키지로 시작하시겠습니까?')) {
                      clearState();
                      if (typeof window !== 'undefined') window.location.reload();
                    }
                  },
                  description: '저장된 데이터 초기화 + 새로고침',
                },
                {
                  id: 'logout',
                  label: '로그아웃',
                  icon: '🔒',
                  color: PAL.rose,
                  emphasized: true,
                  onClick: async () => {
                    if (!confirm('로그아웃하시겠습니까? (입력값은 브라우저에 그대로 유지됩니다)')) return;
                    try {
                      await fetch('/api/auth/logout', { method: 'POST' });
                    } catch {}
                    if (typeof window !== 'undefined') window.location.href = '/login';
                  },
                  description: '현재 세션 종료 — /login 페이지로 이동',
                },
              ]}
              extras={
                <>
                  {/* 메뉴 안에 PWA 설치 통합 (구 PWAInstallPrompt 인라인 대신) */}
                  <div className="mb-1">
                    <PWAInstallPrompt />
                  </div>
                  {/* 모바일에서는 메뉴 안에 미니 통계도 표시 */}
                  <div className="xl:hidden mb-1 grid grid-cols-3 gap-1 text-[10px]" style={{ color: PAL.mute }}>
                    <div className="rounded bg-neutral-50 px-1 py-0.5 dark:bg-neutral-800"><b>{partyTotal}</b>명</div>
                    <div className="rounded bg-neutral-50 px-1 py-0.5 dark:bg-neutral-800">일정 <b>{stops.length}</b></div>
                    <div className="rounded bg-neutral-50 px-1 py-0.5 dark:bg-neutral-800"><b>{totalSeats}</b>석</div>
                  </div>
                </>
              }
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1920px] space-y-3 px-3 py-4 sm:space-y-4 sm:px-4 sm:py-5 lg:px-6">
        {/* 첫 진입 친절 가이드 — 5스텝 사용법 + BEP 의미. 닫음 영속 + 헤더 '도움말' 버튼으로 재오픈 */}
        <WelcomeGuide forceOpen={forceGuide} onClose={() => setForceGuide(false)} />
        {/* 입력 유효성 배지 — 누락·이상치 점검 (PDF·Excel·공유 전 사용자 실수 방지) */}
        <ValidationBanner
          ctx={{
            packageName,
            partyTotal,
            vehiclesCount: vehicles.length,
            totalSeats,
            guidesCount: guides.length,
            stopsCount: stops.length,
            salePrice,
          }}
        />
        {/* 플랫폼 소개 카피 — PC는 상단(lg 이상에서만 표시) */}
        <PlatformPitch placement="top" />

        {/* 공유 모달 — URL + QR */}
        <ShareModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          payload={{
            packageName, partyTiered, totalPax, adult, youth, child, infant,
            vehicles, guides, stops, startTime, salePrice, channels,
          }}
        />

        {/* 견적 보관함 — 이름 붙여 저장 + 목록 불러오기·삭제 (구 슬롯 대체) */}
        <LibraryModal
          open={showLibraryModal}
          onClose={() => setShowLibraryModal(false)}
          items={libraryItems}
          currentName={packageName}
          onSave={handleSaveToLibrary}
          onLoad={handleLoadFromLibrary}
          onDelete={handleDeleteFromLibrary}
          onNew={handleNewQuote}
        />

        {/* 빈 상태 — 첫 진입 시 시작 가이드 (어떤 입력도 안 됐을 때) */}
        {!packageName && partyTotal === 0 && stops.length === 0 && vehicles.length === 0 && guides.length === 0 && salePrice === 0 && (
          <div
            className="rounded-2xl border-2 border-dashed p-5"
            style={{ borderColor: PAL.violet, backgroundColor: PAL.violetPale }}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black tracking-wider" style={{ backgroundColor: PAL.violetPale, color: PAL.violet }}>
                🎯 시작 가이드
              </span>
              <span className="text-sm font-bold" style={{ color: PAL.ink }}>
                투어 패키지 견적을 4분 만에 완성하세요
              </span>
            </div>
            <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4" style={{ color: PAL.inkSoft }}>
              <li className="rounded-lg bg-white p-3 border" style={{ borderColor: PAL.line }}>
                <div className="text-xs font-black mb-1" style={{ color: PAL.violet }}>STEP 1 · 30초</div>
                <div className="font-bold">패키지명 + 인원 입력</div>
                <div className="mt-1 text-xs">최상단 큰 박스에 상품명, 인원 카드에 총원 (또는 구분 모드)</div>
              </li>
              <li className="rounded-lg bg-white p-3 border" style={{ borderColor: PAL.line }}>
                <div className="text-xs font-black mb-1" style={{ color: PAL.violet }}>STEP 2 · 1분</div>
                <div className="font-bold">차량 · 가이드 · 판매가</div>
                <div className="mt-1 text-xs">+ 차량 / + 가이드 클릭, 1일 단가 + 운영 일수. 판매가는 VAT 포함</div>
              </li>
              <li className="rounded-lg bg-white p-3 border" style={{ borderColor: PAL.line }}>
                <div className="text-xs font-black mb-1" style={{ color: PAL.violet }}>STEP 3 · 2분</div>
                <div className="font-bold">일정 카드 + 좌표</div>
                <div className="mt-1 text-xs">색상 버튼으로 출발·관광·식사·도착 추가. 카드 안 🔍 검색으로 좌표 자동 채움</div>
              </li>
              <li className="rounded-lg bg-white p-3 border" style={{ borderColor: PAL.line }}>
                <div className="text-xs font-black mb-1" style={{ color: PAL.violet }}>STEP 4 · 30초</div>
                <div className="font-bold">결과 확인 · 의사결정</div>
                <div className="mt-1 text-xs">매트릭스의 🎯 BEP 행 + ⭐ 첫 흑자 셀 + 운영 권장 텍스트 자동 산출</div>
              </li>
            </ol>
            <div className="mt-3 text-xs" style={{ color: PAL.mute }}>
              💾 입력 즉시 자동 저장 — 새로고침해도 데이터 유지. 🚗 카카오 모빌리티로 실시간 차량 이동시간 갱신 가능.
            </div>
          </div>
        )}
        {storageMsg && (
          <div
            className="rounded-lg border-l-4 px-3 py-2 text-sm font-semibold"
            style={{ backgroundColor: PAL.emeraldPale, color: PAL.emerald, borderColor: PAL.emerald }}
          >
            {storageMsg} <span className="ml-1 text-xs font-normal" style={{ color: PAL.inkSoft }}>— 자동 저장이 활성화되어 있어 입력 변경 시 즉시 보존됩니다</span>
          </div>
        )}
        {/* 패키지 상품명 */}
        <div className="grid gap-3">
          <div className="rounded-2xl border-2 bg-white p-4" style={{ borderColor: PAL.rose }}>
            <label className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: PAL.inkSoft }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-black tracking-wider" style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}>
                📋 패키지 상품명
              </span>
              <span className="text-xs font-normal" style={{ color: PAL.mute }}>
                — 견적·매트릭스·의사결정 보고에 표시됩니다
              </span>
            </label>
            <input
              type="text"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              placeholder="예: 서울 시티투어 1일 풀데이 (경복궁·남산·인사동) — 2026 봄 시즌"
              className="h-12 w-full rounded-lg border bg-white px-3 text-lg font-bold focus:outline-none focus:ring-2"
              style={{ borderColor: PAL.line, color: PAL.ink }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Label className="text-xs font-bold" style={{ color: PAL.mute }}>유형</Label>
              <select
                value={productType}
                onChange={(e) => {
                  const v = e.target.value as typeof productType;
                  setProductType(v);
                  // 박수 자동 추론
                  const nightsMap: Record<typeof productType, number> = {
                    '': 0, 'half-day': 0, 'full-day': 0,
                    '2d1n': 1, '3d2n': 2, '4d3n': 3, '5d4n': 4, '6d5n': 5,
                    'longstay': 6,
                  };
                  setNights(nightsMap[v]);
                  // 일자가 줄어들면 기존 stops의 dayNumber 클램프
                  const newTotalDays = Math.max(1, nightsMap[v] + 1);
                  setStops((rs) =>
                    rs.map((s) => ({
                      ...s,
                      dayNumber: Math.min(Math.max(1, s.dayNumber ?? 1), newTotalDays),
                    })),
                  );
                }}
                className="h-8 rounded-full px-3 text-xs font-bold"
                style={{ borderColor: PAL.line, backgroundColor: PAL.rosePale, color: PAL.rose }}
              >
                <option value="">유형 선택</option>
                <option value="half-day">반일 (4시간)</option>
                <option value="full-day">1일 풀데이</option>
                <option value="2d1n">1박 2일</option>
                <option value="3d2n">2박 3일</option>
                <option value="4d3n">3박 4일</option>
                <option value="5d4n">4박 5일</option>
                <option value="6d5n">5박 6일</option>
                <option value="longstay">롱스테이 (6박+)</option>
              </select>
              {/* 인쇄용 — select는 @media print에서 숨겨지므로 선택된 유형을 텍스트로 병기 (견적서 유형 누락 방지) */}
              <span
                className="hidden print:inline-block rounded-full px-2.5 py-1 text-xs font-black"
                style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}
              >
                {productType ? (PRODUCT_TYPE_LABELS[productType] ?? productType) : ''}
              </span>
              {nights > 0 && (
                <span className="rounded-full px-2.5 py-1 text-xs font-black tabular-nums" style={{ backgroundColor: PAL.violetPale, color: PAL.violet }}>
                  🌙 {nights}박
                </span>
              )}
              {productType === 'longstay' && (
                <input
                  type="number"
                  value={nights}
                  onChange={(e) => setNights(Math.max(0, Number(e.target.value) || 0))}
                  min={6}
                  max={365}
                  className="h-8 w-20 rounded border bg-white px-2 text-right text-sm font-bold tabular-nums"
                  style={{ borderColor: PAL.line }}
                  title="롱스테이 박수 직접 입력"
                />
              )}
            </div>
          </div>
        </div>

        {/* 큰 stat 5 */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <BigStat
            label="1인 원가 (성인): 입장권, 식사, 체험 등"
            value={cost.costPerAdult > 0 ? won(cost.costPerAdult) : '—'}
            tone="rose"
            tooltip="성인 1인 원가 = 인당 항목(관광 입장권 + 식사 + 체험비) + 공통비(차량 + 가이드)/인원. 모든 입력 금액은 VAT 포함 기준."
            secondary={
              cost.costPerAdult > 0
                ? `항목 ${won(cost.byTier.adult?.perPersonItems ?? 0)} + 공통 ${won(cost.perPersonShared)} (VAT 포함)`
                : partyTotal === 0
                  ? '인원 입력 시 공통비 자동 분배'
                  : undefined
            }
          />
          {(() => {
            const otaBep = channelAnalysis.bep.byChannel.find((b) => b.channelCode === 'global-ota')?.breakEvenN ?? null;
            return (
              <BigStat
                label="최선 BEP (글로벌 OTA 판매)"
                value={otaBep !== null ? `${otaBep}명` : '—'}
                tone="emerald"
                secondary={
                  otaBep !== null
                    ? `판매가 ${won(salePrice)} · 글로벌 OTA 수수료 30% 차감 후 ${otaBep}명부터 수익 발생 — 가장 보수적 기준`
                    : salePrice === 0
                      ? '판매가 입력 시 글로벌 OTA 기준 BEP 자동 계산'
                      : '글로벌 OTA 비활성 또는 도달 불가 (수수료 차감 후 적자 구조)'
                }
                tooltip="STEP 12 · 글로벌 OTA 등록 판매 기준 손익분기 인원. 수수료 30%로 가장 보수적인 채널이므로 이 BEP를 충족하면 자체 모객·자체 온라인 모든 채널에서 수익 발생이 보장됩니다."
              />
            );
          })()}
          <BigStat
            label="그룹 공통 총 원가 (차량 + 가이드)"
            value={cost.partySharedTotal > 0 ? won(cost.partySharedTotal) : '—'}
            tone="ink"
            tooltip="차량비 + 가이드비 합산 (시즌 가중치 반영, VAT 포함). 인원과 무관하게 그룹 전체에 1회 발생하는 공통 비용. 인원으로 나눠 1인이 부담할 몫이 결정됩니다."
            secondary={
              cost.partySharedTotal > 0 && partyTotal > 0
                ? `÷ ${partyTotal}명 = ${won(cost.partySharedTotal / partyTotal)} / 1인 공통 단가 (VAT 포함)`
                : cost.partySharedTotal > 0
                  ? '※ 인원 입력 후 1인당 공통 단가 산출'
                  : '※ 차량·가이드 입력 시 자동 산출'
            }
          />
          <BigStat
            label="판매가 (1인)"
            value={salePrice > 0 ? won(salePrice) : '—'}
            tone="violet"
            tooltip="고객 청구가 (VAT 10% 포함). 채널별 수수료·카드% 차감 전 기준값. 매트릭스·BEP 산출의 매출 기준."
            secondary={
              salePrice > 0 && partyTotal > 0
                ? `× ${partyTotal}명 = ${won(salePrice * partyTotal)} / 판매가 합계 (VAT 포함, 수수료 차감 전)`
                : salePrice > 0
                  ? '※ 인원 입력 후 판매가 합계 자동 산출'
                  : '※ 1인 판매가 입력 시 자동 산출'
            }
          />
          <BigStat label="전체 일정" value={itinerary.totalMin > 0 ? formatMin(itinerary.totalMin) : '—'} tone="amber" tooltip="체류 + 이동. 좌표 기반 Haversine × 도로 우회 계수 1.3 ÷ 평균 25km/h 추정 (정확한 값은 카카오 모빌리티 길찾기 API 통합 시 대체)." />
        </div>

        {/* AI 인사이트 */}
        {insights.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" title="현재 입력값을 룰 기반으로 분석해 좌석 부족·BEP 미달·체류시간 불균형 등 의사결정에 필요한 신호를 자동 산출합니다. 인사이트는 입력 변경 시 실시간으로 갱신됩니다.">
                자동 분석 — 지금 견적의 의사결정 신호
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {insights.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium"
                    style={{
                      backgroundColor:
                        it.level === 'good'
                          ? PAL.emeraldPale
                          : it.level === 'critical'
                            ? PAL.rosePale
                            : it.level === 'warn'
                              ? PAL.amberPale
                              : '#F3F4F6',
                      color:
                        it.level === 'good'
                          ? PAL.emerald
                          : it.level === 'critical'
                            ? PAL.rose
                            : it.level === 'warn'
                              ? PAL.amber
                              : PAL.inkSoft,
                    }}
                  >
                    <span className="font-bold">●</span>
                    <span>{it.text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 입력 4카드 */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
          {/* 인원 */}
          <Card className="sm:col-span-1 lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base" title="구분 모드는 성인 1.0·청소년 0.7·어린이 0.5·유아 0.0 적용">
                인원
              </CardTitle>
              <ModeToggle off="통합" on="구분" checked={partyTiered} onChange={setPartyTiered} />
            </CardHeader>
            <CardContent>
              {partyTiered ? (
                <div className="grid grid-cols-4 gap-2">
                  <NumField label="성인" value={adult} onChange={setAdult} tooltip="가중치 1.0" />
                  <NumField label="청소년" value={youth} onChange={setYouth} tooltip="가중치 0.7" />
                  <NumField label="어린이" value={child} onChange={setChild} tooltip="가중치 0.5" />
                  <NumField label="유아" value={infant} onChange={setInfant} tooltip="가중치 0.0" />
                </div>
              ) : (
                <NumField
                  label="총원 (성인 통합)"
                  value={totalPax}
                  onChange={setTotalPax}
                  tooltip="전체 인원을 성인 기준 1명으로 계산"
                />
              )}
            </CardContent>
          </Card>

          {/* 차량 */}
          <Card className="sm:col-span-2 lg:col-span-4">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base" title="투어에 투입할 차량 목록. 차종·최대 탑승 인원·실 운용 인원·1일 단가·운영 일수를 입력. 차량비는 인원 전체에 공통 비용으로 분산됩니다 (인원 ÷ 차량비). 다중 차량 운용 시 + 차량 추가.">
                차량 <span className="text-xs font-normal" style={{ color: PAL.mute }}>({vehicles.length}/{MAX_VEHICLES})</span>
              </CardTitle>
              <AddBtn
                disabled={vehicles.length >= MAX_VEHICLES}
                onClick={() => setVehicles((rs) => [...rs, emptyVehicle()])}
              >
                + 차량
              </AddBtn>
            </CardHeader>
            <CardContent className="space-y-2">
              {vehicles.length === 0 && <Empty>차량을 추가하세요</Empty>}
              {vehicles.map((v, i) => (
                <div key={i} className="rounded-lg border bg-white p-2.5 space-y-1.5" style={{ borderColor: PAL.line }}>
                  <div className="flex gap-1.5">
                    <select
                      value={VEHICLE_KINDS.includes(v.kind) ? v.kind : ''}
                      onChange={(e) => {
                        const kind = e.target.value;
                        // 차종 이름에서 "N인승" 패턴 파싱 → capacity·maxBoard 자동 채움
                        // (예: "카니발 9인승" → 9, "45인승 버스" → 45)
                        const parsed = parseSeats(kind);
                        const patch: Partial<VehicleRow> = { kind };
                        if (parsed !== null) {
                          patch.capacity = parsed;
                          // maxBoard 가 비어있거나(0) 사용자가 미입력 상태면 같이 채움.
                          // 이미 사용자가 직접 값을 넣어둔 경우엔 보존.
                          if (!v.maxBoard || v.maxBoard === 0) {
                            patch.maxBoard = parsed;
                          }
                        }
                        patchVehicle(i, patch);
                      }}
                      className="h-9 flex-1 rounded border bg-white px-2 text-sm font-semibold"
                      style={{ borderColor: PAL.line }}
                      title="차종 선택 시 차종명의 인승 표기를 분석해 '최대 탑승 인원'·'실 탑승 최대 인원'이 자동 채워집니다 (수동 변경 가능)."
                    >
                      <option value="">차종 선택…</option>
                      {VEHICLE_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <DeleteBtn onClick={() => setVehicles((rs) => rs.filter((_, j) => j !== i))} />
                  </div>
                  <Input
                    type="text"
                    value={v.kind && !VEHICLE_KINDS.includes(v.kind) ? v.kind : ''}
                    placeholder="또는 직접 입력 (예: 코나 4인승) — 'N인승' 표기 시 인원 자동 채움"
                    onChange={(e) => {
                      const kind = e.target.value;
                      const parsed = parseSeats(kind);
                      const patch: Partial<VehicleRow> = { kind };
                      if (parsed !== null) {
                        patch.capacity = parsed;
                        if (!v.maxBoard || v.maxBoard === 0) {
                          patch.maxBoard = parsed;
                        }
                      }
                      patchVehicle(i, patch);
                    }}
                    className="h-9 text-sm"
                    title="직접 입력한 차종명에 'N인승'이 들어있으면 인원이 자동 채워집니다 (예: '코나 4인승' → 4명)."
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="최대 탑승 인원" value={v.capacity} onChange={(n) => patchVehicle(i, { capacity: n })} small tooltip="차량 제원상 최대 좌석 수 (예: 45인승 = 45명). 줄이면 '실 탑승 최대 인원'이 자동으로 같이 줄어듭니다." />
                    <NumField
                      label="실 탑승 최대 인원"
                      value={v.maxBoard}
                      onChange={(n) => patchVehicle(i, { maxBoard: Math.min(n, v.capacity > 0 ? v.capacity : n) })}
                      small
                      tooltip={`안전·편의상 실제 운용 가능 인원 (예: 45인승 → 실 탑승 40명 권장). 최대 탑승 인원(${v.capacity || '?'}명)을 초과할 수 없으며, 초과 입력 시 자동으로 최대값으로 클램프됩니다.`}
                    />
                    <NumField label="차량비/일 (차량+기사팁)" value={v.dailyKrw} onChange={(n) => patchVehicle(i, { dailyKrw: n })} step={50000} small currency tooltip="1일 차량비 + 기사님 팁 합계" />
                    <NumField label="운영 일수" value={v.days} onChange={(n) => patchVehicle(i, { days: n })} small tooltip="차량 운용 일수" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 가이드 */}
          <Card className="sm:col-span-1 lg:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base" title="현장 가이드 인건비. 언어·1일 단가·운영 일수 입력. 가이드비도 차량비와 함께 인원 전체에 공통 비용으로 분산됩니다. 외국어 가이드 동행 시 + 가이드 추가.">
                가이드 <span className="text-xs font-normal" style={{ color: PAL.mute }}>({guides.length}/{MAX_GUIDES})</span>
              </CardTitle>
              <AddBtn
                disabled={guides.length >= MAX_GUIDES}
                onClick={() => setGuides((rs) => [...rs, emptyGuide()])}
              >
                + 가이드
              </AddBtn>
            </CardHeader>
            <CardContent className="space-y-2">
              {guides.length === 0 && <Empty>가이드를 추가하세요</Empty>}
              {guides.map((g, i) => (
                <div key={i} className="rounded-lg border bg-white p-2.5 space-y-1.5" style={{ borderColor: PAL.line }}>
                  <div className="flex gap-1.5">
                    <select
                      value={LANGUAGES.includes(g.language) ? g.language : ''}
                      onChange={(e) => patchGuide(i, { language: e.target.value })}
                      className="h-9 flex-1 rounded border bg-white px-2 text-sm font-semibold"
                      style={{ borderColor: PAL.line }}
                    >
                      <option value="">언어 선택…</option>
                      {LANGUAGES.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <DeleteBtn onClick={() => setGuides((rs) => rs.filter((_, j) => j !== i))} />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumField label="가이드비/일" value={g.dailyKrw} onChange={(n) => patchGuide(i, { dailyKrw: n })} step={10000} small currency tooltip="1일 가이드 인건비" />
                    <NumField label="운영 일수" value={g.days} onChange={(n) => patchGuide(i, { days: n })} small tooltip="가이드 운영 일수" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 판매가 */}
          <Card className="sm:col-span-2 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base" title="채널 수수료 차감의 기준값. VAT 포함.">
                패키지 판매가
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <NumField
                label="1인 판매가 (VAT 포함)"
                value={salePrice}
                onChange={setSalePrice}
                step={5000}
                tooltip="고객 청구가 (VAT 10% 포함된 최종 금액). 매트릭스·BEP·수익률 산출의 기준값. 비워두면 모든 분석이 0으로 표시됩니다."
              />
              <p className="text-[10px] leading-relaxed" style={{ color: PAL.mute }}>
                매트릭스·BEP·수익률 산출의 기준
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 채널 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base" title="이 패키지를 판매할 채널(자체·OTA·B2B 등)과 각 채널의 판매수수료·카드수수료를 정의. 매트릭스·BEP는 활성(체크) 채널만 분석합니다. 체크 해제 = 매트릭스 제외, ✕ = 영구 삭제.">
              판매 채널
              <span className="ml-2 text-xs font-normal" style={{ color: PAL.mute }}>
                ({channels.length}/10) — 체크 토글 · 이름·수수료·카드% 직접 편집
              </span>
            </CardTitle>
            <AddBtn disabled={channels.length >= 10} onClick={addChannel}>
              + 채널 추가
            </AddBtn>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
              {channels.map((c) => (
                <div
                  key={c.code}
                  className="relative min-w-0 rounded-xl border-2 p-2.5 transition"
                  style={{
                    borderColor: c.enabled ? PAL.emerald : PAL.line,
                    backgroundColor: c.enabled ? PAL.surface : PAL.bg,
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => patchChannel(c.code, { enabled: e.target.checked })}
                      className="h-4 w-4 shrink-0 cursor-pointer"
                      title={c.enabled
                        ? '활성 — 매트릭스·BEP에 포함됩니다. 체크 해제 시 즉시 분석에서 제외 (데이터는 보존).'
                        : '비활성 — 현재 매트릭스에서 제외 중. 체크 시 다시 포함됩니다.'}
                      aria-label={`${c.name} 채널 활성화 토글`}
                    />
                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => patchChannel(c.code, { name: e.target.value })}
                      placeholder="채널명"
                      className="h-7 flex-1 min-w-0 rounded border bg-transparent px-1.5 text-base font-bold focus:outline-none focus:ring-1"
                      style={{
                        borderColor: 'transparent',
                        color: c.enabled ? PAL.ink : PAL.mute,
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = PAL.line; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                      title="채널 이름을 직접 편집할 수 있습니다 (예: '자체 모객 (오프라인)' → '국내 여행사 B2B'). 변경 사항은 즉시 매트릭스·BEP 라벨에 반영됩니다."
                      aria-label="채널 이름"
                    />
                    {channels.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeChannel(c.code)}
                        className="shrink-0 px-1.5 text-base font-black"
                        style={{ color: PAL.rose }}
                        title="이 채널을 영구 삭제 — 매트릭스·BEP에서 제외됩니다. 잠시 빼두려면 체크박스 해제 사용 권장."
                        aria-label={`${c.name} 채널 삭제`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <Label className="block text-xs font-bold" style={{ color: PAL.mute }}>판매수수료 %</Label>
                      <PercentInput
                        value={c.commission}
                        onChange={(v) => patchChannel(c.code, { commission: v })}
                        step={1}
                        ariaLabel={`${c.name} 판매수수료 %`}
                      />
                    </div>
                    <div className="min-w-0">
                      <Label className="block text-xs font-bold" style={{ color: PAL.mute }}>카드 %</Label>
                      <PercentInput
                        value={c.cardFee}
                        onChange={(v) => patchChannel(c.code, { cardFee: v })}
                        step={1}
                        ariaLabel={`${c.name} 카드 수수료 %`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 관광 일정 (가로) */}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base" title="투어 경로(출발 → 경유 → 관광 → 식사 → 체험 → 도착)를 순서대로 카드로 배치. 카드는 드래그로 순서 재배치 가능. 좌표 입력 시 동선·이동시간 자동 산출. 박수가 2일 이상이면 자동으로 일자별 그룹 표시.">
              관광 일정
              <span className="ml-2 text-xs font-normal" style={{ color: PAL.mute }}>
                ({stops.length}/{MAX_STOPS}) {totalDays > 1 ? `· ${totalDays}일 패키지 · 일자별 그룹` : '· 색상 버튼으로 유형 추가'}
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs" style={{ borderColor: PAL.line, backgroundColor: PAL.bg }} title="시작 시각 — 각 일자 시작 시각 (일자 바뀔 때 자동 reset)">
                <span className="font-bold whitespace-nowrap" style={{ color: PAL.inkSoft }}>⏰ 시작</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value || '08:00')}
                  className="h-6 w-32 bg-transparent text-sm font-semibold tabular-nums focus:outline-none"
                  style={{ color: PAL.ink }}
                />
              </label>
              {totalDays === 1 && STOP_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={stops.length >= MAX_STOPS}
                  onClick={() => addStop(t, 1)}
                  className="rounded-full px-3 py-1 text-xs font-bold transition disabled:opacity-40 hover:scale-105"
                  style={{ color: STOP_META[t].color, backgroundColor: STOP_META[t].bg }}
                >
                  + {STOP_META[t].label}
                </button>
              ))}
              <button
                type="button"
                disabled={stops.length < 2 || kakaoLoading}
                onClick={updateTravelFromKakao}
                className="rounded-full px-3.5 py-1.5 text-xs font-bold text-white transition disabled:opacity-40 hover:scale-105"
                style={{ backgroundColor: PAL.violet }}
                title="모든 일정·좌표 입력 완료 후 클릭 — 카카오 모빌리티가 실시간 교통 상황을 반영해 차량 이동시간을 정밀 갱신합니다."
              >
                {kakaoLoading ? '🚗 갱신 중…' : '🚗 실시간 교통 반영'}
              </button>
              <button
                type="button"
                disabled={stops.length === 0}
                onClick={resetStops}
                className="ml-1 rounded-full border px-3 py-1 text-xs font-bold transition disabled:opacity-30 hover:scale-105"
                style={{ borderColor: PAL.rose, color: PAL.rose, backgroundColor: 'white' }}
                title="모든 일정 카드 삭제"
              >
                ↻ 전체 리셋
              </button>
            </div>
            {kakaoMsg && (
              <div
                className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold"
                style={{
                  backgroundColor: kakaoMsg.ok ? PAL.emeraldPale : PAL.rosePale,
                  color: kakaoMsg.ok ? PAL.emerald : PAL.rose,
                }}
              >
                {kakaoMsg.ok ? '✓ ' : '⚠ '}
                {kakaoMsg.text}
              </div>
            )}
            <div
              className="mt-2 w-full rounded-xl border-l-4 px-3.5 py-2.5"
              style={{ borderColor: PAL.violet, backgroundColor: 'rgba(110, 55, 204, 0.04)' }}
            >
              <div className="text-xs font-black tracking-wider mb-1" style={{ color: PAL.violet }}>
                💡 예상시간 산출 안내 — 실시간 교통 + 체류 누적
              </div>
              <p className="text-xs leading-relaxed" style={{ color: PAL.inkSoft }}>
                좌표 입력을 마친 뒤 우측 <strong style={{ color: PAL.violet }}>🚗 실시간 교통 반영</strong> 버튼을 누르면 카카오 모빌리티 길찾기가 현 시점의 도로·신호·체증을 반영해 모든 구간 이동시간을 정밀 갱신합니다.
                {' '}각 Day 헤더의 <strong style={{ color: PAL.amber }}>▶ 출발</strong> · <strong style={{ color: PAL.violet }}>↻ 이동 누계</strong> · <strong style={{ color: PAL.teal }}>⏱ 체류 누계</strong> · <strong style={{ color: PAL.emerald }}>◀ 예상 종료</strong>는 시작 시각 <strong>{startTime}</strong>을 기점으로 좌표 기반 실시간 이동시간 + 카드별 체류시간을 누적 합산한 결과입니다.
              </p>
              <p className="mt-1 text-[11px]" style={{ color: PAL.mute }}>
                · 갱신된 이동시간(분)은 카드별로 직접 수정 가능 · 빈 칸이면 자동 추정값(Haversine 직선거리 × 도로 우회 1.3 ÷ 평균 25km/h)으로 복귀
                {' · '}패키지 출발 요일은 하단 <strong>📊 캠페인 시뮬레이션</strong>의 운영 요일 선택과 연동
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {totalDays === 1 && stops.length === 0 ? (
              <Empty>위 색상 버튼으로 출발·경유·관광·식사·체험·도착 카드를 추가하세요</Empty>
            ) : (
              <>
              {Array.from({ length: totalDays }, (_, dayIdx) => {
                const day = dayIdx + 1;
                const dayStopsRaw = stops
                  .map((stop, originalIdx) => ({ stop, originalIdx }))
                  .filter((x) => (x.stop.dayNumber ?? 1) === day);
                const dayStops = dayStopsRaw;
                // 일자별 누적 — 첫 도착, 마지막 출발, 이동시간 합, 체류시간 합
                const firstIdx = dayStops[0]?.originalIdx ?? -1;
                const lastIdx = dayStops[dayStops.length - 1]?.originalIdx ?? -1;
                const firstArrive = firstIdx >= 0 ? scheduleTimes[firstIdx]?.arrive ?? null : null;
                const lastDepart = lastIdx >= 0 ? scheduleTimes[lastIdx]?.depart ?? null : null;
                const dayStayMin = dayStops.reduce((sum, x) => sum + (x.stop.stayMin || 0), 0);
                const dayTravelMin = dayStops.reduce((sum, x, di) => {
                  if (di === 0) return sum; // 일자 첫 stop은 이동 없음
                  const m = itinerary.legs[x.originalIdx - 1]?.minutes;
                  return sum + (typeof m === 'number' ? m : 0);
                }, 0);
                const dayTotalMin = dayStayMin + dayTravelMin;
                return (
                  <div key={`day-${day}`} className="mb-4 print-avoid-break">
                    {(totalDays > 1 || dayStops.length > 0) && totalDays > 1 && (
                      <div className="mb-2 rounded-lg px-3 py-2.5" style={{ backgroundColor: PAL.bg, borderLeft: `4px solid ${PAL.rose}` }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-black tracking-wide" style={{ backgroundColor: PAL.rose, color: 'white' }}>
                            🗓 Day {day}
                          </span>
                          <span className="text-xs font-bold tabular-nums" style={{ color: PAL.inkSoft }}>
                            {dayStops.length}건 · 시작 {startTime}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1 no-print">
                          {STOP_ORDER.map((t) => (
                            <button
                              key={t}
                              type="button"
                              disabled={stops.length >= MAX_STOPS}
                              onClick={() => addStop(t, day)}
                              className="rounded-full px-2.5 py-0.5 text-xs font-bold transition disabled:opacity-40 hover:scale-105"
                              style={{ color: STOP_META[t].color, backgroundColor: STOP_META[t].bg }}
                              title={`Day ${day}에 ${STOP_META[t].label} 카드 추가`}
                            >
                              + {STOP_META[t].label}
                            </button>
                          ))}
                        </div>
                        </div>
                        {/* 일자별 예상시간 — 실제 카카오 실시간 교통 반영분 + 체류시간 누적 */}
                        {dayStops.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: PAL.inkSoft }}>
                            <span className="font-bold" style={{ color: PAL.amber }}>
                              ▶ 출발 {firstArrive !== null ? fmtTime(firstArrive) : startTime}
                            </span>
                            <span className="font-semibold" style={{ color: PAL.violet }}>
                              ↻ 이동 누계 {formatMin(dayTravelMin)}
                            </span>
                            <span className="font-semibold" style={{ color: PAL.teal }}>
                              ⏱ 체류 누계 {formatMin(dayStayMin)}
                            </span>
                            <span className="font-bold" style={{ color: PAL.emerald }}>
                              ◀ 예상 종료 {lastDepart !== null ? fmtTime(lastDepart) : '—'}
                            </span>
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-black" style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}>
                              Day {day} 총 {formatMin(dayTotalMin)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {dayStops.length === 0 ? (
                      <Empty>Day {day}의 일정 — 위 색상 버튼으로 카드를 추가하세요</Empty>
                    ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {dayStops.map(({ stop: s, originalIdx: i }, idxInDay) => {
                        const leg = idxInDay > 0 ? itinerary.legs[i - 1] : null;
                        const time = scheduleTimes[i] ?? null;
                        return (
                          <div
                            key={i}
                            className="flex items-stretch transition-all"
                            draggable
                            onDragStart={(e) => {
                              const tag = (e.target as HTMLElement).tagName;
                              if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) {
                                e.preventDefault();
                                return;
                              }
                              setDraggingIdx(i);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnter={() => draggingIdx !== null && draggingIdx !== i && setDragOverIdx(i)}
                            onDragOver={(e) => {
                              if (draggingIdx === null) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (draggingIdx !== null && draggingIdx !== i) reorderStops(draggingIdx, i);
                              setDraggingIdx(null);
                              setDragOverIdx(null);
                            }}
                            onDragEnd={() => {
                              setDraggingIdx(null);
                              setDragOverIdx(null);
                            }}
                            style={{
                              opacity: draggingIdx === i ? 0.35 : 1,
                              outline: dragOverIdx === i && draggingIdx !== null && draggingIdx !== i ? `3px solid ${PAL.rose}` : undefined,
                              outlineOffset: dragOverIdx === i && draggingIdx !== null && draggingIdx !== i ? '3px' : undefined,
                              borderRadius: dragOverIdx === i ? '1rem' : undefined,
                              cursor: 'grab',
                            }}>
                            {leg && (
                        <div className="flex items-center px-2 text-center text-xs" style={{ color: PAL.mute }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="text-2xl font-black" style={{ color: PAL.rose }}>→</div>
                            <div className="text-sm font-bold" style={{ color: PAL.inkSoft }}>
                              {leg.km !== null ? `${leg.km.toFixed(1)}km` : '좌표'}
                            </div>
                            {/* 이동시간 수동 입력 (override) — 빈 값이면 자동 추정 사용. 🔒 고정 시 카카오 실시간 갱신 제외 */}
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={typeof s.travelFromPrevMin === 'number' ? s.travelFromPrevMin : ''}
                                placeholder={leg.minutes !== null && typeof s.travelFromPrevMin !== 'number'
                                  ? `${Math.round(leg.minutes)}`
                                  : '?'}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  patchStop(i, { travelFromPrevMin: v === '' ? '' : Math.max(0, Number(v) || 0) });
                                }}
                                className="h-7 w-12 rounded border bg-white text-center text-sm font-bold tabular-nums"
                                style={{
                                  borderColor: s.travelLocked ? PAL.amber : (typeof s.travelFromPrevMin === 'number' ? PAL.rose : PAL.line),
                                  color: s.travelLocked ? PAL.amber : (typeof s.travelFromPrevMin === 'number' ? PAL.rose : PAL.inkSoft),
                                }}
                                title={typeof s.travelFromPrevMin === 'number'
                                  ? '수동 입력값 (직접 입력) — 비우면 자동 추정으로 복귀'
                                  : `자동 추정값: ${leg.minutes !== null ? Math.round(leg.minutes) + '분' : '좌표 필요'}. 실제 차량 시간을 직접 입력하면 우선 적용`}
                              />
                              <span className="text-xs font-semibold">분</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!s.travelLocked) {
                                    // 고정 켜기 — 빈 값이면 현재 자동 추정값을 수동값으로 박아 "보이는 값"을 고정
                                    const patch: Partial<StopRow> = { travelLocked: true };
                                    if (typeof s.travelFromPrevMin !== 'number' && leg.minutes !== null) {
                                      patch.travelFromPrevMin = Math.round(leg.minutes);
                                    }
                                    patchStop(i, patch);
                                  } else {
                                    patchStop(i, { travelLocked: false });
                                  }
                                }}
                                className="ml-0.5 flex h-7 w-7 items-center justify-center rounded border text-xs leading-none"
                                style={{
                                  borderColor: s.travelLocked ? PAL.amber : PAL.line,
                                  backgroundColor: s.travelLocked ? PAL.amberPale : 'white',
                                  color: s.travelLocked ? PAL.amber : PAL.mute,
                                }}
                                title={s.travelLocked
                                  ? '이동시간 고정됨 — 카카오 실시간 교통 갱신에서 제외. 클릭하면 실시간 반영으로 전환'
                                  : '실시간 — 카카오 교통 갱신 대상. 클릭하면 현재 값으로 고정'}
                                aria-label={s.travelLocked ? '이동시간 고정 해제' : '이동시간 고정'}
                                aria-pressed={s.travelLocked}
                              >
                                {s.travelLocked ? '🔒' : '⟳'}
                              </button>
                            </div>
                            {time && (
                              <div
                                className="text-sm font-black tabular-nums"
                                style={{ color: time.fixed ? PAL.amber : PAL.rose }}
                                title={time.fixed ? '도착시각 고정됨 (누적 계산 무시)' : undefined}
                              >
                                {time.fixed && '🔒'}{fmtTime(time.arrive)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <StopCard
                        index={i}
                        total={stops.length}
                        stop={s}
                        schedule={time}
                        onPatch={(p) => patchStop(i, p)}
                        onMove={(d) => moveStop(i, d)}
                        onRemove={() => removeStop(i)}
                      />
                    </div>
                  );
                })}
              </div>
                    )}
                  </div>
                );
              })}
              <div
                className="mt-3 rounded-xl border-2 border-dashed p-3"
                style={{ borderColor: PAL.rose, backgroundColor: 'rgba(192, 48, 107, 0.04)' }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold" style={{ color: PAL.inkSoft }}>
                      관광·식사·체험 1인 개별 합계
                    </span>
                    <span className="text-2xl font-black tabular-nums" style={{ color: PAL.rose }}>
                      {won(cost.byTier.adult?.perPersonItems ?? 0)}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: PAL.mute }}>
                      ({stops.filter((s) => STOP_META[s.stopType].hasPrice).length}개 항목 합산)
                    </span>
                  </div>
                  <div className="text-sm font-semibold tabular-nums" style={{ color: PAL.inkSoft }}>
                    개별 {won(cost.byTier.adult?.perPersonItems ?? 0)}
                    <span className="mx-1.5 font-bold" style={{ color: PAL.mute }}>+</span>
                    공통 (차량+가이드 ÷ {cost.nTotal || '인원'}명) {won(cost.perPersonShared)}
                    <span className="mx-1.5 font-bold" style={{ color: PAL.mute }}>=</span>
                    <span className="font-black text-lg" style={{ color: PAL.ink }}>
                      1인 원가 {won(cost.costPerAdult)}
                    </span>
                  </div>
                </div>
                {salePrice > 0 && cost.costPerAdult > 0 && channelAnalysis.bep.bestMin && (
                  <div
                    className="mt-3 border-t pt-2.5 text-sm font-semibold tabular-nums"
                    style={{ borderColor: PAL.line, color: PAL.inkSoft }}
                  >
                    판매가 <span className="font-black text-base" style={{ color: PAL.violet }}>{won(salePrice)}</span> 기준 —
                    <span className="mx-1 font-black text-base" style={{ color: PAL.emerald }}>
                      {channelAnalysis.bep.bestMin}명부터 수익 발생 (최선 채널)
                    </span>
                  </div>
                )}
              </div>

              {/* 일정 결과보고 — 카드별 번호·시각·체류·이동·가격 요약표 */}
              <div className="mt-3 rounded-xl border bg-white p-4" style={{ borderColor: PAL.line }}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black tracking-wider" style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}>
                    📋 일정 결과보고
                  </span>
                  <span className="text-xs font-semibold" style={{ color: PAL.mute }}>
                    — 카드별 도착·체류·출발·이동·가격 요약 (시작 {startTime} 기준)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 text-left text-xs font-black tracking-wide" style={{ borderColor: PAL.rose, color: PAL.inkSoft }}>
                        <th className="py-2 pr-2 text-center">#</th>
                        <th className="py-2 pr-2">유형</th>
                        <th className="py-2 pr-2">상품명 / 비고</th>
                        <th className="py-2 pr-2 text-right">도착</th>
                        <th className="py-2 pr-2 text-right" style={{ color: PAL.teal }}>⏱ 체류시간</th>
                        <th className="py-2 pr-2 text-right">출발</th>
                        <th className="py-2 pr-2 text-right">이동 (직전 → 현재)</th>
                        <th className="py-2 pr-2 text-right">1인 가격</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stops.map((s, i) => {
                        const meta = STOP_META[s.stopType];
                        const time = scheduleTimes[i];
                        const leg = i > 0 ? itinerary.legs[i - 1] : null;
                        const priceDisplay = !meta.hasPrice
                          ? '—'
                          : s.tiered
                            ? `₩${(s.adultPrice || 0).toLocaleString('ko-KR')}`
                            : `₩${(s.unifiedPrice || 0).toLocaleString('ko-KR')}`;
                        return (
                          <tr key={i} className="border-b" style={{ borderColor: '#F3F0E8' }}>
                            <td className="py-2 pr-2 text-center">
                              <span className="text-xl font-black" style={{ color: meta.color }}>
                                {circleNum(i + 1)}
                              </span>
                            </td>
                            <td className="py-2 pr-2">
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-black" style={{ backgroundColor: meta.bg, color: meta.color }}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-sm font-bold" style={{ color: PAL.ink }}>
                              {s.productName || <span className="font-normal" style={{ color: PAL.mute }}>(상품명 미입력)</span>}
                              {s.note && (
                                <span className="ml-1.5 text-xs font-normal" style={{ color: PAL.mute }}>· {s.note}</span>
                              )}
                              {s.address && (
                                <div className="mt-0.5 truncate text-xs font-normal" style={{ color: PAL.mute, maxWidth: '24em' }}>
                                  📍 {s.address}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.rose }}>
                              {time ? fmtTime(time.arrive) : '—'}
                            </td>
                            <td className="py-2 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.teal, backgroundColor: s.stayMin > 0 ? PAL.tealPale : undefined }}>
                              {s.stayMin > 0 ? `${s.stayMin}분` : '—'}
                            </td>
                            <td className="py-2 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.violet }}>
                              {time && s.stayMin > 0 ? fmtTime(time.depart) : '—'}
                            </td>
                            <td className="py-2 pr-2 text-right text-xs tabular-nums font-semibold" style={{ color: PAL.mute }}>
                              {i === 0
                                ? <span style={{ color: PAL.amber }}>🏁 시작</span>
                                : leg && leg.km !== null && leg.minutes !== null
                                  ? <>
                                      {leg.km.toFixed(1)}km · {formatMin(leg.minutes)}
                                      {typeof s.travelFromPrevMin === 'number' && (
                                        <span className="ml-1 inline-block rounded px-1 py-0.5 text-[10px] font-black" style={{ backgroundColor: PAL.violetPale, color: PAL.violet }} title="사용자 직접 입력 (또는 카카오 모빌리티 갱신)">
                                          ✏ 수동
                                        </span>
                                      )}
                                    </>
                                  : '좌표 입력 시'}
                            </td>
                            <td className="py-2 pr-2 text-right text-sm tabular-nums font-bold" style={{ color: meta.hasPrice ? PAL.ink : PAL.mute }}>
                              {priceDisplay}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 bg-rose-50/30" style={{ borderColor: PAL.rose }}>
                        <td colSpan={3} className="py-2.5 pr-2 text-right text-sm font-black" style={{ color: PAL.inkSoft }}>
                          합계
                        </td>
                        <td className="py-2.5 pr-2 text-right text-xs font-bold" style={{ color: PAL.mute }}>
                          {stops.length > 0 && scheduleTimes[0] ? fmtTime(scheduleTimes[0].arrive) : '—'}
                        </td>
                        <td className="py-2.5 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.teal, backgroundColor: PAL.tealPale }}>
                          {formatMin(itinerary.totalStayMin)}
                        </td>
                        <td className="py-2.5 pr-2 text-right text-xs font-bold" style={{ color: PAL.mute }}>
                          {stops.length > 0 && scheduleTimes[stops.length - 1] ? fmtTime(scheduleTimes[stops.length - 1].depart) : '—'}
                        </td>
                        <td className="py-2.5 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.violet }}>
                          {formatMin(itinerary.totalTravelMin)}
                        </td>
                        <td className="py-2.5 pr-2 text-right text-sm font-black tabular-nums" style={{ color: PAL.rose }}>
                          {won(cost.byTier.adult?.perPersonItems ?? 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold tabular-nums" style={{ color: PAL.inkSoft }}>
                  <span>📍 좌표 입력 카드 {stops.filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number').length}/{stops.length}건</span>
                  <span>💰 유료 카드 {stops.filter((s) => STOP_META[s.stopType].hasPrice).length}건</span>
                  <span>⏱ 총 소요 <strong style={{ color: PAL.rose }}>{formatMin(itinerary.totalMin)}</strong> (체류시간 <strong style={{ color: PAL.teal }}>{formatMin(itinerary.totalStayMin)}</strong> + 이동시간 <strong style={{ color: PAL.violet }}>{formatMin(itinerary.totalTravelMin)}</strong>)</span>
                </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 지도 — 인쇄 시 카카오 타일은 print 캡처가 안 되므로, html2canvas로 뜬 이미지(printMapSrc)를 대신 출력 */}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">
              <span title="좌표가 입력된 장소를 카카오맵 위에 순번 마커로 표시. 마커는 마우스로 드래그해 위치를 직접 미세 조정 가능. ▭ 가로형은 동선 확인, ▢ 정사각형은 남북 거리가 큰 일정 확인에 유리.">지도</span>
              <span className="text-xs font-normal" style={{ color: PAL.mute }}>— 좌표가 있는 장소만 순서대로 표시 · 마커 드래그로 위치 정밀 조정</span>
            </CardTitle>
            <div className="no-print inline-flex items-center overflow-hidden rounded-full border" style={{ borderColor: PAL.line }} role="group" aria-label="지도 크기 선택">
              <button
                type="button"
                onClick={() => setMapShape('wide')}
                className="px-3 py-1 text-xs font-black transition"
                style={{
                  backgroundColor: mapShape === 'wide' ? PAL.rose : 'white',
                  color: mapShape === 'wide' ? 'white' : PAL.mute,
                }}
                title="가로 길게 — 동선·경로 한눈에 보기"
              >
                ▭ 가로형
              </button>
              <button
                type="button"
                onClick={() => setMapShape('square')}
                className="px-3 py-1 text-xs font-black transition"
                style={{
                  backgroundColor: mapShape === 'square' ? PAL.rose : 'white',
                  color: mapShape === 'square' ? 'white' : PAL.mute,
                  borderLeft: `1px solid ${PAL.line}`,
                }}
                title="정사각형 — 남북 거리 큰 일정 보기"
              >
                ▢ 정사각형
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {/* 드래그 안내 — 마커를 직접 이동해 좌표를 정밀 조정 */}
            <div
              className="no-print mb-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}
            >
              <span className="font-black tracking-wider">🖱 마커 드래그 가능</span>
              <span className="font-semibold" style={{ color: PAL.inkSoft }}>
                — 숫자 마커를 마우스로 잡아 원하는 위치로 끌어 놓으면 좌표가 자동 저장됩니다 (소수점 6자리, 약 11cm 정밀도). 검색으로 채운 위치를 시각적으로 미세 조정할 때 유용합니다.
              </span>
            </div>
            {/* 라이브 지도 — 화면 전용(인쇄 시 숨김), html2canvas 캡처 대상 */}
            <div ref={mapCaptureRef} className="print:hidden">
              <KakaoMap
                shape={mapShape}
                stops={stops.map((s) => ({
                  productName: s.productName,
                  latitude: typeof s.latitude === 'number' ? s.latitude : undefined,
                  longitude: typeof s.longitude === 'number' ? s.longitude : undefined,
                }))}
                onDragEnd={(idx, lat, lng) =>
                  patchStop(idx, { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) })
                }
              />
            </div>
            {/* 인쇄용 지도 이미지 — 화면 숨김, 인쇄 시 표시 (html2canvas 캡처 결과) */}
            {printMapSrc && (
              <img
                src={printMapSrc}
                alt="일정 지도 (인쇄용)"
                className="hidden w-full rounded-2xl border print:block"
                style={{ borderColor: PAL.line }}
              />
            )}
          </CardContent>
        </Card>

        {/* BEP + 매트릭스 */}
        <div className="grid gap-3 md:grid-cols-12">
          <Card className="md:col-span-12 lg:col-span-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base" title="채널 순수익 = 판매가 × (1 − 수수료 − 카드%). BEP = ceil(공통비 / (순수익 − 인당 항목))">
                채널별 손익분기 (BEP)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {channelAnalysis.bep.byChannel.map((b) => {
                const ch = channels.find((c) => c.code === b.channelCode);
                if (!ch) return null;
                return (
                  <div key={b.channelCode} className="flex items-center justify-between rounded-lg border bg-white px-4 py-3" style={{ borderColor: PAL.line }}>
                    <div>
                      <div className="text-base font-bold">{ch.name}</div>
                      <div className="text-xs font-semibold tabular-nums mt-0.5" style={{ color: PAL.mute }}>
                        수수료 {(ch.commission * 100).toFixed(1)}%
                        {ch.cardFee > 0 && ` · 카드 ${(ch.cardFee * 100).toFixed(1)}%`}
                      </div>
                    </div>
                    <div className="text-2xl font-black tabular-nums" style={{ color: b.breakEvenN !== null ? PAL.emerald : PAL.mute }}>
                      {b.breakEvenN !== null ? `${b.breakEvenN}명` : '—'}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="md:col-span-12 lg:col-span-8">
            <CardHeader className="pb-2">
              <CardTitle
                className="text-base"
                title="행=인원(5명 단위) × 열=활성 채널. 각 셀 = 해당 인원에서 그 채널로 운영 시 N명 채널 총 수익(₩) + 1인 순수익(₩). 초록=흑자, 자홍=손실. 🎯 표시 행은 BEP, ⭐ 표시 셀은 각 채널 첫 흑자 셀."
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span>인원 × 채널 수익 매트릭스</span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold ring-1 tabular-nums" style={{ color: PAL.violet, boxShadow: `inset 0 0 0 1px ${PAL.line}` }}>
                    판매가 {won(salePrice)} 기준
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold ring-1" style={{ color: PAL.emerald, boxShadow: `inset 0 0 0 1px ${PAL.line}` }}>
                    각 셀 = N명 총 수익 · 1인 순수익
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* 산식 안내 — 사용자가 셀 수치를 직접 검증 가능하도록 산출 과정 명시 */}
              <div
                className="mb-3 rounded-xl border-l-4 px-4 py-3"
                style={{ borderColor: PAL.violet, backgroundColor: 'rgba(110, 55, 204, 0.04)' }}
              >
                <div className="mb-2 text-xs font-black tracking-wider" style={{ color: PAL.violet }}>
                  💡 수익 산식 (모든 금액 VAT 포함 동일 기준)
                </div>
                <div className="grid gap-2 text-xs leading-relaxed sm:grid-cols-2" style={{ color: PAL.inkSoft }}>
                  <div className="space-y-1 rounded-lg bg-white p-2.5 border" style={{ borderColor: PAL.line }}>
                    <div className="font-black" style={{ color: PAL.emerald }}>① 수수료 뺀 판매가 합계 (매출)</div>
                    <div className="tabular-nums">
                      판매가 <strong>{won(salePrice)}</strong> × (1 − 수수료 − 카드%) = 채널 수령가 / 1인
                    </div>
                    <div className="tabular-nums" style={{ color: PAL.mute }}>
                      예: 판매가 ₩200,000 × (1 − 30%) = 수령가 ₩140,000 → N명 × ₩140,000
                    </div>
                  </div>
                  <div className="space-y-1 rounded-lg bg-white p-2.5 border" style={{ borderColor: PAL.line }}>
                    <div className="font-black" style={{ color: PAL.rose }}>② 총 원가 합계</div>
                    <div className="tabular-nums">
                      N × 1인 단가 <strong>{won(cost.byTier.adult?.perPersonItems ?? 0)}</strong> + 차량·가이드 <strong>{won(cost.partySharedTotal)}</strong>
                    </div>
                    <div className="tabular-nums" style={{ color: PAL.mute }}>
                      개인 비용은 각자 × N + 그룹 공통은 1회만
                    </div>
                  </div>
                  <div className="sm:col-span-2 rounded-lg p-2.5 border-2 tabular-nums text-sm" style={{ borderColor: PAL.violet, backgroundColor: 'white' }}>
                    <span className="font-black" style={{ color: PAL.violet }}>③ 채널 총 수익 = ① − ②</span>
                    <span className="ml-2 font-bold" style={{ color: PAL.inkSoft }}>
                      = N × [채널 수령가 − 1인 단가] − (차량+가이드)
                    </span>
                    <span className="ml-2 text-xs font-semibold" style={{ color: PAL.mute }}>
                      → 매트릭스 각 셀에 채널별 N명 총 수익(₩) + 1인 순수익(₩) 표시. 0 이상 첫 행 = <strong style={{ color: PAL.rose }}>BEP</strong> 🎯
                    </span>
                  </div>
                </div>
              </div>
              {/* 모바일 (< lg): 카드 적층 뷰 */}
              <div className="lg:hidden space-y-2">
                {channelAnalysis.matrix.map((row) => {
                  const isBepRow = (row.bepFor?.length ?? 0) > 0;
                  return (
                    <div
                      key={`m-${row.pax}`}
                      className="rounded-xl border-2 p-3"
                      style={{
                        borderColor: isBepRow ? PAL.rose : PAL.line,
                        backgroundColor: isBepRow ? 'rgba(192, 48, 107, 0.04)' : 'white',
                      }}
                    >
                      <div className="mb-2 flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-black tabular-nums">{row.pax}명</span>
                          {isBepRow && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide" style={{ backgroundColor: PAL.rose, color: 'white' }}>
                              🎯 BEP
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-bold tabular-nums" style={{ color: PAL.inkSoft }}>
                          1인 원가 {won(row.costPerAdult)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                        {row.cells.map((cell) => {
                          const ch = channels.find((c) => c.code === cell.channelCode);
                          const isFirstProfit =
                            cell.profitRate >= 0 && firstProfitablePaxByChannel.get(cell.channelCode) === row.pax;
                          // 1인 순수익(₩) = 채널 수령가 − 1인 원가
                          const profitPerHead = ch
                            ? salePrice * (1 - ch.commission - ch.cardFee) - row.costPerAdult
                            : 0;
                          // N명 채널 총 수익 = 1인 순수익 × 인원
                          const channelTotal = profitPerHead * row.pax;
                          const positive = cell.profitRate >= 0;
                          return (
                            <div
                              key={cell.channelCode}
                              className="rounded-md border px-1.5 py-1 leading-tight"
                              style={{
                                borderColor: isFirstProfit ? PAL.emerald : PAL.line,
                                backgroundColor: isFirstProfit ? 'rgba(19, 128, 96, 0.08)' : 'white',
                              }}
                              title={`${ch?.name ?? cell.channelCode} — 1인 순수익 ${won(profitPerHead)} (= 수령가 ${won(salePrice * (1 - (ch?.commission ?? 0) - (ch?.cardFee ?? 0)))} − 1인 원가 ${won(row.costPerAdult)}). ${row.pax}명 운영 시 채널 총 수익 ${won(channelTotal)}.`}
                            >
                              <div className="truncate text-[10px] font-bold" style={{ color: PAL.mute }}>
                                {ch?.name ?? cell.channelCode}
                              </div>
                              <div className="text-sm font-black tabular-nums" style={{ color: positive ? PAL.emerald : PAL.rose }}>
                                {salePrice > 0 ? won(channelTotal) : '—'}
                                {isFirstProfit && <span className="ml-1 text-[10px]">⭐</span>}
                              </div>
                              <div className="text-[10px] font-semibold tabular-nums" style={{ color: positive ? PAL.emerald : PAL.rose, opacity: 0.85 }}>
                                1인 {salePrice > 0 ? won(profitPerHead) : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 데스크톱 (≥ lg): 표 뷰 */}
              <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="border-b-2 text-left text-sm font-bold" style={{ borderColor: PAL.rose, color: PAL.inkSoft }}>
                    <th className="py-3 pr-3" title="총 인원수">인원</th>
                    <th className="py-3 pr-3" title="개별(관광·식사·체험 1인 합) + 공통(차량+가이드) ÷ 인원">
                      1인 원가
                      <span className="ml-1 text-xs font-normal" style={{ color: PAL.mute }}>(개별 + 공통/N)</span>
                    </th>
                    {channelAnalysis.matrix[0]?.cells.map((cell) => {
                      const ch = channels.find((c) => c.code === cell.channelCode);
                      return (
                        <th key={cell.channelCode} className="py-3 pr-3 text-right" title={`${ch?.name ?? cell.channelCode} — 그 인원에서 이 채널로 운영했을 때 N명 채널 총 수익(₩) + 1인 순수익(₩)`}>
                          {ch?.name ?? cell.channelCode}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {channelAnalysis.matrix.map((row) => {
                    const isBepRow = (row.bepFor?.length ?? 0) > 0;
                    return (
                      <tr
                        key={row.pax}
                        className="border-b"
                        style={{
                          borderColor: '#F3F0E8',
                          backgroundColor: isBepRow ? 'rgba(192, 48, 107, 0.06)' : undefined,
                        }}
                        title={isBepRow ? `BEP 인원 — ${row.bepFor!.map((c) => channels.find((ch) => ch.code === c)?.name ?? c).join(' / ')} 채널 손익분기` : undefined}
                      >
                        <td className="py-2.5 pr-3 text-base font-bold tabular-nums">
                          {row.pax}명
                          {isBepRow && (
                            <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide" style={{ backgroundColor: PAL.rose, color: 'white' }}>
                              🎯 BEP
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-sm font-semibold tabular-nums" style={{ color: PAL.inkSoft }}>{won(row.costPerAdult)}</td>
                        {row.cells.map((cell) => {
                          const isFirstProfit =
                            cell.profitRate >= 0 && firstProfitablePaxByChannel.get(cell.channelCode) === row.pax;
                          const ch = channels.find((c) => c.code === cell.channelCode);
                          // 1인 순수익 = 채널 수령가 − 1인 원가
                          const profitPerHead = ch
                            ? salePrice * (1 - ch.commission - ch.cardFee) - row.costPerAdult
                            : 0;
                          // N명 채널 총 수익 = 1인 순수익 × 인원
                          const channelTotal = profitPerHead * row.pax;
                          const positive = cell.profitRate >= 0;
                          return (
                            <td
                              key={cell.channelCode}
                              className="px-2 py-1.5 text-right tabular-nums leading-tight"
                              style={{
                                color: positive ? PAL.emerald : PAL.rose,
                                backgroundColor: isFirstProfit ? 'rgba(19, 128, 96, 0.10)' : undefined,
                                outline: isFirstProfit ? `2px solid ${PAL.emerald}` : undefined,
                                outlineOffset: isFirstProfit ? '-3px' : undefined,
                                borderRadius: isFirstProfit ? '6px' : undefined,
                              }}
                              title={`${ch?.name ?? cell.channelCode} — ${row.pax}명 운영 시 채널 총 수익 ${won(channelTotal)} (= 1인 순수익 ${won(profitPerHead)} × ${row.pax}명). 1인 순수익 = 채널 수령가 ${won(salePrice * (1 - (ch?.commission ?? 0) - (ch?.cardFee ?? 0)))} − 1인 원가 ${won(row.costPerAdult)}.${isFirstProfit ? ' ⭐ 이 채널 첫 흑자 진입 셀.' : ''}`}
                            >
                              <div className="text-base font-black">
                                {salePrice > 0 ? won(channelTotal) : '—'}
                                {isFirstProfit && <span className="ml-1 text-[10px]">⭐</span>}
                              </div>
                              <div className="text-[10px] font-semibold" style={{ opacity: 0.8 }}>
                                1인 {salePrice > 0 ? won(profitPerHead) : '—'}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* 채널별 흑자 전환 인원 + 의사결정 보고문 */}
              {salePrice > 0 && cost.costPerAdult > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {channelAnalysis.bep.byChannel.map((b) => {
                      const ch = channels.find((c) => c.code === b.channelCode);
                      const reachable = b.breakEvenN !== null && b.breakEvenN <= partyTotal;
                      return (
                        <div
                          key={b.channelCode}
                          className="rounded-xl border-2 bg-white p-3"
                          style={{ borderColor: b.breakEvenN !== null ? PAL.rose : PAL.line }}
                        >
                          <div className="text-sm font-bold" style={{ color: PAL.mute }}>
                            {ch?.name}
                          </div>
                          <div className="mt-2 flex items-baseline gap-1.5">
                            <span
                              className="text-4xl font-black tabular-nums"
                              style={{ color: b.breakEvenN !== null ? PAL.rose : PAL.mute }}
                            >
                              {b.breakEvenN ?? '—'}
                            </span>
                            <span
                              className="text-base font-bold"
                              style={{ color: b.breakEvenN !== null ? PAL.rose : PAL.mute }}
                            >
                              {b.breakEvenN !== null ? '명부터 수익 발생' : '도달 불가'}
                            </span>
                          </div>
                          {b.breakEvenN !== null && partyTotal > 0 && (
                            <div className="mt-2 text-sm font-bold" style={{ color: reachable ? PAL.emerald : PAL.amber }}>
                              {reachable ? `✓ 현재 ${partyTotal}명 충족` : `현재 ${partyTotal}명 · ${b.breakEvenN - partyTotal}명 부족`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 종합 의사결정 보고문 */}
                  <div
                    className="rounded-xl border-l-4 p-4 text-sm leading-relaxed"
                    style={{ borderColor: PAL.rose, backgroundColor: 'rgba(192, 48, 107, 0.05)', color: PAL.ink }}
                  >
                    <div className="mb-2 text-xs font-bold tracking-wider" style={{ color: PAL.rose }}>
                      📑 수익 전환 분석 — 의사결정 보고
                    </div>
                    <p>
                      <strong className="text-base" style={{ color: PAL.rose }}>『{packageName || '(상품명 미입력)'}』</strong>의{' '}
                      <strong className="text-base">1인 원가 {won(cost.costPerAdult)}</strong> (개별 {won(cost.byTier.adult?.perPersonItems ?? 0)} + 공통 {won(cost.perPersonShared)}) 이며,
                      판매가 <strong className="text-base" style={{ color: PAL.violet }}>{won(salePrice)}</strong> 책정 시
                      최선 채널 기준 <strong className="text-base" style={{ color: PAL.rose }}>{channelAnalysis.bep.bestMin ?? '—'}명 이상</strong> 모객해야 수익이 발생합니다.
                      {channelAnalysis.bep.worstMax !== null && channelAnalysis.bep.worstMax !== channelAnalysis.bep.bestMin && (
                        <> 최열위 채널은 <strong style={{ color: PAL.rose }}>{channelAnalysis.bep.worstMax}명 이상</strong> 필요.</>
                      )}
                    </p>
                    {partyTotal > 0 && channelAnalysis.bep.bestMin !== null && (
                      <p className="mt-2 font-semibold">
                        현재 인원 <strong>{partyTotal}명</strong> 기준 —{' '}
                        {partyTotal >= channelAnalysis.bep.bestMin ? (
                          <span style={{ color: PAL.emerald }}>✅ 수익 발생 구간 진입 (최선 채널 BEP {channelAnalysis.bep.bestMin}명 충족)</span>
                        ) : (
                          <span style={{ color: PAL.rose }}>⚠ 최소 {channelAnalysis.bep.bestMin - partyTotal}명 추가 모객 필요</span>
                        )}
                      </p>
                    )}
                    {partyTotal === 0 && (
                      <p className="mt-2 text-xs" style={{ color: PAL.mute }}>
                        ※ 상단 인원 입력 시 수익 발생 여부가 자동 판정됩니다.
                      </p>
                    )}
                  </div>

                  {/* 채널별 최소 판매가 + 최소 탑승 + 종합 권장 운영 텍스트 */}
                  <div
                    className="rounded-xl border-l-4 p-4"
                    style={{ borderColor: PAL.violet, backgroundColor: 'rgba(110, 55, 204, 0.05)' }}
                  >
                    <div className="mb-3 text-xs font-black tracking-wider" style={{ color: PAL.violet }}>
                      📌 운영 기준 자동 산출 — 최소 판매가 · 최소 탑승 인원
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* 채널별 최소 판매가 (현재 인원 기준) */}
                      <div>
                        <div className="mb-1.5 text-xs font-bold" style={{ color: PAL.inkSoft }}>
                          💵 채널별 최소 판매가
                          <span className="ml-1 text-[10px] font-normal" style={{ color: PAL.mute }}>
                            (현재 {partyTotal || '입력'}명 기준 1인 원가 회수)
                          </span>
                        </div>
                        <ul className="space-y-1 text-sm tabular-nums">
                          {channels.filter((c) => c.enabled).map((c) => {
                            const denom = 1 - c.commission - c.cardFee;
                            const minSale = denom > 0 && cost.costPerAdult > 0 ? Math.ceil(cost.costPerAdult / denom) : null;
                            return (
                              <li key={c.code} className="flex items-baseline justify-between border-b pb-1" style={{ borderColor: '#E4DCF6' }}>
                                <span className="text-xs font-semibold" style={{ color: PAL.mute }}>{c.name}</span>
                                <span className="font-black" style={{ color: minSale !== null ? PAL.ink : PAL.mute }}>
                                  {minSale !== null ? `${won(minSale)} 이상` : '—'}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      {/* 채널별 최소 탑승 (현재 판매가 기준) */}
                      <div>
                        <div className="mb-1.5 text-xs font-bold" style={{ color: PAL.inkSoft }}>
                          👥 채널별 최소 탑승 인원
                          <span className="ml-1 text-[10px] font-normal" style={{ color: PAL.mute }}>
                            (판매가 {won(salePrice)} 기준 BEP)
                          </span>
                        </div>
                        <ul className="space-y-1 text-sm tabular-nums">
                          {channelAnalysis.bep.byChannel.map((b) => {
                            const ch = channels.find((c) => c.code === b.channelCode);
                            if (!ch) return null;
                            return (
                              <li key={b.channelCode} className="flex items-baseline justify-between border-b pb-1" style={{ borderColor: '#E4DCF6' }}>
                                <span className="text-xs font-semibold" style={{ color: PAL.mute }}>{ch.name}</span>
                                <span className="font-black" style={{ color: b.breakEvenN !== null ? PAL.ink : PAL.rose }}>
                                  {b.breakEvenN !== null ? `${b.breakEvenN}명 이상` : '도달 불가'}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>

                    {/* 종합 권장 — 자연어 문장 */}
                    <div className="mt-3 border-t pt-3" style={{ borderColor: PAL.violet }}>
                      <div className="mb-1 text-xs font-black tracking-wider" style={{ color: PAL.violet }}>
                        ⭐ 종합 운영 권장
                      </div>
                      {(() => {
                        const otaBep = channelAnalysis.bep.byChannel.find((b) => b.channelCode === 'global-ota')?.breakEvenN ?? null;
                        const selfOffBep = channelAnalysis.bep.byChannel.find((b) => b.channelCode === 'self-offline')?.breakEvenN ?? null;
                        const selfOnBep = channelAnalysis.bep.byChannel.find((b) => b.channelCode === 'self-online')?.breakEvenN ?? null;
                        if (otaBep === null && selfOffBep === null && selfOnBep === null) {
                          return (
                            <p className="text-sm font-bold" style={{ color: PAL.rose }}>
                              ⚠ 현재 판매가 {won(salePrice)} 기준 전 채널 수익 발생 불가 — 판매가 인상 또는 1인 원가 절감 필요
                            </p>
                          );
                        }
                        return (
                          <p className="text-sm leading-relaxed" style={{ color: PAL.ink }}>
                            본 패키지 <strong style={{ color: PAL.rose }}>『{packageName || '(상품명 미입력)'}』</strong>은
                            판매가 <strong style={{ color: PAL.violet }}>{won(salePrice)}</strong> 기준 —
                            {selfOffBep !== null && (
                              <> 자체 모객(오프라인) 채널만 활용 시 <strong style={{ color: PAL.emerald }}>{selfOffBep}명 이상</strong>,</>
                            )}
                            {selfOnBep !== null && (
                              <> 자체 온라인 포함 시 <strong style={{ color: PAL.emerald }}>{selfOnBep}명 이상</strong>,</>
                            )}
                            {otaBep !== null ? (
                              <> 글로벌 OTA 등록 판매까지 포함 시 <strong style={{ color: PAL.rose }}>{otaBep}명 이상</strong> 탑승 시 수익 발생.</>
                            ) : (
                              <> 글로벌 OTA는 현재 판매가에서 도달 불가 (수수료 30% 차감 후 적자) — OTA 활용하려면 판매가 인상 필요.</>
                            )}
                            {' '}
                            <strong style={{ color: PAL.ink }}>
                              따라서 본 상품은 최소 판매가 {(() => {
                                const otaCh = channels.find((c) => c.code === 'global-ota');
                                if (otaCh && cost.costPerAdult > 0) {
                                  const denom = 1 - otaCh.commission - otaCh.cardFee;
                                  if (denom > 0) {
                                    return won(Math.ceil(cost.costPerAdult / denom));
                                  }
                                }
                                return won(salePrice);
                              })()} 이상으로 판매하고, 최소 탑승 인원 {otaBep ?? selfOnBep ?? selfOffBep ?? '—'}명 이상으로 출발 확정해야 모든 채널에서 안정적 수익 발생이 보장됩니다.
                            </strong>
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 2단계 캠페인 시뮬레이션 */}
        <CampaignSimulator
          perPersonItems={cost.byTier.adult?.perPersonItems ?? 0}
          partySharedTotal={cost.partySharedTotal}
          salePrice={salePrice}
        />

        {/* 일정 요약 */}
        {stops.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" title="전체 일정의 좌표 커버리지·체류시간·이동시간·총 소요·1인 원가를 한눈에 요약. 청록=체류, 보라=이동, 분홍=합계 색상 일관 적용.">
                전체 일정 · 동선 요약
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryBox label="⏱ 총 체류시간" value={formatMin(itinerary.totalStayMin)} tone="teal" />
              <SummaryBox label="총 이동" value={formatMin(itinerary.totalTravelMin)} tone="violet" />
              <SummaryBox label="전체" value={formatMin(itinerary.totalMin)} tone="rose" />
              <SummaryBox
                label="이동 구간"
                value={`${itinerary.legs.filter((l) => l.km !== null).length}/${itinerary.legs.length}`}
                tone="emerald"
              />
            </CardContent>
          </Card>
        )}

        {/* 매뉴얼 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base" title="이 도구의 작동 방식·BEP 산식·매트릭스 의미·이동시간 계산 모드(자동·수동·카카오 실시간) 등 핵심 도메인 용어를 한 곳에서 정리한 매뉴얼. 처음 사용 시 한 번 훑으면 매트릭스 해석이 빨라집니다.">
              사용 매뉴얼 · 도메인 용어
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3" style={{ color: PAL.inkSoft }}>
              <Manual num={1} title="패키지 상품명">최상단 입력란에 상품명 입력 — 매트릭스 보고문에 자동 인용 (예: "서울 시티투어 1일")</Manual>
              <Manual num={2} title="인원 입력">통합(성인 기준 1명) / 구분(성인 1.0·청소년 0.7·어린이 0.5·유아 0.0) 모드 선택. 공통비를 인원으로 나눔</Manual>
              <Manual num={3} title="차량·가이드">차종/언어 선택 + 1일 단가 + 운영 일수. 차량비는 차량+기사팁 포함. 좌석 ≥ 인원 자동 검증</Manual>
              <Manual num={4} title="일정 카드 추가">색상 버튼(출발·경유·관광·식사·체험·도착)으로 추가. 카드 빈 영역을 잡아 드래그하면 순서 재배치</Manual>
              <Manual num={5} title="장소 검색">카드 안 🔍 검색창에 "명동역" 등 입력 → Enter. 결과 클릭 시 주소·위도·경도 자동 채움. 지도 마커 드래그로 미세 조정</Manual>
              <Manual num={6} title="가격 통합/구분">관광·식사·체험만. 통합=성인가×연령가중 / 구분=tier별 직접 가격. 출발·경유·도착은 가격 0</Manual>
              <Manual num={7} title="채널 편집 (3채널)">자체 모객(오프) 0%·0% / 자체 온라인 0%·4.5% / 글로벌 OTA 30%·0%. 수수료·카드% 칸 클릭 후 직접 수정 (소수점 가능)</Manual>
              <Manual num={8} title="매트릭스·BEP">행=5~45명 × 열=3채널. 초록=흑자·자홍=손실. 표 아래 채널별 흑자 전환 인원 카드 + 의사결정 보고문 자동 생성</Manual>
              <Manual num={9} title="이동시간 — 3가지 모드">① 자동 추정 (좌표 기반 Haversine × 1.3 ÷ 25km/h) ② 분 input에 직접 입력하면 수동값 우선 ③ 🚗 카카오로 실시간 갱신 (좌표 있는 leg 일괄 호출, REST 키 `.env.local` 필요)</Manual>
            </ol>
          </CardContent>
        </Card>

        {/* 플랫폼 소개 카피 — 모바일은 하단(lg 미만에서만 표시) */}
        <PlatformPitch placement="bottom" />
      </main>
    </div>
  );
}

// ──────────────── 장소 검색 (카카오 Places) ────────────────
function PlaceSearch({ onSelect }: { onSelect: (p: PlaceResult) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  // 마운트 시 SDK 사전 로드 — 사용자가 검색 누르기 전에 미리 준비
  useEffect(() => {
    let mounted = true;
    ensureKakaoSdk().then((ok) => {
      if (mounted) setSdkReady(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const doSearch = async () => {
    const term = q.trim();
    if (term.length < 2) {
      setErr('2글자 이상 입력');
      return;
    }
    setErr(null);
    setLoading(true);
    setOpen(true);
    // SDK 재보장 — sdkReady false여도 다시 시도
    const ok = await ensureKakaoSdk();
    setSdkReady(ok);
    if (!ok) {
      setLoading(false);
      setErr('카카오 SDK 로드 실패 — F12 콘솔의 [KakaoMap] 메시지 확인');
      return;
    }
    const r = await kakaoPlacesSearch(term);
    setResults(r);
    setLoading(false);
    if (r.length === 0) setErr('결과 없음 — 다른 키워드로 재시도');
  };

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSearch();
            }
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="🔍 장소·주소 검색 (예: 명동역)"
          className="h-9 flex-1 rounded-md border bg-white px-2.5 text-sm font-medium focus:outline-none"
          style={{ borderColor: PAL.line }}
        />
        <button
          type="button"
          onClick={doSearch}
          disabled={loading || !sdkReady}
          className="h-9 shrink-0 rounded-md px-3 text-sm font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: PAL.rose }}
          title={sdkReady ? '카카오 장소·주소 검색' : 'SDK 로드 중…'}
        >
          {loading ? '검색 중…' : !sdkReady ? 'SDK 로드 중' : '검색'}
        </button>
      </div>
      {err && (
        <div className="mt-1 text-xs font-semibold" style={{ color: PAL.rose }}>
          {err}
        </div>
      )}
      {!err && !sdkReady && q.trim().length >= 2 && (
        <div className="mt-1 text-xs font-semibold" style={{ color: PAL.amber }}>
          카카오 SDK 로드 중… 잠시 후 검색 가능
        </div>
      )}
      {open && results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-56 overflow-y-auto rounded-md border bg-white shadow-lg"
          style={{ borderColor: PAL.line }}
        >
          <div className="border-b px-3 py-2 text-xs font-bold" style={{ borderColor: PAL.line, color: PAL.mute }}>
            결과 {results.length}건 — 클릭해서 선택
          </div>
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onSelect(r);
                setQ('');
                setResults([]);
                setOpen(false);
                setErr(null);
              }}
              className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-rose-50 last:border-b-0"
              style={{ borderColor: PAL.line }}
            >
              <div className="truncate font-bold" style={{ color: PAL.ink }}>
                {r.name}
              </div>
              <div className="truncate text-xs font-medium mt-0.5" style={{ color: PAL.mute }}>
                {r.address || r.category || '주소 미상'}
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full px-2 py-1.5 text-center text-xs font-semibold hover:bg-gray-50"
            style={{ color: PAL.mute }}
          >
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────── 일정 카드 ────────────────
function StopCard({
  index,
  total,
  stop,
  schedule,
  onPatch,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  stop: StopRow;
  schedule: { arrive: number; depart: number; fixed?: boolean } | null;
  onPatch: (p: Partial<StopRow>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const meta = STOP_META[stop.stopType];
  return (
    <div
      className="flex w-[340px] shrink-0 flex-col gap-2 rounded-2xl border-2 bg-white p-3"
      style={{ borderColor: meta.color }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-black leading-none" style={{ color: meta.color }} title={`일정 순서 ${index + 1}`}>
            {circleNum(index + 1)}
          </span>
          <select
            value={stop.stopType}
            onChange={(e) => onPatch({ stopType: e.target.value as StopType })}
            className="h-7 rounded-full px-2.5 text-xs font-bold"
            style={{ color: meta.color, backgroundColor: meta.bg, border: 'none' }}
            title="이 카드의 유형 (출발·경유·관광·식사·체험·도착). 색상이 함께 바뀝니다. 출발·경유·도착은 가격이 없고, 관광·식사·체험만 가격 입력이 활성됩니다."
            aria-label="일정 유형"
          >
            {STOP_ORDER.map((t) => (
              <option key={t} value={t}>
                {STOP_META[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-0.5 text-xs" style={{ color: PAL.mute }}>
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="px-1 disabled:opacity-30" title="이 카드를 한 칸 앞으로 이동 (드래그로도 순서 변경 가능)" aria-label="앞으로 이동">←</button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="px-1 disabled:opacity-30" title="이 카드를 한 칸 뒤로 이동 (드래그로도 순서 변경 가능)" aria-label="뒤로 이동">→</button>
          <button type="button" onClick={onRemove} className="px-1 font-bold" style={{ color: PAL.rose }} title="이 일정 카드를 영구 삭제 (되돌리기 없음)" aria-label="이 카드 삭제">×</button>
        </div>
      </div>

      {schedule && (
        <div className="flex flex-col gap-1">
          <div
            className="rounded-md text-center text-sm font-black tabular-nums"
            style={{
              color: schedule.fixed ? PAL.amber : meta.color,
              backgroundColor: schedule.fixed ? PAL.amberPale : meta.bg,
              padding: '6px 8px',
            }}
          >
            {schedule.fixed && '🔒 '}{fmtTime(schedule.arrive)} 도착
            {stop.stayMin > 0 && (
              <>
                {' '}→ {fmtTime(schedule.depart)} 출발
                <span
                  className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-black"
                  style={{ backgroundColor: PAL.tealPale, color: PAL.teal }}
                >
                  ⏱ 체류시간 {stop.stayMin}분
                </span>
              </>
            )}
          </div>
          {/* 도착시각 고정 — 값이 있으면 누적 계산을 무시하고 이 시각으로 도착을 못박는다 (공연 시작·식당 예약 등). 이후 카드는 이 시각(+체류)부터 누적 재시작. */}
          <div className="flex items-center justify-center gap-1 text-[11px]">
            {stop.arriveFixed ? (
              <>
                <span className="font-bold" style={{ color: PAL.amber }}>🔒 도착 고정</span>
                <input
                  type="time"
                  value={stop.arriveFixed}
                  onChange={(e) => onPatch({ arriveFixed: e.target.value })}
                  className="h-6 rounded border px-1 text-[11px] font-bold tabular-nums"
                  style={{ borderColor: PAL.amber, color: PAL.amber }}
                  aria-label="고정 도착시각"
                  title="이 시각으로 도착을 고정합니다. 이후 카드는 이 시각(+체류)부터 누적 재계산됩니다."
                />
                <button
                  type="button"
                  onClick={() => onPatch({ arriveFixed: '' })}
                  className="rounded border px-1.5 py-0.5 font-bold"
                  style={{ borderColor: PAL.line, color: PAL.mute }}
                  title="도착시각 고정 해제 — 자동 누적 계산으로 복귀"
                >
                  해제
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onPatch({ arriveFixed: fmtTime(schedule.arrive % 1440) })}
                className="rounded border px-1.5 py-0.5 font-semibold"
                style={{ borderColor: PAL.line, color: PAL.mute }}
                title="현재 도착시각을 고정값으로 못박습니다 (공연 시작·식당 예약 등 시간 제약). 이후 카드는 이 시각부터 누적 재계산됩니다."
                aria-label="도착시각 고정"
              >
                🕐 도착시각 고정
              </button>
            )}
          </div>
        </div>
      )}

      <Input
        type="text"
        value={stop.productName}
        onChange={(e) => onPatch({ productName: e.target.value })}
        placeholder="상품명 (직접 입력 — 예: 경복궁 오전 관람)"
        className="h-9 text-base font-bold"
      />
      <Input
        type="text"
        value={stop.note}
        onChange={(e) => onPatch({ note: e.target.value })}
        placeholder="비고 (선택 — 메모·추가 설명)"
        className="h-9 text-sm"
      />
      <PlaceSearch
        onSelect={(p) =>
          onPatch({
            address: p.address,
            latitude: Number(p.lat.toFixed(6)),
            longitude: Number(p.lng.toFixed(6)),
          })
        }
      />
      <Input
        type="text"
        value={stop.address}
        onChange={(e) => onPatch({ address: e.target.value })}
        placeholder="주소 (검색으로 자동 또는 직접 입력)"
        className="h-9 text-sm"
      />
      <div className="grid grid-cols-3 gap-1.5">
        <NumField label="위도" value={stop.latitude === '' ? 0 : stop.latitude} onChange={(n) => onPatch({ latitude: n === 0 ? '' : n })} step={0.0001} small tooltip="장소의 위도(33~39 한국 영역). 🔍 검색이나 지도 마커 드래그로 자동 채움. 비우면 동선·이동시간 계산에서 제외." />
        <NumField label="경도" value={stop.longitude === '' ? 0 : stop.longitude} onChange={(n) => onPatch({ longitude: n === 0 ? '' : n })} step={0.0001} small tooltip="장소의 경도(124~132 한국 영역). 🔍 검색이나 지도 마커 드래그로 자동 채움. 위도와 함께 있어야 이동시간 산출 가능." />
        <div className="rounded-md p-1" style={{ backgroundColor: PAL.tealPale }}>
          <NumField label="⏱ 체류시간(분)" value={stop.stayMin} onChange={(n) => onPatch({ stayMin: n })} step={5} small tooltip="권장 체류시간 — 동선 합산에 사용. 청록색 강조" />
        </div>
      </div>
      {meta.hasPrice && (
        <div className="mt-1 space-y-2 rounded-lg p-2.5" style={{ backgroundColor: PAL.bg }}>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold" style={{ color: PAL.inkSoft }}>가격</Label>
            <ModeToggle off="통합" on="구분" checked={stop.tiered} onChange={(b) => onPatch({ tiered: b })} />
          </div>
          {!stop.tiered ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <NumField label="성인 가격 (통합)" value={stop.unifiedPrice} onChange={(n) => onPatch({ unifiedPrice: n })} step={1000} currency tooltip="천원 단위" />
              </div>
              <label className="pb-1.5 flex items-center gap-1 text-[10px] whitespace-nowrap" style={{ color: PAL.inkSoft }} title="ON: 청소년·어린이·유아는 multiplier로 자동 할인 / OFF: 모든 tier 동일 가격">
                <input type="checkbox" checked={stop.applyAgeTier} onChange={(e) => onPatch({ applyAgeTier: e.target.checked })} />
                연령가중
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="성인" value={stop.adultPrice} onChange={(n) => onPatch({ adultPrice: n })} step={1000} currency tooltip="성인 1인 입장료·식대·체험비. 천원 단위. 통합 모드는 가중치 자동 적용, 구분 모드는 연령별 직접 입력." />
              <NumField label="청소년" value={stop.youthPrice} onChange={(n) => onPatch({ youthPrice: n })} step={1000} currency tooltip="청소년(만 13~18세) 1인 가격. 천원 단위. 보통 성인의 70% 수준." />
              <NumField label="어린이" value={stop.childPrice} onChange={(n) => onPatch({ childPrice: n })} step={1000} currency tooltip="어린이(만 4~12세) 1인 가격. 천원 단위. 보통 성인의 50% 수준. 유아(만 0~3세)는 보통 무료." />
              <div>
                <Label className="text-xs" style={{ color: PAL.mute }}>유아</Label>
                <div className="flex h-9 items-center justify-center rounded-md border bg-white text-sm font-semibold" style={{ borderColor: PAL.line, color: PAL.mute }}>
                  ₩0
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────── 작은 컴포넌트 ────────────────
function NumField({
  label,
  value,
  onChange,
  step = 1,
  small,
  tooltip,
  currency,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  small?: boolean;
  tooltip?: string;
  currency?: boolean;
}) {
  const id = useId();
  // draft 패턴 — value=0이면 빈 표시(0 prefix 박멸), focus 중에는 외부 sync 차단, blur 시 정규화
  const [draft, setDraft] = useState<string>(value === 0 ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === 0 ? '' : String(value));
  }, [value, focused]);

  // 자동 fallback — tooltip 미지정 시 label + (currency면 "원 단위 입력" 안내) 자동 표시
  const hover = tooltip ?? `${label}${currency ? ' (원 단위, 숫자 입력)' : ''} — 마우스 휠/화살표로 ${step.toLocaleString('ko-KR')} 단위 조정 가능`;
  return (
    <div>
      <Label htmlFor={id} className={small ? 'text-xs' : 'text-sm'} style={{ color: PAL.mute }} title={hover}>
        {label}
        {currency && value > 0 && (
          <span className="ml-1 font-mono text-xs font-bold" style={{ color: PAL.inkSoft }}>
            ₩{value.toLocaleString('ko-KR')}
          </span>
        )}
        {tooltip && (
          <span aria-hidden className="ml-1 cursor-help text-[10px]" style={{ color: PAL.violet }} title={hover}>ⓘ</span>
        )}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode={currency ? 'numeric' : 'decimal'}
        value={draft}
        step={step}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = Number(draft);
          if (Number.isNaN(n) || draft === '' || draft === '-') {
            setDraft('');
            onChange(0);
          } else {
            // 정규화 (앞 0 제거 + Number → String)
            const normalized = String(n);
            setDraft(normalized);
            onChange(n);
          }
        }}
        onChange={(e) => {
          let v = e.target.value;
          // 숫자·소수점·마이너스만 허용 (빈 문자열 허용)
          if (v === '' || /^-?\d*\.?\d*$/.test(v)) {
            // 맨 앞자리 0 실시간 제거 — "05"→"5", "007"→"7" (단 "0"·"0.5"는 유지)
            if (/^-?0\d/.test(v)) v = v.replace(/^(-?)0+(\d)/, '$1$2');
            setDraft(v);
            const n = Number(v);
            if (!Number.isNaN(n) && v !== '' && v !== '-') onChange(n);
            else if (v === '') onChange(0);
          }
        }}
        className={small ? 'h-9 text-sm tabular-nums' : 'h-10 text-base tabular-nums font-semibold'}
        title={hover}
        aria-label={hover}
        placeholder={currency ? '0' : ''}
      />
    </div>
  );
}

// 수수료·카드% 전용 input — 사용자 입력 중에는 외부 sync 차단하여 자유 입력 보장.
// value는 0~1 소수, 화면 표시는 0~100 (10단위 반올림 — 4.5%·30% 등 표현 가능).
function PercentInput({
  value,
  onChange,
  step = 1,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 10));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(Math.round(value * 1000) / 10));
  }, [value, focused]);

  return (
    <input
      type="number"
      step={step}
      min={0}
      max={100}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = Number(draft);
        if (Number.isNaN(n) || draft === '') {
          setDraft('0');
          onChange(0);
        } else {
          setDraft(String(n));
          onChange(n / 100);
        }
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (!Number.isNaN(n) && e.target.value !== '') onChange(n / 100);
      }}
      className="h-8 w-full rounded border bg-white px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2"
      style={{ borderColor: PAL.line }}
      aria-label={ariaLabel ?? '비율 %'}
      title={`${ariaLabel ?? '비율'} — 0~100 사이 백분율 입력 (예: 30 = 30%). 천분위까지 자동 반영.`}
    />
  );
}

function ModeToggle({
  off,
  on,
  checked,
  onChange,
  hint,
}: {
  off: string;
  on: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  hint?: string;
}) {
  const tip = hint ?? `현재: ${checked ? on : off}. 클릭하여 전환.`;
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border bg-white text-xs" style={{ borderColor: PAL.line }} title={tip}>
      <button
        type="button"
        onClick={() => onChange(false)}
        className="px-2.5 py-0.5 font-semibold"
        style={{ backgroundColor: !checked ? PAL.rose : 'transparent', color: !checked ? '#fff' : PAL.inkSoft }}
        title={`${off} 모드로 전환`}
        aria-label={`${off} 모드로 전환`}
      >
        {off}
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className="px-2.5 py-0.5 font-semibold"
        style={{ backgroundColor: checked ? PAL.rose : 'transparent', color: checked ? '#fff' : PAL.inkSoft }}
        title={`${on} 모드로 전환`}
        aria-label={`${on} 모드로 전환`}
      >
        {on}
      </button>
    </div>
  );
}

const TONE_COLOR: Record<string, string> = {
  rose: PAL.rose,
  emerald: PAL.emerald,
  violet: PAL.violet,
  amber: PAL.amber,
  ink: PAL.ink,
  teal: PAL.teal,
};

function BigStat({
  label,
  value,
  tone,
  tooltip,
  secondary,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONE_COLOR;
  tooltip?: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 elev-sm card-hover" style={{ borderColor: PAL.line }} title={tooltip}>
      <div className="text-sm font-bold" style={{ color: PAL.mute }}>
        {label}
      </div>
      <div className="mt-1.5 text-3xl font-black tracking-tight" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
      {secondary && (
        <div className="mt-1.5 text-xs font-semibold tabular-nums leading-relaxed" style={{ color: PAL.inkSoft }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mini }: { label: string; value: string; mini?: boolean }) {
  return (
    <div className={mini ? 'text-right' : ''}>
      <div className="text-xs font-semibold" style={{ color: PAL.mute }}>{label}</div>
      <div className="text-sm font-black" style={{ color: PAL.ink }}>{value}</div>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONE_COLOR;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 text-center" style={{ borderColor: PAL.line }}>
      <div className="text-sm font-semibold" style={{ color: PAL.mute }}>{label}</div>
      <div className="mt-1.5 text-2xl font-black tabular-nums" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
    </div>
  );
}

function AddBtn({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full px-4 py-1.5 text-sm font-bold disabled:opacity-40 hover:scale-105 transition"
      style={{ backgroundColor: PAL.emeraldPale, color: PAL.emerald }}
    >
      {children}
    </button>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 text-sm font-bold"
      style={{ color: PAL.rose }}
      title="삭제"
    >
      ×
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-5 text-center text-sm font-medium" style={{ borderColor: PAL.line, color: PAL.mute }}>
      {children}
    </p>
  );
}

function Manual({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg border bg-white p-3" style={{ borderColor: PAL.line }}>
      <div className="text-xs font-black tracking-wider" style={{ color: PAL.rose }}>STEP {num}</div>
      <div className="text-base font-bold mt-0.5" style={{ color: PAL.ink }}>{title}</div>
      <div className="mt-1 text-sm leading-relaxed" style={{ color: PAL.inkSoft }}>{children}</div>
    </li>
  );
}

// ──────────────── 플랫폼 소개 카피 (PC 상단 · 모바일 하단) ────────────────
function PlatformPitch({ placement }: { placement: 'top' | 'bottom' }) {
  // PC 상단: lg 이상에서만 노출 / 모바일 하단: lg 미만에서만 노출
  const visibilityClass = placement === 'top' ? 'hidden lg:block' : 'block lg:hidden';
  return (
    <section
      className={`${visibilityClass} rounded-2xl border p-5 sm:p-6`}
      style={{
        borderColor: PAL.line,
        // 단일 톤 부드러운 그라데이션 — 크림(bg)에서 rosePale로만 자연스럽게
        background: `linear-gradient(135deg, ${PAL.bg} 0%, ${PAL.rosePale} 100%)`,
      }}
      aria-label="플랫폼 소개"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-black tracking-widest backdrop-blur-sm ring-1"
          style={{ color: PAL.rose, boxShadow: `inset 0 0 0 1px ${PAL.rosePale}` }}
        >
          ✦ 통합 여행상품 기획 솔루션
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: PAL.mute }}>
          for Inbound Tour Designers
        </span>
      </div>

      <h2
        className="mt-3 text-lg font-black leading-tight sm:text-xl lg:text-2xl"
        style={{ color: PAL.ink }}
      >
        여행상품 기획, <span style={{ color: PAL.rose }}>더 이상 복잡하게 고민하지 마세요.</span>
      </h2>

      <p className="mt-3 text-sm leading-relaxed sm:text-[15px]" style={{ color: PAL.inkSoft }}>
        패키지 상품 구성부터 <strong style={{ color: PAL.ink }}>동선 설계</strong>,
        {' '}<strong style={{ color: PAL.ink }}>소요 시간 배분</strong>, 체험 콘텐츠 구성, 장소별 매력 포인트 정리,
        {' '}<strong style={{ color: PAL.ink }}>직·간접 판매 채널별 판매가 설정</strong>,
        {' '}그리고 <strong style={{ color: PAL.rose }}>BEP(손익분기점) 인원 산정</strong>까지 —
        {' '}여행 일정 기획 과정에서 반복적으로 발생하는 핵심 고민을 한 번에 해결할 수 있는 플랫폼입니다.
      </p>

      <p className="mt-2.5 text-sm leading-relaxed sm:text-[15px]" style={{ color: PAL.inkSoft }}>
        여행사가 보다 효율적으로 상품을 설계하고, 수익성을 검토하며, 실제 판매까지 연결할 수 있도록 지원하는
        {' '}<strong style={{ color: PAL.ink }}>실무 중심의 통합 여행상품 기획 솔루션</strong>입니다.
      </p>

      {/* 핵심 키워드 칩 — 동일 surface 톤 + 좌측 컬러 dot으로 의미 구분 (단조 무드) */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {[
          { label: '동선 설계', color: PAL.violet },
          { label: '시간 배분', color: PAL.amber },
          { label: '체험 콘텐츠', color: PAL.orange },
          { label: '채널별 단가', color: PAL.emerald },
          { label: 'BEP 산정', color: PAL.rose },
        ].map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold ring-1"
            style={{ color: PAL.inkSoft, boxShadow: `inset 0 0 0 1px ${PAL.line}` }}
          >
            <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: chip.color }} aria-hidden="true" />
            {chip.label}
          </span>
        ))}
      </div>
    </section>
  );
}
