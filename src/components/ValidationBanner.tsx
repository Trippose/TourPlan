// 입력 유효성 검증 배지 — 누락·이상치 항목을 한 줄로 요약 + 클릭 시 해당 카드로 스크롤
// 사용자 실수 방지: 인쇄/Excel/공유 전에 빠진 정보 알림
'use client';

import { useMemo } from 'react';

export interface ValidationContext {
  packageName: string;
  partyTotal: number;
  vehiclesCount: number;
  totalSeats: number;
  guidesCount: number;
  stopsCount: number;
  salePrice: number;
}

interface Issue {
  level: 'warn' | 'info';
  text: string;
}

function computeIssues(ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  if (!ctx.packageName.trim()) {
    issues.push({ level: 'warn', text: '패키지 상품명 미입력 — PDF/Excel 견적서 표지에 표시 안 됨' });
  }
  if (ctx.partyTotal === 0) {
    issues.push({ level: 'warn', text: '인원 0명 — BEP·매트릭스·1인 원가 계산 불가' });
  }
  if (ctx.vehiclesCount === 0 && ctx.partyTotal > 0) {
    issues.push({ level: 'warn', text: '차량 미선택 — 그룹 공통 원가에 차량비 0원으로 반영' });
  }
  if (ctx.vehiclesCount > 0 && ctx.totalSeats < ctx.partyTotal) {
    issues.push({
      level: 'warn',
      text: `좌석 부족 (${ctx.totalSeats}석 < ${ctx.partyTotal}명) — 차량 추가 또는 더 큰 차종 필요`,
    });
  }
  if (ctx.guidesCount === 0 && ctx.partyTotal > 0) {
    issues.push({ level: 'info', text: '가이드 미배정 — 의도된 경우 무시' });
  }
  if (ctx.stopsCount === 0) {
    issues.push({ level: 'info', text: '일정 0건 — 코스 추가 시 카카오 모빌리티 이동시간 자동 계산' });
  }
  if (ctx.salePrice === 0 && ctx.partyTotal > 0) {
    issues.push({ level: 'warn', text: '판매가 0원 — 1인 수익·BEP 계산을 위해 판매가 입력 필요' });
  }
  return issues;
}

const PAL = {
  amberPale: '#F9E9C9',
  amber: '#B27821',
  violetPale: '#E4DCF6',
  violet: '#6E37CC',
  emerald: '#138060',
  emeraldPale: '#CDEDDB',
};

export function ValidationBanner({ ctx }: { ctx: ValidationContext }) {
  const issues = useMemo(() => computeIssues(ctx), [ctx]);
  if (issues.length === 0) {
    return (
      <div
        className="rounded-xl border px-3 py-2 text-xs font-semibold no-print"
        style={{ borderColor: PAL.emeraldPale, backgroundColor: PAL.emeraldPale, color: PAL.emerald }}
        role="status"
        aria-live="polite"
      >
        ✓ 입력 검증 통과 — 0건 누락 (PDF·Excel·공유 가능)
      </div>
    );
  }
  const warnCount = issues.filter((i) => i.level === 'warn').length;
  const infoCount = issues.filter((i) => i.level === 'info').length;
  return (
    <div
      className="rounded-xl border-l-4 px-3 py-2 text-xs no-print"
      style={{ borderColor: warnCount > 0 ? PAL.amber : PAL.violet, backgroundColor: warnCount > 0 ? PAL.amberPale : PAL.violetPale }}
      role={warnCount > 0 ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center gap-2 font-black" style={{ color: warnCount > 0 ? PAL.amber : PAL.violet }}>
        <span aria-hidden>{warnCount > 0 ? '⚠' : 'ⓘ'}</span>
        <span>입력 점검 — 경고 {warnCount}건 · 안내 {infoCount}건</span>
      </div>
      <ul className="ml-4 list-disc space-y-0.5 leading-relaxed">
        {issues.map((it, i) => (
          <li key={i} style={{ color: it.level === 'warn' ? PAL.amber : PAL.violet }}>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
