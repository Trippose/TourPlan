// 라우트 세그먼트 Error Boundary — Next.js 16 App Router 표준
// 한 페이지의 렌더링 예외를 잡아 친절한 복구 UI 표시 (전체 화이트스크린 방지)
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 개발 모드에서 console에 출력. production은 모니터링 도구(Sentry 등) 연동 권장.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        backgroundColor: "#FAF7F2",
        color: "#1F2937",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: "560px",
          width: "100%",
          backgroundColor: "white",
          border: "2px solid #FBE0E8",
          borderRadius: "1.5rem",
          padding: "2rem",
          boxShadow: "0 4px 24px rgba(192,48,107,0.10)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            backgroundColor: "#FBE0E8",
            color: "#C0306B",
            fontSize: "2rem",
            margin: "0 auto 1rem",
          }}
        >
          ⚠
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          페이지 오류
        </h1>
        <p style={{ fontSize: "0.95rem", color: "#4B5563", lineHeight: 1.6, marginBottom: "1.25rem" }}>
          예상치 못한 오류가 발생했습니다.
          <br />
          잠시 후 다시 시도하거나, 페이지를 새로고침하세요.
        </p>
        {error?.digest && (
          <p style={{ fontSize: "0.75rem", color: "#9CA3AF", marginBottom: "1.25rem", fontFamily: "monospace" }}>
            오류 ID: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              backgroundColor: "#C0306B",
              color: "white",
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            🔄 다시 시도
          </button>
          <button
            type="button"
            onClick={() => (typeof window !== "undefined" ? window.location.reload() : null)}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              backgroundColor: "white",
              color: "#1F2937",
              fontWeight: 700,
              border: "2px solid #E7E2D5",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            ↻ 페이지 새로고침
          </button>
        </div>
        <div
          style={{
            marginTop: "1.5rem",
            padding: "0.75rem 1rem",
            backgroundColor: "#FAF7F2",
            borderRadius: "0.75rem",
            fontSize: "0.8rem",
            color: "#6B7280",
            textAlign: "left",
            lineHeight: 1.6,
          }}
        >
          💡 <strong>입력값이 저장되어 있습니다</strong> — 새로고침해도 패키지명·일정·차량·가이드·채널 데이터는 유지됩니다.
        </div>
      </div>
    </main>
  );
}
