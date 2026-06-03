// 투어 패키지 단가 계산 — 2단계 캠페인 시뮬레이션 (제작기획서 v2.1 S07 STEP M1~M5)

import type {
  CampaignInput,
  CampaignResult,
  SeasonBreakdown,
  SeasonCalendar,
  SeasonKey,
} from './types';

// STEP M2 — 출발 후보일 산출. dateRange × departWeekdays, 휴일 제외/포함. UTC 기준 일관 처리.
export function enumerateDepartures(input: {
  start: string;
  end: string;
  departWeekdays: number[];
  holidays: string[];
  excludeHolidays: boolean;
}): string[] {
  const result: string[] = [];
  const holidaySet = new Set(input.holidays);
  const cur = new Date(input.start + 'T00:00:00Z');
  const end = new Date(input.end + 'T00:00:00Z');

  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    if (input.departWeekdays.includes(cur.getUTCDay())) {
      const isHoliday = holidaySet.has(iso);
      if (!(input.excludeHolidays && isHoliday)) result.push(iso);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

// 날짜 → 시즌. 휴일 강행 모드(excludeHolidays=false)에서 휴일은 'holiday'로 분류.
export function seasonOf(
  dateIso: string,
  calendar: SeasonCalendar,
  holidaySet: Set<string>,
  excludeHolidays: boolean,
): SeasonKey {
  if (!excludeHolidays && holidaySet.has(dateIso)) return 'holiday';
  const month = Number(dateIso.slice(5, 7));
  return calendar.monthToSeason[month] ?? calendar.defaultSeason;
}

// STEP M1~M5 — 목표 인원 → 캠페인 누적 매출·마진·미달 위험
export function projectCampaign(input: CampaignInput): CampaignResult {
  const {
    dateRange,
    departWeekdays,
    excludeHolidays,
    holidays,
    seasonCalendar,
    avgPaxBySeason,
    targetPax,
    salePrice,
    perPersonItems,
    partySharedTotal,
  } = input;
  const surcharge = input.holidaySurcharge ?? 1.2;
  const holidaySet = new Set(holidays);

  const valid = enumerateDepartures({
    start: dateRange.start,
    end: dateRange.end,
    departWeekdays,
    holidays,
    excludeHolidays,
  });
  const departCount = valid.length;

  // STEP M2 — 시즌별 출발 횟수
  const counts: Record<SeasonKey, number> = {
    off: 0,
    shoulder: 0,
    peak: 0,
    holiday: 0,
  };
  for (const d of valid) {
    counts[seasonOf(d, seasonCalendar, holidaySet, excludeHolidays)]++;
  }

  // STEP M3~M4 — 시즌별 예약·원가·마진
  const seasons: SeasonKey[] = ['off', 'shoulder', 'peak', 'holiday'];
  const bySeasonBreakdown: SeasonBreakdown[] = [];
  let scenarioPax = 0;
  let weightedPriceSum = 0;
  let weightedMarginSum = 0;

  for (const s of seasons) {
    const dc = counts[s];
    if (dc === 0) continue;
    const avgPax = avgPaxBySeason[s] ?? 0;
    const bookedPax = dc * avgPax;
    const unitPrice = salePrice * (s === 'holiday' ? surcharge : 1);
    const costPerAdult =
      avgPax > 0 ? perPersonItems + partySharedTotal / avgPax : perPersonItems;
    const marginRate =
      unitPrice > 0 ? ((unitPrice - costPerAdult) / unitPrice) * 100 : 0;

    bySeasonBreakdown.push({
      season: s,
      departCount: dc,
      avgPax,
      bookedPax,
      unitPrice: Math.round(unitPrice),
      costPerAdult: Math.round(costPerAdult),
      marginRate: Math.round(marginRate * 10) / 10,
      revenue: Math.round(bookedPax * unitPrice),
      margin: Math.round(bookedPax * (unitPrice - costPerAdult)),
    });
    scenarioPax += bookedPax;
    weightedPriceSum += bookedPax * unitPrice;
    weightedMarginSum += bookedPax * marginRate;
  }

  // STEP M5 — 누적 매출·마진·미달 위험
  const avgPaxPerDepart = departCount > 0 ? targetPax / departCount : 0;
  const weightedAvgPrice = scenarioPax > 0 ? weightedPriceSum / scenarioPax : 0;
  const avgAchievable = departCount > 0 ? scenarioPax / departCount : 0;
  const missRiskPercent =
    avgAchievable > 0
      ? Math.max(
          0,
          Math.round(((avgPaxPerDepart - avgAchievable) / avgAchievable) * 1000) /
            10,
        )
      : 0;

  return {
    departCount,
    avgPaxPerDepart: Math.round(avgPaxPerDepart * 100) / 100,
    bySeasonBreakdown,
    cumulativeRevenue: Math.round(targetPax * weightedAvgPrice),
    cumulativeMarginRate:
      scenarioPax > 0 ? Math.round((weightedMarginSum / scenarioPax) * 10) / 10 : 0,
    scenarioPax,
    missRiskPercent,
  };
}
