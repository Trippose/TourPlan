// 일정·동선 계산 단위 테스트

import { describe, it, expect } from 'vitest';
import { computeItinerary, formatMin, haversineKm, travelMinutes } from './itinerary';

describe('Haversine 거리', () => {
  it('서울역 ↔ 인천공항 약 47km (40~55km 범위)', () => {
    const km = haversineKm(37.5546, 126.9707, 37.4602, 126.4407);
    expect(km).toBeGreaterThan(40);
    expect(km).toBeLessThan(55);
  });

  it('같은 좌표는 0km', () => {
    expect(haversineKm(37.55, 126.97, 37.55, 126.97)).toBeCloseTo(0, 5);
  });
});

describe('travelMinutes', () => {
  it('30km @ 30km/h = 60분', () => {
    expect(travelMinutes(30, 30)).toBe(60);
  });
  it('15km @ 30km/h = 30분', () => {
    expect(travelMinutes(15, 30)).toBe(30);
  });
});

describe('computeItinerary', () => {
  it('체류시간 합산 + 좌표 있는 인접쌍만 이동시간', () => {
    const r = computeItinerary([
      { recommendedStayMin: 30 }, // 좌표 없음
      { recommendedStayMin: 60, latitude: 37.55, longitude: 126.97 },
      { recommendedStayMin: 45, latitude: 37.5, longitude: 126.95 },
    ]);
    expect(r.totalStayMin).toBe(135);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].km).toBeNull(); // 첫 좌표 없음 → null
    expect(r.legs[1].km).toBeGreaterThan(0);
    expect(r.totalMin).toBeGreaterThan(r.totalStayMin);
  });

  it('좌표 전무 시 totalTravelMin = 0', () => {
    const r = computeItinerary([
      { recommendedStayMin: 60 },
      { recommendedStayMin: 90 },
    ]);
    expect(r.totalTravelMin).toBe(0);
    expect(r.totalMin).toBe(150);
  });

  // 회귀 방지 (2026-06-11): 추정 이동시간이 소수면 표시("N분" 반올림)와 도착시각 누적(소수)이
  // 어긋나 합계 행이 ±1분 모순됐다. 추정 leg는 정수 분이어야 한다.
  it('추정 leg minutes는 정수 — 표시·누적 시각 일치 보장', () => {
    const r = computeItinerary([
      { recommendedStayMin: 90, latitude: 37.579617, longitude: 126.977041 }, // 경복궁
      { recommendedStayMin: 60, latitude: 37.563757, longitude: 126.983394 }, // 명동
    ]);
    expect(r.legs[0].minutes).not.toBeNull();
    expect(Number.isInteger(r.legs[0].minutes)).toBe(true);
    // 합계도 정수 leg의 합과 동일
    expect(r.totalTravelMin).toBe(r.legs[0].minutes);
  });

  it('수동 입력 이동시간은 그대로 보존 (override 우선)', () => {
    const r = computeItinerary([
      { recommendedStayMin: 30, latitude: 37.55, longitude: 126.97 },
      { recommendedStayMin: 30, latitude: 37.5, longitude: 126.95, travelFromPrevMin: 12 },
    ]);
    expect(r.legs[0].minutes).toBe(12);
    expect(r.totalTravelMin).toBe(12);
  });
});

describe('formatMin', () => {
  it('60분 = "1시간"', () => expect(formatMin(60)).toBe('1시간'));
  it('90분 = "1시간 30분"', () => expect(formatMin(90)).toBe('1시간 30분'));
  it('45분 = "45분"', () => expect(formatMin(45)).toBe('45분'));
});
