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

describe('매트릭스 정밀 합계 — 반올림 오차 인원 증폭 회귀 방지', () => {
  // 실측 사례 (2026-06-11): perPerson 39,000 + 공통 1,000,000, 판매가 150,000, N=15.
  // 1인 원가 = 39,000 + 66,666.67 = 105,666.67 → 반올림 105,667로 총액을 구하면
  // 수수료 0 채널 총수익이 664,995로 표시(정확값 665,000과 5원 차이).
  const r = analyzeChannels({ perPersonItems: 39000, partySharedTotal: 1000000, salePrice: 150000 });
  const row15 = r.matrix.find((m) => m.pax === 15)!;

  it('costPerAdultExact는 반올림 전 정밀값을 보존한다', () => {
    expect(row15.costPerAdult).toBe(105667); // 표시용 반올림
    expect(row15.costPerAdultExact).toBeCloseTo(39000 + 1000000 / 15, 6);
  });

  it('정밀값 기반 N명 총수익 = N×판매가 − N×인당항목 − 공통비 (수수료 0 채널)', () => {
    const channelTotal = (150000 - row15.costPerAdultExact) * 15;
    expect(Math.round(channelTotal)).toBe(150000 * 15 - 39000 * 15 - 1000000); // = 665,000
    // 반올림값으로 계산하면 5원 어긋난다 — 이 경로로 회귀하면 안 됨
    expect((150000 - row15.costPerAdult) * 15).toBe(664995);
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
