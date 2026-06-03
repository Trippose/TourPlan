// 투어 패키지 단가 계산 — 2단계 캠페인 시뮬레이션 단위 테스트 (제작기획서 v2.1 STEP M1~M5)

import { describe, it, expect } from 'vitest';
import { enumerateDepartures, projectCampaign, seasonOf } from './campaign';
import type { CampaignInput, SeasonCalendar } from './types';

describe('STEP M2 — 출발 후보일 산출', () => {
  const base = {
    start: '2026-06-01',
    end: '2026-06-07', // 7일 (모든 요일 1회씩 등장)
    departWeekdays: [0, 1, 2, 3, 4, 5, 6],
  };

  it('전체 요일 선택 시 7일 모두 반환', () => {
    const r = enumerateDepartures({ ...base, holidays: [], excludeHolidays: true });
    expect(r).toHaveLength(7);
    expect(r[0]).toBe('2026-06-01');
    expect(r[6]).toBe('2026-06-07');
  });

  it('휴일 제외(기본): 휴일 날짜가 빠짐', () => {
    const r = enumerateDepartures({ ...base, holidays: ['2026-06-03'], excludeHolidays: true });
    expect(r).toHaveLength(6);
    expect(r).not.toContain('2026-06-03');
  });

  it('휴일 강행: 휴일 날짜 포함', () => {
    const r = enumerateDepartures({ ...base, holidays: ['2026-06-03'], excludeHolidays: false });
    expect(r).toHaveLength(7);
    expect(r).toContain('2026-06-03');
  });

  it('특정 요일만 선택 시 반환 날짜의 요일이 모두 일치', () => {
    const r = enumerateDepartures({
      start: '2026-06-01',
      end: '2026-06-30',
      departWeekdays: [3, 4, 5], // 수·목·금
      holidays: [],
      excludeHolidays: true,
    });
    for (const iso of r) {
      const wd = new Date(iso + 'T00:00:00Z').getUTCDay();
      expect([3, 4, 5]).toContain(wd);
    }
  });
});

describe('seasonOf — 날짜 시즌 판정', () => {
  const cal: SeasonCalendar = { monthToSeason: { 7: 'peak', 6: 'shoulder' }, defaultSeason: 'off' };

  it('월별 매핑 적용', () => {
    expect(seasonOf('2026-07-15', cal, new Set(), true)).toBe('peak');
    expect(seasonOf('2026-06-15', cal, new Set(), true)).toBe('shoulder');
  });
  it('매핑 없는 달은 default', () => {
    expect(seasonOf('2026-03-10', cal, new Set(), true)).toBe('off');
  });
  it('휴일 강행 모드에서 휴일은 holiday로 분류', () => {
    expect(seasonOf('2026-07-15', cal, new Set(['2026-07-15']), false)).toBe('holiday');
  });
});

describe('STEP M1~M5 — 캠페인 누적 투영', () => {
  const calShoulder: SeasonCalendar = { monthToSeason: { 6: 'shoulder' }, defaultSeason: 'off' };

  function makeCampaign(over: Partial<CampaignInput> = {}): CampaignInput {
    return {
      dateRange: { start: '2026-06-01', end: '2026-06-07' }, // 7 출발
      departWeekdays: [0, 1, 2, 3, 4, 5, 6],
      excludeHolidays: true,
      holidays: [],
      seasonCalendar: calShoulder,
      avgPaxBySeason: { off: 0, shoulder: 20, peak: 0, holiday: 0 },
      targetPax: 140,
      salePrice: 150000,
      perPersonItems: 100000,
      partySharedTotal: 1000000,
      ...over,
    };
  }

  it('기본: 7출발·평균20·목표140 → 매출 21M·마진 0%·미달위험 0%', () => {
    const r = projectCampaign(makeCampaign());
    expect(r.departCount).toBe(7);
    expect(r.avgPaxPerDepart).toBe(20);
    expect(r.scenarioPax).toBe(140); // 7 × 20
    expect(r.cumulativeRevenue).toBe(21000000); // 140 × 150000
    expect(r.cumulativeMarginRate).toBe(0); // 원가 150000 = 판매가
    expect(r.missRiskPercent).toBe(0);
  });

  it('목표 과다(210): 미달 위험 50%', () => {
    const r = projectCampaign(makeCampaign({ targetPax: 210 }));
    // avgPaxPerDepart 30 vs avgAchievable 20 → +50%
    expect(r.avgPaxPerDepart).toBe(30);
    expect(r.missRiskPercent).toBe(50);
  });

  it('평균 예약 30: 원가 하락으로 마진율 +11.1%', () => {
    const r = projectCampaign(
      makeCampaign({ avgPaxBySeason: { off: 0, shoulder: 30, peak: 0, holiday: 0 }, targetPax: 210 }),
    );
    // costPerAdult = 100000 + 1000000/30 = 133333.3, marginRate = (150000-133333.3)/150000 = 11.1%
    expect(r.cumulativeMarginRate).toBe(11.1);
  });

  it('휴일 강행(+20% 단가): holiday 시즌 단가 180000', () => {
    const r = projectCampaign(
      makeCampaign({
        seasonCalendar: { monthToSeason: {}, defaultSeason: 'off' },
        excludeHolidays: false,
        holidays: ['2026-06-03'],
        avgPaxBySeason: { off: 20, shoulder: 0, peak: 0, holiday: 20 },
      }),
    );
    const holidayRow = r.bySeasonBreakdown.find((b) => b.season === 'holiday')!;
    expect(holidayRow.unitPrice).toBe(180000); // 150000 × 1.2
    expect(holidayRow.departCount).toBe(1); // 06-03만
  });
});
