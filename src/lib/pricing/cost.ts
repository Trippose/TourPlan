// 투어 패키지 단가 계산 — 1단계 원가 엔진 (제작기획서 v2.1 S07 STEP 0~8)

import type {
  AgeTierKey,
  CalculationInput,
  CostResult,
  DayPlan,
  PartyCost,
  SeasonAdjust,
  TierCostBreakdown,
  TierInput,
  VehicleSpec,
} from './types';

// STEP 2 — 시즌 보정: appliesTo에 포함된 카테고리만 multiplier 적용
export function seasonCost(
  categorySlug: string,
  cost: number,
  season: SeasonAdjust,
): number {
  return season.appliesTo.includes(categorySlug) ? cost * season.multiplier : cost;
}

// 실제 머릿수 (가중치 적용 전)
export function totalHeadcount(
  tiers: Partial<Record<AgeTierKey, TierInput>>,
): number {
  return Object.values(tiers).reduce((sum, t) => sum + (t?.count ?? 0), 0);
}

// STEP 1 — 가중 인원 N_eff
export function effectiveHeadcount(
  tiers: Partial<Record<AgeTierKey, TierInput>>,
): number {
  return Object.values(tiers).reduce(
    (sum, t) => sum + (t ? t.count * t.multiplier : 0),
    0,
  );
}

// STEP 4 — 연령별 인당 항목 합계.
// free·customer-paid는 원가 0. tiered면 tier별 직접 가격(multiplier 미적용). unified면 성인가×multiplier.
export function perPersonItemsForTier(
  days: DayPlan[],
  tierKey: AgeTierKey,
  multiplier: number,
  season: SeasonAdjust,
): number {
  let total = 0;
  for (const day of days) {
    for (const item of day.items) {
      if (item.paymentType !== 'included') continue;
      if (item.priceMode === 'tiered') {
        const price = item.pricesByTier?.[tierKey] ?? 0;
        total += seasonCost(item.categorySlug, price, season);
      } else {
        const adjusted = seasonCost(item.categorySlug, item.unitPriceKrw, season);
        total += adjusted * (item.applyAgeTier ? multiplier : 1.0);
      }
    }
  }
  return total;
}

// STEP 3 — 파티 공통 비용 1인당 분배. N_total=0(유아만 등) 시 ZeroDivision 방지.
export function partySharedPerPerson(
  partyShared: PartyCost[],
  season: SeasonAdjust,
  nTotal: number,
): { total: number; perPerson: number } {
  const total = partyShared.reduce(
    (sum, p) => sum + seasonCost(p.categorySlug, p.totalKrw, season),
    0,
  );
  const perPerson = nTotal > 0 ? total / nTotal : 0;
  return { total, perPerson };
}

// STEP 0 — 차량 대수 자동 산출 (D49). ceil(인원/인승). 1대당 가이드·DG 1명.
export function autoVehicleCounts(
  partyTotal: number,
  capacity: number,
): { vehicleCount: number; guideCount: number; dgCount: number } {
  if (capacity <= 0) throw new Error('capacity must be > 0');
  const vehicleCount = Math.ceil(partyTotal / capacity);
  return { vehicleCount, guideCount: vehicleCount, dgCount: vehicleCount };
}

// D39 — 차량비 5요소 합 (모두 VAT 포함)
export function vehicleDailyCost(v: VehicleSpec): number {
  return v.rent + v.fuel + v.parking + v.toll + v.driverTip;
}

// 메인 — STEP 1~8 1단계 원가. costPerAdult(마진0)이 핵심 출력, finalKrw는 참고용 마진·VAT 적용가.
export function computeCost(input: CalculationInput): CostResult {
  const { party, days, partyShared, season, margin, vatRate, exchangeRate } =
    input;
  const tiers = party.tiers;

  const nTotal = totalHeadcount(tiers);
  const nEff = effectiveHeadcount(tiers);
  const shared = partySharedPerPerson(partyShared, season, nTotal);

  const byTier: Partial<Record<AgeTierKey, TierCostBreakdown>> = {};
  let groupCostKrw = 0;
  let groupFinalKrw = 0;

  (Object.keys(tiers) as AgeTierKey[]).forEach((key) => {
    const tier = tiers[key];
    if (!tier) return;

    const perPersonItems = perPersonItemsForTier(days, key, tier.multiplier, season);
    const tierCost = perPersonItems + shared.perPerson; // STEP 5 (마진0·VAT포함)
    // STEP 6~7 참고가 (마진·VAT 적용). v2.1 기본 vatRate=0.
    const retailPrice = tierCost * (1 + margin.net) * (1 + margin.retail);
    const finalKrw = Math.round(retailPrice * (1 + vatRate));
    const finalUsd = Math.round(finalKrw * exchangeRate.krwToUsd * 100) / 100;

    byTier[key] = {
      count: tier.count,
      multiplier: tier.multiplier,
      perPersonItems,
      tierCost: Math.round(tierCost),
      finalKrw,
      finalUsd,
    };
    groupCostKrw += tier.count * tierCost;
    groupFinalKrw += tier.count * finalKrw;
  });

  return {
    nTotal,
    nEff,
    partySharedTotal: shared.total,
    perPersonShared: shared.perPerson,
    byTier,
    costPerAdult: byTier.adult ? byTier.adult.tierCost : 0,
    groupCostKrw: Math.round(groupCostKrw),
    groupFinalKrw: Math.round(groupFinalKrw),
  };
}
