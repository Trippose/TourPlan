// 카카오맵 — 일정 순서대로 마커·번호·경로 표시 + 마커 드래그로 좌표 미세 조정.
// services 라이브러리 포함(검색용). 키 없으면 안내 박스로 폴백.
'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kakao: any;
  }
}

export interface MapStop {
  productName?: string;
  latitude?: number;
  longitude?: number;
  color?: string;
}

export interface KakaoMapProps {
  stops: MapStop[];
  onDragEnd?: (index: number, lat: number, lng: number) => void;
  shape?: 'wide' | 'square'; // wide(가로 길게, 기본) / square(정사각형)
}

export function KakaoMap({ stops, onDragEnd, shape = 'wide' }: KakaoMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 지도 인스턴스 — shape 변경 시 relayout 호출용
  const mapRef = useRef<unknown>(null);
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  // 좌표 있는 stop만 추출 + 원본 인덱스 보존 (드래그 콜백에 원본 인덱스 전달용)
  const indexed = stops
    .map((s, i) => ({ s, i }))
    .filter(
      (e): e is { s: MapStop & { latitude: number; longitude: number }; i: number } =>
        typeof e.s.latitude === 'number' && typeof e.s.longitude === 'number',
    );

  const pathKey = JSON.stringify(
    indexed.map((e) => [e.i, e.s.latitude, e.s.longitude, e.s.productName ?? '']),
  );

  useEffect(() => {
    if (!key || !ref.current) return;

    const init = () => {
      if (!window.kakao?.maps || !ref.current) return;
      window.kakao.maps.load(() => {
        if (!ref.current) return;
        const map = new window.kakao.maps.Map(ref.current, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 8,
        });
        mapRef.current = map;

        // 확대·축소 컨트롤 (우측) + 일반/스카이뷰 컨트롤 (우상단)
        map.addControl(
          new window.kakao.maps.ZoomControl(),
          window.kakao.maps.ControlPosition.RIGHT,
        );
        map.addControl(
          new window.kakao.maps.MapTypeControl(),
          window.kakao.maps.ControlPosition.TOPRIGHT,
        );
        // 마우스 휠 줌 명시 활성 (기본값이긴 하나 안전 보강)
        map.setZoomable(true);

        if (indexed.length === 0) return;

        const bounds = new window.kakao.maps.LatLngBounds();
        const path: unknown[] = [];

        // 동선별 다른 색상 팔레트 (구간 구분용)
        const PATH_COLORS = [
          '#FC2D59', '#06B6D4', '#10B981', '#F59E0B', '#8B5CF6',
          '#EC4899', '#3B82F6', '#EF4444', '#14B8A6', '#F97316',
          '#A855F7', '#84CC16', '#0EA5E9', '#D946EF', '#22C55E',
        ];

        indexed.forEach(({ s, i: origIdx }, viewIdx) => {
          const pos = new window.kakao.maps.LatLng(s.latitude, s.longitude);
          bounds.extend(pos);
          path.push(pos);

          const color = PATH_COLORS[viewIdx % PATH_COLORS.length];

          // 마커 자체를 큰 원형 숫자 배지(SVG)로 — 사용자가 배지를 직접 잡고 드래그 가능
          // (이전: 표준 마커 + 위에 CustomOverlay 배지 덮음 → 배지가 마커 hit-area를 가려 드래그 어려움)
          const num = origIdx + 1;
          const SIZE = 48;
          const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='0 0 ${SIZE} ${SIZE}'>`
            + `<defs><filter id='s' x='-20%' y='-20%' width='140%' height='140%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='black' flood-opacity='0.35'/></filter></defs>`
            + `<circle cx='${SIZE / 2}' cy='${SIZE / 2}' r='${SIZE / 2 - 4}' fill='${color}' stroke='white' stroke-width='3' filter='url(#s)'/>`
            + `<text x='${SIZE / 2}' y='${SIZE / 2 + 7}' font-size='20' font-weight='900' fill='white' text-anchor='middle' font-family='system-ui,-apple-system,sans-serif'>${num}</text>`
            + `</svg>`;
          const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
          const markerImage = new window.kakao.maps.MarkerImage(
            svgUrl,
            new window.kakao.maps.Size(SIZE, SIZE),
            { offset: new window.kakao.maps.Point(SIZE / 2, SIZE / 2) },
          );

          const marker = new window.kakao.maps.Marker({
            position: pos,
            map,
            draggable: !!onDragEnd,
            image: markerImage,
            title: onDragEnd
              ? `${num}번 — 드래그해서 위치 정밀 조정 (놓는 순간 좌표 자동 저장)`
              : `${num}번`,
            zIndex: 50 + viewIdx, // 뒤 번호일수록 위로
          });

          if (onDragEnd) {
            window.kakao.maps.event.addListener(marker, 'dragend', () => {
              const newPos = marker.getPosition();
              onDragEnd(origIdx, newPos.getLat(), newPos.getLng());
            });
          }
        });

        // 각 구간(leg)별로 별도 Polyline — 다른 색상
        for (let i = 0; i < path.length - 1; i++) {
          const segColor = PATH_COLORS[i % PATH_COLORS.length];
          new window.kakao.maps.Polyline({
            path: [path[i], path[i + 1]],
            strokeWeight: 5,
            strokeColor: segColor,
            strokeOpacity: 0.85,
            strokeStyle: 'solid',
            map,
          });
        }
        map.setBounds(bounds);
      });
    };

    if (window.kakao?.maps) {
      init();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-sdk]');
    if (existing) {
      existing.addEventListener('load', init);
      return () => existing.removeEventListener('load', init);
    }
    const script = document.createElement('script');
    // libraries=services — Places(키워드 검색)·Geocoder(주소 검색) 활성화
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    script.async = true;
    script.dataset.kakaoSdk = '1';
    script.onload = init;
    document.head.appendChild(script);
  }, [key, pathKey, onDragEnd]);

  // shape 변경 또는 컨테이너 크기 변경 시 카카오 지도에 새 크기 반영
  // 카카오 SDK는 컨테이너 resize를 자동 감지하지 않음 — relayout() 명시 호출 필요
  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const relayout = () => {
      const m = mapRef.current as { relayout?: () => void; setBounds?: (b: unknown) => void } | null;
      if (m?.relayout) {
        m.relayout();
      }
    };
    // shape 변경 직후 한 번 실행 (next paint 이후)
    const t = setTimeout(relayout, 50);
    // 이후 컨테이너 크기 동적 변경(반응형·resize)도 감지
    const ro = new ResizeObserver(relayout);
    ro.observe(node);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [shape]);

  // 지도 컨테이너 크기 — wide(가로 길게) / square(정확한 1:1)
  // square 반응형 규칙:
  //   · 모바일·태블릿(lg 미만): w-full 로 가로 최대폭 그대로 활용 → 정사각 변 = 컨테이너 폭
  //   · PC(lg ≥ 1024px): max-w-[1000px] 상한 + mx-auto 중앙 정렬 → 1:1 비율 유지
  //   · 모든 단계에서 aspect-square 가 width 기준으로 height 자동 산출하여 정확한 정사각 보장
  const shapeClass = shape === 'square'
    ? 'aspect-square w-full lg:max-w-[1000px] mx-auto'
    : 'h-[420px] w-full sm:h-[480px] lg:h-[560px]';

  if (!key) {
    return (
      <div className={`flex ${shapeClass} flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#E7E2D5] bg-white/60 p-6 text-center`}>
        <div className="text-sm font-semibold text-[#1F2937]">지도 비활성</div>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-[#6B7280]">
          카카오맵 JavaScript 키를 발급해{' '}
          <code className="rounded bg-[#F9E9C9] px-1.5 py-0.5 text-[11px] text-[#B27821]">
            .env.local · NEXT_PUBLIC_KAKAO_MAP_KEY
          </code>{' '}
          에 입력하면 자동으로 활성화됩니다 (무료, 일 30만 호출).
          <br />
          <a
            href="https://developers.kakao.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[#C0306B] underline"
          >
            developers.kakao.com
          </a>{' '}
          → 내 애플리케이션 → 앱 키 → JavaScript 키
        </p>
      </div>
    );
  }

  if (indexed.length === 0) {
    return (
      <div className={`flex ${shapeClass} items-center justify-center rounded-2xl border border-[#E7E2D5] bg-white text-sm text-[#6B7280]`}>
        장소에 좌표를 설정하면 지도에 순서대로 표시됩니다 (검색 또는 마커 드래그)
      </div>
    );
  }

  return <div ref={ref} className={`${shapeClass} rounded-2xl border border-[#E7E2D5]`} />;
}

