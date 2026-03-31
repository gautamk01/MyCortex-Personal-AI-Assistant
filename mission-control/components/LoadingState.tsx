interface LoadingStateProps {
  width?: number | string;
  height?: number | string;
  count?: number;
}

export default function LoadingState({ width = "100%", height = 20, count = 1 }: LoadingStateProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ width, height, marginBottom: count > 1 ? 8 : 0 }}
        />
      ))}
    </>
  );
}

export function LoadingPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="stats-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 120, borderRadius: "var(--radius-lg)" }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 200, borderRadius: "var(--radius-lg)" }} />
      <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-lg)" }} />
    </div>
  );
}
