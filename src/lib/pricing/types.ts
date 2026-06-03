// 투어 패키지 단가 계산 — 도메인 타입 정의 (제작기획서 v2.1 S07·S19 기준)

export type ProductType =
  | 'half-day'
  | 'full-day'
  | '2d1n'
  | '3d2n'
  | '4d3n'
  | '5d4n'
  | '6d5n'
  | 'longstay';

// 한국 인바운드 실무 4단계 + senior 옵션. 'child'는 사용자 요청 반영(2026-05-29).
export type AgeTierKey = 'adult' | 'youth' | 'child' | 'infant' | 'senior';

export type PaymentType = 'included' | 'free' | 'customer-paid';

// 인당 항목 가격 모드. unified=성인 기준 1개 가격(multiplier 자동), tiered=tier별 직접 가격.
export type PriceMode = 'unified' | 'tiered';

// 일정 구성 요소 타입. departure=출발 / waypoint=경유 / sight=관광지 / meal=식사 / experience=체험 / arrival=도착.
// sight·meal·experience는 가격 있음(included), departure·arrival·waypoint는 기본 free.
export type StopType = 'departure' | 'waypoint' | 'sight' | 'meal' | 'experience' | 'arrival';

// S19+한국 여행업 실무 표준 연령 가중치. user_library에서 덮어쓰기 가능.
// D36 본문은 youth 0.5였으나, 사용자 요청으로 청소년·어린이 4단계 분화 시 child=0.5(원래 D36 값) 차용.
export const DEFAULT_AGE_MULTIPLIER: Record<AgeTierKey, number> = {
  adult: 1.0,
  youth: 0.7, // 청소년 (12~17세, 실무 관례)
  child: 0.5, // 어린이 (3~11세, D36 youth 0.5 차용)
  infant: 0.0, // 유아 (0~2세)
  senior: 0.8,
};

export interface TierInput {
  count: number;
  multiplier: number;
}

// D36 — 인원 유형 2모드. adult 필수, 나머지는 detailed 모드에서 선택 활성.
export interface PartyMode {
  mode: 'simple' | 'detailed';
  tiers: Partial<Record<AgeTierKey, TierInput>> & { adult: TierInput };
}

export interface PerPersonItem {
  categorySlug: string; // D42 8 대분류
  stopType?: StopType; // 기본 'sight' (관광지). departure/arrival은 가격 0.
  productName?: string; // 상품명 (예: "경복궁 입장료", "인천공항 픽업")
  placeId?: string;
  // 위치·동선 (D37)
  address?: string;
  latitude?: number;
  longitude?: number;
  recommendedStayMin?: number; // 권장 체류 시간(분)
  // 가격
  unitPriceKrw: number; // unified 모드 시 성인 기준 가격
  priceMode?: PriceMode; // 기본 'unified'
  pricesByTier?: Partial<Record<AgeTierKey, number>>; // tiered 모드 시 tier별 직접 가격
  applyAgeTier: boolean; // unified 모드에서만 의미 (multiplier 적용 여부)
  paymentType: PaymentType; // included | free | customer-paid (출발/도착은 보통 free)
}

export interface DayPlan {
  dayNumber: number;
  items: PerPersonItem[];
  dayNote?: string;
}

// 차량·가이드·DG 공통 비용 (전체 일정 합계, VAT 포함)
export interface PartyCost {
  categorySlug: string; // 'vehicle' | 'guide' | 'driving-guide' | 'transport'
  totalKrw: number;
  notes?: string;
}

// 시즌 보정. appliesTo에 포함된 categorySlug만 multiplier 적용.
export interface SeasonAdjust {
  multiplier: number;
  appliesTo: string[];
}

export interface Margin {
  net: number; // 기본 0.12
  retail: number; // 기본 0.35
}

export interface CalculationInput {
  productType: ProductType;
  productName: string;
  durationHours?: number;
  nights?: number;
  party: PartyMode;
  days: DayPlan[];
  partyShared: PartyCost[];
  season: SeasonAdjust;
  margin: Margin;
  vatRate: number; // S20: v2.1 기본 0 (금액 이미 VAT 포함). v2.0 호환 시 0.10.
  exchangeRate: { krwToUsd: number };
}

// D39 — 차량비 5요소 분해
export interface VehicleSpec {
  rent: number;
  fuel: number;
  parking: number;
  toll: number;
  driverTip: number;
}

export interface TierCostBreakdown {
  count: number;
  multiplier: number;
  perPersonItems: number; // STEP 4 — 연령 가중 적용 항목 합
  tierCost: number; // STEP 5 — perPersonItems + perPersonShared (마진0·VAT포함)
  finalKrw: number; // STEP 7 — 참고용 마진·VAT 적용가
  finalUsd: number;
}

export interface CostResult {
  nTotal: number; // 실제 머릿수
  nEff: number; // STEP 1 — 가중 인원
  partySharedTotal: number; // 시즌 보정 후 파티 공통 비용 합
  perPersonShared: number; // STEP 3
  byTier: Partial<Record<AgeTierKey, TierCostBreakdown>>;
  costPerAdult: number; // 1단계 핵심 출력 (마진0·VAT포함)
  groupCostKrw: number; // Σ count × tierCost
  groupFinalKrw: number; // Σ count × finalKrw (참고가)
}

// ── STEP 9~14 채널·BEP·OTA ──────────────────────────────────────

