// 유휴 자동 로그아웃 + 슬라이딩 세션 — 인증된 페이지(빌더)에 마운트한다.
// - 사용자 활동(mousemove/keydown/click/scroll/touch) 시 마지막 활동 시각을 갱신한다.
// - 60초마다 점검: 1시간 무활동이면 로그아웃 후 /login 으로 보낸다.
//   활동 중이면 10분마다 토큰을 슬라이딩 갱신해 로그인을 유지한다.
// - 창(브라우저)을 닫으면 세션 쿠키가 삭제돼 재방문 시 /login 으로 보내진다(서버 쿠키 정책).
'use client';

import { useEffect, useRef } from 'react';

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1시간 무활동 → 로그아웃
const REFRESH_EVERY_MS = 10 * 60 * 1000; // 활동 중 10분마다 토큰 갱신
const CHECK_EVERY_MS = 60 * 1000; // 점검 주기 60초

export function AuthKeepAlive() {
  const lastActivity = useRef(Date.now());
  const lastRefresh = useRef(Date.now());

  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const logout = async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        /* 네트워크 실패해도 /login 으로 이동 */
      }
      window.location.href = '/login';
    };

    const tick = async () => {
      const now = Date.now();
      // 1시간 무활동 → 로그아웃
      if (now - lastActivity.current >= IDLE_LIMIT_MS) {
        await logout();
        return;
      }
      // 활동 중이고 마지막 갱신 후 충분히 지났으면 토큰 슬라이딩 갱신
      if (now - lastRefresh.current >= REFRESH_EVERY_MS) {
        lastRefresh.current = now;
        try {
          const r = await fetch('/api/auth/refresh', { method: 'POST' });
          if (r.status === 401) await logout();
        } catch {
          /* 네트워크 실패는 다음 tick 에서 재시도 */
        }
      }
    };

    const timer = setInterval(tick, CHECK_EVERY_MS);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, []);

  return null;
}
