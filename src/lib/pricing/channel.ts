// 투어 패키지 단가 계산 — 채널 수익·BEP·OTA 분석 (제작기획서 v2.1 S07 STEP 9~14)

import type {
  ChannelAnalysis,
  ChannelAnalysisInput,
  MatrixRow,
  OtaCell,
  OtaChannel,
  SalesChannel,
} from './types';
import { DEFAULT_CHANNELS, DEFAULT_OTAS, DEFAULT_PAX_RANGE } from './types';

// 인원 N에서 성인 1인당 원가 (STEP 11): perPersonItems + partySharedTotal/N
function costPerAdultAt(
  perPersonItems: number,
  partySharedTotal: number,
  n: number,
): number {
  return n > 0 ? perPersonItems + partySharedTotal / n : perPersonItems;
}

// STEP 9 — 채널 순수익 (1인당). netRevenue = salePrice × (1 − comm − cardFee) − fixedFee
export function channelNetRevenue(salePrice: number, ch: SalesChannel): number {
  return salePrice * (1 - ch.commissionRate - ch.cardFeeRate) - ch.fixedFeeKrw;
}

// STEP 10 — 채널 수익률 (판매가 대비 %). 영업 관점 표준.
export function channelProfitRate(
  salePrice: number,
  costPerAdult: number,
  ch: SalesChannel,
): number {
  if (salePrice <= 0) return 0;
  return ((channelNetRevenue(salePrice, ch) - costPerAdult) / salePrice) * 100;
}

// STEP 12 — 채널 BEP. min N s.t. profitRate(N) >= 0.
// netRevenue − (perPersonItems + partyShared/N) >= 0 → N >= partyShared / (netRevenue − perPersonItems)
export function breakEvenN(
  input: { perPersonItems: number; partySharedTotal: number; salePrice: number },
  ch: SalesChannel,
): number | null {
  const headroom = channelNetRevenue(input.salePrice, ch) - input.perPersonItems;
  if (headroom <= 0) return null; // 인당 항목만으로 적자 — 인원 무관 도달 불가
  if (input.partySharedTotal <= 0) return 1; // 공통비 없으면 1명부터 흑자
  return Math.ceil(input.partySharedTotal / headroom);
}

// STEP 11~13 — 인원×채널 매트릭스 + BEP 통합 카드
export function analyzeChannels(input: ChannelAnalysisInput): ChannelAnalysis {
  const channels = input.channels ?? DEFAULT_CHANNELS;
  const basePaxRange = input.paxRange ?? DEFAULT_PAX_RANGE;
  const { perPersonItems, partySharedTotal, salePrice } = input;

  // 채널별 BEP 인원 먼저 계산
  const byChannel = channels.map((ch) => ({
    channelCode: ch.code,
    breakEvenN: breakEvenN({ perPersonItems, partySharedTotal, salePrice }, ch),
  }));

  // BEP 행 자동 삽입 옵션 — paxRange + BEP 인원 합쳐 정렬·중복 제거
  let paxRange = basePaxRange;
  let bepByPax: Map<number, string[]> | null = null;
  if (input.includeBepRows) {
    bepByPax = new Map();
    for (const b of byChannel) {
      if (b.breakEvenN !== null && b.breakEvenN > 0) {
        const arr = bepByPax.get(b.breakEvenN) ?? [];
        arr.push(b.channelCode);
        bepByPax.set(b.breakEvenN, arr);
      }
    }
    const bepNums = Array.from(bepByPax.keys());
    paxRange = Array.from(new Set([...basePaxRange, ...bepNums])).sort((a, b) => a - b);
  }

  const matrix: MatrixRow[] = paxRange.map((pax) => {
    const cost = costPerAdultAt(perPersonItems, partySharedTotal, pax);
    return {
      pax,
      costPerAdult: Math.round(cost),
      cells: channels.map((ch) => ({
        channelCode: ch.code,
        profitRate: Math.round(channelProfitRate(salePrice, cost, ch) * 10) / 10,
      })),
      bepFor: bepByPax?.get(pax),
    };
  });

  const reached = byChannel
    .map((b) => b.breakEvenN)
    .filter((n): n is number => n !== null);

  return {
    matrix,
    bep: {
      byChannel,
      bestMin: reached.length ? Math.min(...reached) : null,
      worstMax: reached.length ? Math.max(...reached) : null,
    },
  };
}

// STEP 14 — OTA 6사 비교 (특정 인원 기준 수익률 + BEP)
export function analyzeOtas(
  input: {
    perPersonItems: number;
    partySharedTotal: number;
    salePrice: number;
    pax: number;
  },
  otas: OtaChannel[] = DEFAULT_OTAS,
): OtaCell[] {
  const { perPersonItems, partySharedTotal, salePrice, pax } = input;
  const costAtPax = costPerAdultAt(perPersonItems, partySharedTotal, pax);

  return otas.map((ota) => {
    const net = salePrice * (1 - ota.commission);
    const profitRateAtPax =
      salePrice > 0 ? Math.round(((net - costAtPax) / salePrice) * 1000) / 10 : 0;
    const headroom = net - perPersonItems;
    const bep =
      headroom <= 0
        ? null
        : partySharedTotal <= 0
          ? 1
          : Math.ceil(partySharedTotal / headroom);
    return {
      code: ota.code,
      name: ota.name,
      commission: ota.commission,
      profitRateAtPax,
      breakEvenN: bep,
    };
  });
}
