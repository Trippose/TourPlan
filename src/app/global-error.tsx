// Global Error Boundary — 루트 layout 자체가 깨졌을 때의 최후 폴백
// Next.js 16 App Router에서 global-error.tsx는 자체 <html><body> 가 필요 (layout 미적용)
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          padding: "2rem",
          backgroundColor: "#FAF7F2",
          color: "#1F2937",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: "520px",
            width: "100%",
            backgroundColor: "white",
            border: "2px solid #C0306B",
            borderRadius: "1.5rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🛑</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.75rem" }}>
            치명적 오류
          </h1>
          <p style={{ color: "#4B5563", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            애플리케이션 전체에 영향을 미친 오류가 발생했습니다.
            <br />
            새로고침 또는 캐시 비움이 필요할 수 있습니다.
          </p>
          {error?.digest && (
            <p style={{ fontSize: "0.75rem", color: "#9CA3AF", marginBottom: "1.25rem", fontFamily: "monospace" }}>
              오류 ID: {error.digest}
            </p>
          )}
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
            🔄 애플리케이션 재시작
          </button>
        </div>
      </body>
    </html>
  );
}
