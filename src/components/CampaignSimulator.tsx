// 2단계 캠페인 시뮬레이션 — 시즌별 출발·예약·매출·마진·미달 위험 자동 산출
// projectCampaign(input)을 호출하여 결과 표시. 기본값은 한국 인바운드 시즌 패턴.
'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { projectCampaign } from '@/lib/pricing';
import type { SeasonKey } from '@/lib/pricing';

const SEASON_LABEL: Record<SeasonKey, string> = {
  off: '비수기',
  shoulder: '준성수기',
  peak: '성수기',
  holiday: '공휴일',
};

const PAL = {
  // 통일 팔레트 — page.tsx의 PAL과 동일 (OKLCH 정렬, L≈42 진한색·L≈93 파스텔)
  ink: '#1F2937',
  inkSoft: '#4B5563',
  mute: '#52606D',
  line: '#E7E2D5',
  bg: '#FAF7F2',
  rose: '#C0306B',
  rosePale: '#FBE0E8',
  emerald: '#138060',
  emeraldPale: '#CDEDDB',
  violet: '#6E37CC',
  violetPale: '#E4DCF6',
  amber: '#B27821',
  amberPale: '#F9E9C9',
} as const;

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

const DEFAULT_SEASON_CAL = {
  monthToSeason: {
    1: 'off', 2: 'off', 3: 'shoulder', 4: 'peak',
    5: 'peak', 6: 'shoulder', 7: 'peak', 8: 'peak',
    9: 'shoulder', 10: 'peak', 11: 'shoulder', 12: 'off',
  } as Partial<Record<number, SeasonKey>>,
  defaultSeason: 'shoulder' as SeasonKey,
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface CampaignSimulatorProps {
  perPersonItems: number;
  partySharedTotal: number;
  salePrice: number;
}

export function CampaignSimulator({ perPersonItems, partySharedTotal, salePrice }: CampaignSimulatorProps) {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const isoMonthLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // 활성화 토글 — OFF 기본. 사용자가 명시적으로 켜야 결과 산출 (선택사항).
  const [enabled, setEnabled] = useState(false);
  const [start, setStart] = useState(isoToday);
  const [end, setEnd] = useState(isoMonthLater);
  const [departWeekdays, setDepartWeekdays] = useState<number[]>([]); // 빈 배열 — 사용자가 직접 선택
  const [excludeHolidays, setExcludeHolidays] = useState(true);
  const [holidayText, setHolidayText] = useState('');
  const [targetPax, setTargetPax] = useState(0);
  const [avgOff, setAvgOff] = useState(0);
  const [avgShoulder, setAvgShoulder] = useState(0);
  const [avgPeak, setAvgPeak] = useState(0);
  const [avgHoliday, setAvgHoliday] = useState(0);
  const [holidaySurcharge, setHolidaySurcharge] = useState(1.2);

  const holidays = useMemo(
    () =>
      holidayText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
    [holidayText],
  );

  const result = useMemo(() => {
    // 활성화 OFF면 계산 안 함 (선택사항)
    if (!enabled) return null;
    // 필수 입력 누락 시 계산 안 함
    if (departWeekdays.length === 0 || targetPax <= 0 || salePrice <= 0) return null;
    if (perPersonItems === 0 && partySharedTotal === 0 && salePrice === 0) return null;
    try {
      return projectCampaign({
        dateRange: { start, end },
        departWeekdays,
        excludeHolidays,
        holidays,
        seasonCalendar: DEFAULT_SEASON_CAL,
        avgPaxBySeason: {
          off: avgOff,
          shoulder: avgShoulder,
          peak: avgPeak,
          holiday: avgHoliday,
        },
        targetPax,
        salePrice,
        perPersonItems,
        partySharedTotal,
        holidaySurcharge,
      });
    } catch (e) {
      console.warn('[campaign]', e);
      return null;
    }
  }, [enabled, start, end, departWeekdays, excludeHolidays, holidays, avgOff, avgShoulder, avgPeak, avgHoliday, targetPax, salePrice, perPersonItems, partySharedTotal, holidaySurcharge]);

  const toggleWeekday = (d: number) => {
    setDepartWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  };

  return (
    <Card className="print-avoid-break">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">
          📅 2단계 캠페인 시뮬레이션
          <span className="ml-2 text-xs font-normal" style={{ color: PAL.mute }}>
            — 선택사항 · 시즌별 출발·예약·매출·미달 위험 산출
          </span>
        </CardTitle>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className="rounded-full px-3.5 py-1.5 text-xs font-black transition hover:scale-105"
          style={{
            backgroundColor: enabled ? PAL.emerald : 'white',
            color: enabled ? 'white' : PAL.mute,
            border: `2px solid ${enabled ? PAL.emerald : PAL.line}`,
          }}
          title={enabled ? '시뮬레이션 활성 — 클릭하여 비활성' : '클릭하여 시뮬레이션 활성'}
        >
          {enabled ? '✓ 시뮬레이션 ON' : '○ 시뮬레이션 OFF'}
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enabled && (
          <div className="rounded-xl border-2 border-dashed p-5 text-center" style={{ borderColor: PAL.line, backgroundColor: 'rgba(109,40,217,0.03)' }}>
            <div className="text-3xl mb-2">📅</div>
            <div className="text-base font-bold mb-1" style={{ color: PAL.inkSoft }}>캠페인 시뮬레이션은 선택사항입니다</div>
            <p className="text-sm leading-relaxed" style={{ color: PAL.mute }}>
              우측 상단 <strong style={{ color: PAL.emerald }}>○ 시뮬레이션 OFF</strong> 버튼을 눌러 활성화하면,
              <br />
              기간·운영 요일·시즌별 평균 예약을 입력해 누적 매출과 목표 미달 위험을 자동 산출합니다.
            </p>
          </div>
        )}
        {enabled && (
          <>
        {/* 입력 — 날짜·운영 요일·휴일·목표 */}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-white p-3" style={{ borderColor: PAL.line }}>
            <div className="mb-2 text-xs font-black tracking-wider" style={{ color: PAL.rose }}>
              📆 기간 · 운영 요일
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-bold" style={{ color: PAL.mute }}>시작일</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: PAL.mute }}>종료일</Label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            <div className="mt-2">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-bold" style={{ color: PAL.mute }}>
                  출발 요일
                  <span className="ml-1.5 text-[10px] font-semibold" style={{ color: departWeekdays.length > 0 ? PAL.rose : PAL.mute }}>
                    ({departWeekdays.length}/7 선택)
                  </span>
                </Label>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setDepartWeekdays([0, 1, 2, 3, 4, 5, 6])}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-black transition hover:scale-105"
                    style={{ borderColor: PAL.emerald, color: PAL.emerald, backgroundColor: 'white' }}
                    title="월~일 7요일 모두 선택"
                  >
                    🌐 전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepartWeekdays([1, 2, 3, 4, 5])}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-black transition hover:scale-105"
                    style={{ borderColor: PAL.violet, color: PAL.violet, backgroundColor: 'white' }}
                    title="월·화·수·목·금"
                  >
                    💼 주중
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepartWeekdays([0, 6])}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-black transition hover:scale-105"
                    style={{ borderColor: PAL.amber, color: PAL.amber, backgroundColor: 'white' }}
                    title="토·일"
                  >
                    🎉 주말
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepartWeekdays([])}
                    disabled={departWeekdays.length === 0}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-black transition hover:scale-105 disabled:opacity-40"
                    style={{ borderColor: PAL.line, color: PAL.mute, backgroundColor: 'white' }}
                    title="전체 해제"
                  >
                    ↻ 리셋
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((label, i) => {
                  const isWeekend = i === 0 || i === 6;
                  const active = departWeekdays.includes(i);
                  const activeColor = isWeekend ? PAL.amber : PAL.rose;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleWeekday(i)}
                      className="rounded-full px-3 py-1 text-xs font-black transition hover:scale-105"
                      style={{
                        backgroundColor: active ? activeColor : 'transparent',
                        color: active ? 'white' : isWeekend ? PAL.amber : PAL.mute,
                        border: `2px solid ${active ? activeColor : PAL.line}`,
                        boxShadow: active ? `0 2px 6px ${isWeekend ? 'rgba(180, 83, 9, 0.20)' : 'rgba(190, 24, 93, 0.20)'}` : undefined,
                      }}
                      title={`${label}요일 ${active ? '해제' : '선택'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: PAL.inkSoft }}>
                <input
                  type="checkbox"
                  checked={excludeHolidays}
                  onChange={(e) => setExcludeHolidays(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                휴일 제외 (해제 시 휴일은 단가 ×{holidaySurcharge} 강행)
              </label>
            </div>
            <div className="mt-2">
              <Label className="text-xs font-bold" style={{ color: PAL.mute }}>휴일 목록 (ISO YYYY-MM-DD, 콤마/공백 구분)</Label>
              <Input
                type="text"
                value={holidayText}
                onChange={(e) => setHolidayText(e.target.value)}
                placeholder="예: 2026-05-05, 2026-06-06, 2026-08-15"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg border bg-white p-3" style={{ borderColor: PAL.line }}>
            <div className="mb-2 text-xs font-black tracking-wider" style={{ color: PAL.rose }}>
              👥 목표 · 시즌별 평균 예약
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-bold" style={{ color: PAL.mute }}>목표 누적 인원</Label>
                <Input
                  type="number"
                  value={targetPax}
                  onChange={(e) => setTargetPax(Math.max(0, Number(e.target.value) || 0))}
                  className="h-9 text-sm tabular-nums"
                />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: PAL.mute }}>휴일 단가 배수</Label>
                <Input
                  type="number"
                  value={holidaySurcharge}
                  step={0.05}
                  onChange={(e) => setHolidaySurcharge(Math.max(1, Number(e.target.value) || 1))}
                  className="h-9 text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <div>
                <Label className="text-[10px] font-bold" style={{ color: PAL.mute }}>비수기</Label>
                <Input type="number" value={avgOff} onChange={(e) => setAvgOff(Math.max(0, Number(e.target.value) || 0))} className="h-9 text-sm tabular-nums" />
              </div>
              <div>
                <Label className="text-[10px] font-bold" style={{ color: PAL.mute }}>준성수기</Label>
                <Input type="number" value={avgShoulder} onChange={(e) => setAvgShoulder(Math.max(0, Number(e.target.value) || 0))} className="h-9 text-sm tabular-nums" />
              </div>
              <div>
                <Label className="text-[10px] font-bold" style={{ color: PAL.mute }}>성수기</Label>
                <Input type="number" value={avgPeak} onChange={(e) => setAvgPeak(Math.max(0, Number(e.target.value) || 0))} className="h-9 text-sm tabular-nums" />
              </div>
              <div>
                <Label className="text-[10px] font-bold" style={{ color: PAL.mute }}>공휴일</Label>
                <Input type="number" value={avgHoliday} onChange={(e) => setAvgHoliday(Math.max(0, Number(e.target.value) || 0))} className="h-9 text-sm tabular-nums" />
              </div>
            </div>
          </div>
        </div>

        {/* 결과 — 시즌 분해표 + 누적 매출·미달 위험 */}
        {result ? (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl border-2 bg-white p-3" style={{ borderColor: PAL.rose }}>
                <div className="text-xs font-bold" style={{ color: PAL.mute }}>총 출발 횟수</div>
                <div className="mt-1 text-2xl font-black tabular-nums" style={{ color: PAL.rose }}>{result.departCount}회</div>
              </div>
              <div className="rounded-xl border-2 bg-white p-3" style={{ borderColor: PAL.violet }}>
                <div className="text-xs font-bold" style={{ color: PAL.mute }}>출발당 평균 인원</div>
                <div className="mt-1 text-2xl font-black tabular-nums" style={{ color: PAL.violet }}>{result.avgPaxPerDepart}명</div>
              </div>
              <div className="rounded-xl border-2 bg-white p-3" style={{ borderColor: PAL.emerald }}>
                <div className="text-xs font-bold" style={{ color: PAL.mute }}>누적 예상 매출</div>
                <div className="mt-1 text-xl font-black tabular-nums" style={{ color: PAL.emerald }}>{won(result.cumulativeRevenue)}</div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: PAL.inkSoft }}>마진율 {result.cumulativeMarginRate}%</div>
              </div>
              <div
                className="rounded-xl border-2 bg-white p-3"
                style={{ borderColor: result.missRiskPercent > 30 ? PAL.rose : result.missRiskPercent > 10 ? PAL.amber : PAL.emerald }}
              >
                <div className="text-xs font-bold" style={{ color: PAL.mute }}>목표 미달 위험</div>
                <div
                  className="mt-1 text-2xl font-black tabular-nums"
                  style={{ color: result.missRiskPercent > 30 ? PAL.rose : result.missRiskPercent > 10 ? PAL.amber : PAL.emerald }}
                >
                  {result.missRiskPercent}%
                </div>
                <div className="mt-0.5 text-xs font-semibold" style={{ color: PAL.inkSoft }}>달성 예상 {result.scenarioPax}명</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 text-left text-xs font-black tracking-wide" style={{ borderColor: PAL.rose, color: PAL.inkSoft }}>
                    <th className="py-2 pr-3">시즌</th>
                    <th className="py-2 pr-3 text-right">출발</th>
                    <th className="py-2 pr-3 text-right">평균 예약</th>
                    <th className="py-2 pr-3 text-right">누적 인원</th>
                    <th className="py-2 pr-3 text-right">단가</th>
                    <th className="py-2 pr-3 text-right">1인 원가</th>
                    <th className="py-2 pr-3 text-right">마진율</th>
                    <th className="py-2 pr-3 text-right">매출</th>
                    <th className="py-2 pr-3 text-right">마진</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bySeasonBreakdown.map((row) => (
                    <tr key={row.season} className="border-b" style={{ borderColor: '#F3F0E8' }}>
                      <td className="py-2 pr-3 font-bold">{SEASON_LABEL[row.season]}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.departCount}회</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.avgPax}명</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-bold">{row.bookedPax}명</td>
                      <td className="py-2 pr-3 text-right tabular-nums" style={{ color: row.season === 'holiday' ? PAL.rose : PAL.inkSoft }}>
                        {won(row.unitPrice)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{won(row.costPerAdult)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-bold" style={{ color: row.marginRate >= 0 ? PAL.emerald : PAL.rose }}>
                        {row.marginRate >= 0 ? '+' : ''}{row.marginRate.toFixed(1)}%
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-bold">{won(row.revenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-black" style={{ color: row.margin >= 0 ? PAL.emerald : PAL.rose }}>
                        {won(row.margin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-center text-sm font-medium" style={{ borderColor: PAL.line, color: PAL.mute }}>
            필수 입력 — 출발 요일·목표 누적 인원·시즌별 평균 예약 + 판매가/원가가 모두 설정되면 시뮬레이션이 자동 산출됩니다.
          </div>
        )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