// ─────────────────────────────────────────────────────────────
// PlaceSearch 결과 타입 (카카오 Places.keywordSearch 응답 정규화)
export interface PlaceResult {
  name: string;          // place_name (장소명)
  address: string;       // road_address_name 우선, 없으면 address_name
  lat: number;           // y (위도)
  lng: number;           // x (경도)
  category?: string;     // category_name
}

// 모듈 레벨 promise 캐싱 — 여러 컴포넌트가 동시 호출해도 SDK는 1회만 로드.
// services 로드 실패 시 null로 리셋해 다음 호출에서 재시도 가능.
let sdkPromise: Promise<boolean> | null = null;

// SDK 로드 보장 — services 라이브러리 미포함된 옛 SDK가 점유 중이면 강제 정리 후 재로드.
export function ensureKakaoSdk(): Promise<boolean> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!key) {
      resolve(false);
      return;
    }
    // 이미 services 포함 정상 로드 → 즉시 OK
    if (window.kakao?.maps?.services) {
      resolve(true);
      return;
    }

    // services 미로드 상태의 옛 window.kakao 또는 옛 스크립트 강제 정리
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).kakao) delete (window as any).kakao;
    const oldScript = document.querySelector<HTMLScriptElement>('script[data-kakao-sdk]');
    if (oldScript) oldScript.remove();

    // 새로 services 포함 SDK 로드 — https 명시 (카카오는 https만 허용)
    const url = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    console.log('[KakaoMap] SDK 로드 시작:', url);
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.kakaoSdk = '1';
    script.onload = () => {
      console.log('[KakaoMap] script onload. window.kakao=', !!window.kakao, ' .maps=', !!window.kakao?.maps);
      if (window.kakao?.maps) {
        window.kakao.maps.load(() => {
          const ok = !!window.kakao?.maps?.services;
          console.log('[KakaoMap] maps.load 완료. services=', ok);
          if (!ok) {
            console.warn('[KakaoMap] services 라이브러리 활성 실패 — SDK URL의 libraries=services 미반영 또는 카카오 측 거부');
            sdkPromise = null;
          }
          resolve(ok);
        });
      } else {
        console.error('[KakaoMap] script 로드됐지만 window.kakao.maps 없음 — 스크립트 응답 본문 확인 필요');
        sdkPromise = null;
        resolve(false);
      }
    };
    script.onerror = (e) => {
      console.error('[KakaoMap] script 다운로드 실패:', e, ' URL:', url);
      sdkPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

// 카카오 Places 키워드 검색. SDK 미로드 시 자동 로드 후 호출.
export async function kakaoPlacesSearch(keyword: string): Promise<PlaceResult[]> {
  const ok = await ensureKakaoSdk();
  if (!ok || !window.kakao?.maps?.services) {
    console.warn('[KakaoMap] services 라이브러리 로드 실패 — 검색 불가');
    return [];
  }
  return new Promise((resolve) => {
    const places = new window.kakao.maps.services.Places();
    places.keywordSearch(
      keyword,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data: any[], status: string) => {
        if (status !== window.kakao.maps.services.Status.OK) {
          resolve([]);
          return;
        }
        resolve(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data
            .slice(0, 8)
            .map((d: any) => ({
              name: d.place_name,
              address: d.road_address_name || d.address_name || '',
              lat: parseFloat(d.y),
              lng: parseFloat(d.x),
              category: d.category_name,
            }))
            // 좌표가 NaN(빈 문자열·비정상 응답)인 항목 제외 — NaN은 typeof 'number'를 통과해 지도·이동시간 계산을 깨뜨림
            .filter((p: PlaceResult) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
        );
      },
    );
  });
}
