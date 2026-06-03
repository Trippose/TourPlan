// 투어 패키지 단가 계산 — 채널·BEP·OTA 분석 단위 테스트 (제작기획서 v2.1 STEP 9~14)

import { describe, it, expect } from 'vitest';
import {
  analyzeChannels,
  analyzeOtas,
  breakEvenN,
  channelNetRevenue,
  channelProfitRate,
} from './channel';
import { DEFAULT_CHANNELS } from './types';

const CH = Object.fromEntries(DEFAULT_CHANNELS.map((c) => [c.code, c]));

describe('STEP 9~10 — 채널 순수익·수익률 (3채널 — 자체오프/자체온/글로벌 OTA)', () => {
  it('판매가=원가=178250 → 자체오프 0%, 자체온 −4.5%, 글로벌 OTA −30%', () => {
    const sale = 178250;
    expect(channelProfitRate(sale, sale, CH['self-offline'])).toBeCloseTo(0.0, 4);
    expect(channelProfitRate(sale, sale, CH['self-online'])).toBeCloseTo(-4.5, 4);
    expect(channelProfitRate(sale, sale, CH['global-ota'])).toBeCloseTo(-30.0, 4);
  });

  it('자체 오프라인 순수익 = 판매가 (수수료 0)', () => {
    expect(channelNetRevenue(150000, CH['self-offline'])).toBe(150000);
  });

  it('글로벌 OTA 순수익 = 판매가 × 0.7 (수수료 30%)', () => {
    expect(channelNetRevenue(150000, CH['global-ota'])).toBe(105000);
  });
});

describe('STEP 12 — 채널 BEP (손익분기 인원)', () => {
  // perPersonItems 100000 + partyShared 1,000,000 / N, salePrice 150000
  const base = { perPersonItems: 100000, partySharedTotal: 1000000, salePrice: 150000 };

  it('자체 오프라인 BEP = 20명 (N=20에서 원가 150000 = 판매가, 수수료 0)', () => {
    expect(breakEvenN(base, CH['self-offline'])).toBe(20);
  });
  it('자체 온라인 BEP = 24명 (카드 4.5% 부담)', () => {
    // net = 150000 × 0.955 = 143,250
    // BEP = ceil(1,000,000 / (143,250 − 100,000)) = ceil(23.12) = 24
    expect(breakEvenN(base, CH['self-online'])).toBe(24);
  });
  it('글로벌 OTA BEP = 200명 (수수료 30% — 흑자 도달 매우 어려움)', () => {
    // net = 150000 × 0.7 = 105,000
    // BEP = ceil(1,000,000 / (105,000 − 100,000)) = ceil(200) = 200
    expect(breakEvenN(base, CH['global-ota'])).toBe(200);
  });
  it('인당 항목만으로 적자면 BEP = null (도달 불가)', () => {
    expect(
      breakEvenN({ perPersonItems: 200000, partySharedTotal: 1000000, salePrice: 150000 }, CH['self-offline']),
    ).toBeNull();
  });
});

describe('STEP 11~13 — 매트릭스 + BEP 통합 (9인원 × 3채널 = 27셀)', () => {
  const r = analyzeChannels({ perPersonItems: 100000, partySharedTotal: 1000000, salePrice: 150000 });

  it('27셀 매트릭스 (9인원 × 3채널)', () => {
    expect(r.matrix).toHaveLength(9);
    expect(r.matrix[0].cells).toHaveLength(3);
  });

  it('N=20 행: 원가 150000, 자체오프 0.0%', () => {
    const row = r.matrix.find((m) => m.pax === 20)!;
    expect(row.costPerAdult).toBe(150000);
    expect(row.cells.find((c) => c.channelCode === 'self-offline')!.profitRate).toBe(0.0);
  });

  it('BEP 통합 카드: bestMin=20 (자체오프), worstMax=200 (글로벌 OTA)', () => {
    expect(r.bep.bestMin).toBe(20);
    expect(r.bep.worstMax).toBe(200);
  });
});

describe('STEP 14 — OTA 6사', () => {
  const otas = analyzeOtas({ perPersonItems: 100000, partySharedTotal: 1000000, salePrice: 150000, pax: 20 });

  it('Klook 25% → 원가=판매가(N=20)에서 −25%, Trip.com 22% → −22%', () => {
    expect(otas.find((o) => o.code === 'klook')!.profitRateAtPax).toBe(-25.0);
    expect(otas.find((o) => o.code === 'tripcom')!.profitRateAtPax).toBe(-22.0);
  });

  it('6사 모두 포함, 수수료 클수록 BEP 상승 (Trip.com < Klook)', () => {
    expect(otas).toHaveLength(6);
    const klook = otas.find((o) => o.code === 'klook')!.breakEvenN!;
    const tripcom = otas.find((o) => o.code === 'tripcom')!.breakEvenN!;
    expect(tripcom).toBeLessThan(klook);
  });
});
