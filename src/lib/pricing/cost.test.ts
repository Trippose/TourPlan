// 투어 패키지 단가 계산 — 1단계 원가 엔진 단위 테스트 (제작기획서 v2.1 검증 시나리오)

import { describe, it, expect } from 'vitest';
import {
  autoVehicleCounts,
  computeCost,
  effectiveHeadcount,
  vehicleDailyCost,
} from './cost';
import type { CalculationInput, SeasonAdjust } from './types';

const NO_SEASON: SeasonAdjust = { multiplier: 1.0, appliesTo: [] };

function makeInput(over: Partial<CalculationInput> = {}): CalculationInput {
  return {
    productType: 'full-day',
    productName: '테스트 투어',
    party: { mode: 'simple', tiers: { adult: { count: 20, multiplier: 1.0 } } },
    days: [
      {
        dayNumber: 1,
        items: [
          {
            categorySlug: 'admission',
            unitPriceKrw: 100000,
            applyAgeTier: true,
            paymentType: 'included',
          },
        ],
      },
    ],
    partyShared: [{ categorySlug: 'vehicle', totalKrw: 1000000 }],
    season: NO_SEASON,
    margin: { net: 0.12, retail: 0.35 },
    vatRate: 0.1,
    exchangeRate: { krwToUsd: 0.00072 },
    ...over,
  };
}

describe('computeCost — 1단계 원가 엔진', () => {
  it('기본: N=20 성인, net12·retail35·vat10 → finalKrw = tierCost × 1.6632', () => {
    const r = computeCost(makeInput());
    expect(r.byTier.adult!.tierCost).toBe(150000); // 100000 + 1000000/20
    expect(r.byTier.adult!.finalKrw).toBe(Math.round(150000 * 1.6632)); // 249480
    expect(r.costPerAdult).toBe(150000);
  });

  it('소아 50%: applyAgeTier 항목은 youth multiplier 0.5 적용', () => {
    const r = computeCost(
      makeInput({
        party: {
          mode: 'detailed',
          tiers: {
            adult: { count: 18, multiplier: 1.0 },
            youth: { count: 2, multiplier: 0.5 },
          },
        },
        days: [
          {
            dayNumber: 1,
            items: [
              {
                categorySlug: 'admission',
                unitPriceKrw: 100,
                applyAgeTier: true,
                paymentType: 'included',
              },
            ],
          },
        ],
        partyShared: [],
      }),
    );
    expect(r.byTier.adult!.perPersonItems).toBe(100);
    expect(r.byTier.youth!.perPersonItems).toBe(50); // 100 × 0.5
  });

  it('유아 0원: infant multiplier 0 → perPersonItems 0, tierCost는 partySharedPerPerson만', () => {
    const r = computeCost(
      makeInput({
        party: {
          mode: 'detailed',
          tiers: {
            adult: { count: 19, multiplier: 1.0 },
            infant: { count: 1, multiplier: 0.0 },
          },
        },
      }),
    );
    expect(r.byTier.infant!.perPersonItems).toBe(0);
    expect(r.byTier.infant!.tierCost).toBe(50000); // 1000000/20
  });

  it('시즌 1.2배: appliesTo=[vehicle,guide]만 ×1.2, 입장료 원가 유지', () => {
    const r = computeCost(
      makeInput({
        partyShared: [
          { categorySlug: 'vehicle', totalKrw: 1000000 },
          { categorySlug: 'guide', totalKrw: 500000 },
        ],
        season: { multiplier: 1.2, appliesTo: ['vehicle', 'guide'] },
      }),
    );
    expect(r.partySharedTotal).toBe(1800000); // 1200000 + 600000
    expect(r.byTier.adult!.perPersonItems).toBe(100000); // 입장료 미보정
  });

  it('경계 N=1: partySharedPerPerson = 전체 파티 비용', () => {
    const r = computeCost(
      makeInput({
        party: { mode: 'simple', tiers: { adult: { count: 1, multiplier: 1.0 } } },
      }),
    );
    expect(r.perPersonShared).toBe(r.partySharedTotal);
    expect(r.perPersonShared).toBe(1000000);
  });

  it('경계 유아 5명만: nEff=0이어도 ZeroDivision 없이 nTotal=5로 분배', () => {
    const r = computeCost(
      makeInput({
        party: {
          mode: 'detailed',
          tiers: {
            adult: { count: 0, multiplier: 1.0 },
            infant: { count: 5, multiplier: 0.0 },
          },
        },
      }),
    );
    expect(r.nEff).toBe(0);
    expect(r.nTotal).toBe(5);
    expect(r.perPersonShared).toBe(200000); // 1000000 / 5
  });

  it('v2.1 S20: vatRate=0이면 finalKrw = tierCost × 1.512 (마진만, 원가는 불변)', () => {
    const r = computeCost(makeInput({ vatRate: 0 }));
    expect(r.byTier.adult!.finalKrw).toBe(Math.round(150000 * 1.512)); // 226800
    expect(r.costPerAdult).toBe(150000);
  });
});

describe('보조 함수', () => {
  it('autoVehicleCounts: 80명 + 45인승 → 2대, 가이드·DG 각 2', () => {
    expect(autoVehicleCounts(80, 45)).toEqual({
      vehicleCount: 2,
      guideCount: 2,
      dgCount: 2,
    });
  });

  it('vehicleDailyCost: 5요소 합', () => {
    expect(
      vehicleDailyCost({
        rent: 220000,
        fuel: 30000,
        parking: 10000,
        toll: 8000,
        driverTip: 20000,
      }),
    ).toBe(288000);
  });

  it('effectiveHeadcount: 성인18 + 소아2 = 19.0', () => {
    expect(
      effectiveHeadcount({
        adult: { count: 18, multiplier: 1.0 },
        youth: { count: 2, multiplier: 0.5 },
      }),
    ).toBe(19);
  });
});

describe('priceMode tiered — tier별 직접 가격', () => {
  it('tiered면 multiplier 무시하고 pricesByTier를 직접 사용', () => {
    const r = computeCost(
      makeInput({
        party: {
          mode: 'detailed',
          tiers: {
            adult: { count: 1, multiplier: 1.0 },
            youth: { count: 1, multiplier: 0.7 },
            child: { count: 1, multiplier: 0.5 },
            infant: { count: 1, multiplier: 0.0 },
          },
        },
        days: [
          {
            dayNumber: 1,
            items: [
              {
                categorySlug: 'admission',
                productName: '경복궁',
                priceMode: 'tiered',
                pricesByTier: { adult: 10000, youth: 7000, child: 5000, infant: 0 },
                unitPriceKrw: 10000,
                applyAgeTier: true,
                paymentType: 'included',
              },
            ],
          },
        ],
        partyShared: [],
      }),
    );
    expect(r.byTier.adult!.perPersonItems).toBe(10000);
    expect(r.byTier.youth!.perPersonItems).toBe(7000);
    expect(r.byTier.child!.perPersonItems).toBe(5000);
    expect(r.byTier.infant!.perPersonItems).toBe(0);
  });
});
