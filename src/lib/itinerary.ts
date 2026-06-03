// 일정·동선 계산 — Haversine 거리 + 이동시간 추정 + 일정 요약

const EARTH_KM = 6371;
// 도시 구간 평균 속도 — 서울시 도심 평균 통행속도 통계 (추정, 출처 미명시)
// 외곽·고속 구간은 더 빠르므로 카카오 모빌리티 길찾기 API로 대체 권장
export const DEFAULT_SPEED_KMH = 25;
// 직선거리(Haversine) → 실제 도로 거리 우회 계수 (도시 구간 추정)
// 정확한 값은 카카오 모빌리티 길찾기 API로 대체 권장 (별도 REST 키 필요)
export const ROAD_DETOUR_FACTOR = 1.3;

export interface ItineraryStop {
  productName?: string;
  latitude?: number;
  longitude?: number;
  recommendedStayMin?: number;
  // 이전 카드에서 현재 카드로 오는 이동시간 (분) — 사용자 수동 입력
  // 값이 있으면 좌표 기반 자동 추정을 무시하고 이 값 사용
  travelFromPrevMin?: number;
}

export interface ItineraryLeg {
  fromIndex: number;
  toIndex: number;
  km: number | null;
  minutes: number | null;
}

export interface ItinerarySummary {
  legs: ItineraryLeg[];
  totalStayMin: number;
  totalTravelMin: number;
  totalMin: number;
}

// 두 좌표 간 Haversine 거리 (km)
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

// 거리(km) → 이동시간(분), 평균속도 가정
export function travelMinutes(km: number, speedKmh = DEFAULT_SPEED_KMH): number {
  return (km / speedKmh) * 60;
}

// 일정 합산. 좌표가 없는 인접 쌍은 km/minutes null로 표시.
export function computeItinerary(
  stops: ItineraryStop[],
  speedKmh = DEFAULT_SPEED_KMH,
): ItinerarySummary {
  let totalStayMin = 0;
  let totalTravelMin = 0;
  const legs: ItineraryLeg[] = [];

  for (let i = 0; i < stops.length; i++) {
    totalStayMin += stops[i].recommendedStayMin ?? 0;
    if (i > 0) {
      const a = stops[i - 1];
      const b = stops[i];
      // 거리 — 좌표가 있을 때만 자동 추정 (override 있어도 거리는 그대로 표시)
      let km: number | null = null;
      if (
        typeof a.latitude === 'number' &&
        typeof a.longitude === 'number' &&
        typeof b.latitude === 'number' &&
        typeof b.longitude === 'number'
      ) {
        const directKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
        km = directKm * ROAD_DETOUR_FACTOR;
      }
      // 시간 — override 우선, 없으면 좌표 기반 추정
      let min: number | null;
      if (typeof b.travelFromPrevMin === 'number' && b.travelFromPrevMin >= 0) {
        min = b.travelFromPrevMin;
      } else if (km !== null) {
        min = travelMinutes(km, speedKmh);
      } else {
        min = null;
      }
      if (min !== null) totalTravelMin += min;
      legs.push({ fromIndex: i - 1, toIndex: i, km, minutes: min });
    }
  }
  return {
    legs,
    totalStayMin,
    totalTravelMin: Math.round(totalTravelMin),
    totalMin: totalStayMin + Math.round(totalTravelMin),
  };
}

// "Nh Mm" 포맷
export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
