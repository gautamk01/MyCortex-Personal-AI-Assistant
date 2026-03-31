"use client";

import { useCallback } from "react";
import { BarChart3, Image, Database } from "lucide-react";
import { fetchMediaMemories, fetchContentStats } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { formatFullDate } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

export default function ContentPage() {
  const { data: statsData, loading } = usePolling<{ totalMedia: number; totalFacts: number }>(
    useCallback(() => fetchContentStats(), []), 15000
  );
  const { data: mediaData } = usePolling<{ media: Array<Record<string, unknown>> }>(
    useCallback(() => fetchMediaMemories(20), []), 15000
  );

  const media = mediaData?.media ?? [];

  return (
    <PageShell title="Content Intel" subtitle="Media memories and content overview">
      {loading && !statsData ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={Image} value={statsData?.totalMedia ?? 0} label="Media Stored" color="blue" />
            <StatCard icon={Database} value={statsData?.totalFacts ?? 0} label="Total Facts" color="green" />
          </div>

          {/* Media Memories */}
          <div className="section-card">
            <div className="section-card-header">
              <div className="section-card-title"><Image size={18} /> Media Memories</div>
            </div>

            {media.length === 0 ? (
              <EmptyState icon={BarChart3} title="No Content Yet" description="Media memories will appear here when your agent stores images, documents, or files." />
            ) : (
              <div className="card-grid">
                {media.map((item, i) => (
                  <div key={i} className="card">
                    <div className="card-header">
                      <div className="card-title" style={{ fontSize: "0.84rem" }}>
                        {String(item.filename ?? "Untitled")}
                      </div>
                      <span className="badge badge-blue">{String(item.mediaType ?? "file")}</span>
                    </div>
                    <div className="card-body">
                      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {String(item.description ?? "No description")}
                      </p>
                      {typeof item.tags === "string" && item.tags && (
                        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                          {item.tags.split(",").map((tag: string, j: number) => (
                            <span key={j} className="badge badge-muted" style={{ fontSize: "0.64rem" }}>
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                      <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 8 }}>
                        {formatFullDate(String(item.createdAt ?? ""))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
