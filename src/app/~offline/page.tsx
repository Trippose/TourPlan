// 오프라인 폴백 페이지 — 외부 의존(폰트 CDN·API) 0건. 자립 렌더.
// 서비스워커가 문서 요청 실패 시 이 페이지로 폴백.

export const metadata = {
  title: "오프라인 — 투어 단가 빌더",
  description: "네트워크 연결이 끊겼습니다. 연결 복구 후 다시 시도하세요.",
};

export default function OfflinePage() {
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
          maxWidth: "480px",
          width: "100%",
          backgroundColor: "white",
          border: "2px solid #E7E2D5",
          borderRadius: "1.5rem",
          padding: "2rem",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
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
            fontSize: "2.5rem",
            margin: "0 auto 1rem",
          }}
        >
          📡
        </div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            marginBottom: "0.75rem",
          }}
        >
          오프라인 상태
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "#4B5563",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
          }}
        >
          네트워크 연결을 확인해주세요.
          <br />
          연결이 복구되면 자동으로 페이지가 다시 로드됩니다.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            fontSize: "0.85rem",
            color: "#6B7280",
            textAlign: "left",
            backgroundColor: "#FAF7F2",
            padding: "1rem",
            borderRadius: "0.75rem",
          }}
        >
          <div>✓ 이미 캐시된 페이지는 계속 사용 가능합니다</div>
          <div>✓ 네트워크 복구 시 변경사항이 동기화됩니다</div>
          <div>✓ 카카오 모빌리티 갱신은 연결 후 가능합니다</div>
        </div>
      </div>
    </main>
  );
}