export interface SalesChannel {
  code: string;
  name: string;
  commissionRate: number; // 채널 수수료율
  cardFeeRate: number; // 카드 결제 수수료율
  fixedFeeKrw: number; // 고정 수수료
}

// 워터트리 운영 정책 기준 3채널 (user_library에서 협상가로 덮어쓰기 가능, 화면에서 직접 수정 가능)
export const DEFAULT_CHANNELS: SalesChannel[] = [
  { code: 'self-offline', name: '자체 모객 (오프라인)', commissionRate: 0.0, cardFeeRate: 0.0, fixedFeeKrw: 0 },
  { code: 'self-online', name: '자체 온라인', commissionRate: 0.0, cardFeeRate: 0.045, fixedFeeKrw: 0 },
  { code: 'global-ota', name: '글로벌 OTA 등록 판매', commissionRate: 0.3, cardFeeRate: 0.0, fixedFeeKrw: 0 },
];

export interface OtaChannel {
  code: string;
  name: string;
  commission: number;
}

// STEP 14 — OTA 6사 공시 평균 수수료 (user_library에서 협상가로 덮어쓰기 가능)
export const DEFAULT_OTAS: OtaChannel[] = [
  { code: 'klook', name: 'Klook', commission: 0.25 },
  { code: 'viator', name: 'Viator', commission: 0.25 },
  { code: 'getyourguide', name: 'GetYourGuide', commission: 0.25 },
  { code: 'kkday', name: 'KKday', commission: 0.25 },
  { code: 'tripcom', name: 'Trip.com', commission: 0.22 },
  { code: 'expedia', name: 'Expedia', commission: 0.24 },
];

// STEP 11 — 인원 N별 매트릭스 구간 (5채널 × 9인원 = 45셀)
export const DEFAULT_PAX_RANGE = [5, 10, 15, 20, 25, 30, 35, 40, 45];

export interface ChannelCell {
  channelCode: string;
  profitRate: number; // 판매가 대비 % (소수 1자리 반올림)
}

export interface MatrixRow {
  pax: number;
  costPerAdult: number;
  cells: ChannelCell[];
  // 이 행의 인원이 어느 채널의 BEP에 해당하면 그 채널 코드들 (표시 강조용)
  bepFor?: string[];
}

export interface BepSummary {
  byChannel: { channelCode: string; breakEvenN: number | null }[]; // null = 도달 불가
  bestMin: number | null;
  worstMax: number | null;
}

export interface ChannelAnalysisInput {
  perPersonItems: number; // 성인 기준 인당 항목 합 (STEP 4)
  partySharedTotal: number; // 시즌 보정 후 공통비 합 (STEP 3 total)
  salePrice: number; // 1인당 판매가 (VAT 포함) — 2단계 입력
  paxRange?: number[];
  channels?: SalesChannel[];
  // true: 채널별 BEP 인원을 paxRange에 자동 삽입 (정렬·중복 제거)
  includeBepRows?: boolean;
}

export interface ChannelAnalysis {
  matrix: MatrixRow[];
  bep: BepSummary;
}

export interface OtaCell {
  code: string;
  name: string;
  commission: number;
  profitRateAtPax: number; // 특정 인원 기준 수익률 %
  breakEvenN: number | null;
}

// ── STEP M1~M5 2단계 캠페인 시뮬레이션 ──────────────────────────

export type SeasonKey = 'off' | 'shoulder' | 'peak' | 'holiday';

// D41 — 시즌 정의. 월별 매핑 + 사용자 정의. 휴일은 별도 판정.
export interface SeasonCalendar {
  monthToSeason: Partial<Record<number, SeasonKey>>; // 1~12 → 시즌
  defaultSeason: SeasonKey;
}

export interface CampaignInput {
  dateRange: { start: string; end: string }; // ISO YYYY-MM-DD
  departWeekdays: number[]; // 0=일 ~ 6=토 (D50 운영 요일)
  excludeHolidays: boolean; // true=휴일 제외(기본) · false=휴일 강행(+단가)
  holidays: string[]; // ISO 날짜 (data.go.kr ∪ user_library.holiday)
  seasonCalendar: SeasonCalendar;
  avgPaxBySeason: Record<SeasonKey, number>; // M3 — 시즌별 예상 평균 예약
  targetPax: number; // M1 — 판매 목표 인원 누적
  salePrice: number; // 1인당 판매가 (VAT 포함)
  holidaySurcharge?: number; // D51 — 휴일 강행 단가 배수 (기본 1.2)
  perPersonItems: number; // 인당 항목 (원가 재계산용)
  partySharedTotal: number; // 시즌 보정 후 공통비 합
}

export interface SeasonBreakdown {
  season: SeasonKey;
  departCount: number; // 해당 시즌 출발 횟수
  avgPax: number;
  bookedPax: number; // departCount × avgPax
  unitPrice: number; // 휴일 보정 반영
  costPerAdult: number; // avgPax 기준 원가
  marginRate: number; // % (소수 1자리)
  revenue: number;
  margin: number;
}

export interface CampaignResult {
  departCount: number; // M2 — 총 출발 횟수
  avgPaxPerDepart: number; // M5 — targetPax / departCount
  bySeasonBreakdown: SeasonBreakdown[];
  cumulativeRevenue: number; // M5 — targetPax × 가중평균 단가
  cumulativeMarginRate: number; // M5 — 인원 가중 평균 마진율 %
  scenarioPax: number; // 시나리오 달성 예상 인원 Σ bookedPax
  missRiskPercent: number; // M5 — 목표 미달 가능성 %
}
