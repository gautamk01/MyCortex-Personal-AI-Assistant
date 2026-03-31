"use client";

import { useState, useCallback } from "react";
import { FileText, Briefcase, Heart, BarChart3, TrendingUp } from "lucide-react";
import {
  fetchWorkLogs, fetchLifeLogs, fetchDailySummaries, fetchExpTrend,
  type WorkLog, type LifeLog, type DailySummary, type ExpTrendDay,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { formatFullDate, formatMinutes } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import TabBar from "@/components/TabBar";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

const tabs = [
  { key: "work", label: "Work Logs", icon: Briefcase },
  { key: "life", label: "Life Logs", icon: Heart },
  { key: "summaries", label: "Summaries", icon: FileText },
  { key: "exp", label: "EXP Trend", icon: TrendingUp },
];

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState("work");

  const { data: workData, loading: workLoading } = usePolling<{ logs: WorkLog[] }>(
    useCallback(() => fetchWorkLogs(30), []), 15000
  );
  const { data: lifeData } = usePolling<{ logs: LifeLog[] }>(
    useCallback(() => fetchLifeLogs(30), []), 15000
  );
  const { data: summaryData } = usePolling<{ summaries: DailySummary[] }>(
    useCallback(() => fetchDailySummaries(14), []), 30000
  );
  const { data: trendData } = usePolling<{ trend: ExpTrendDay[] }>(
    useCallback(() => fetchExpTrend(30), []), 30000
  );

  const workLogs = workData?.logs ?? [];
  const lifeLogs = lifeData?.logs ?? [];
  const summaries = summaryData?.summaries ?? [];
  const trend = trendData?.trend ?? [];
  const maxExp = Math.max(...trend.map((t) => t.total), 1);

  return (
    <PageShell title="Logs & Analytics" subtitle="Work sessions, life events, and EXP trends">
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {workLoading && !workData ? <LoadingPage /> : (
        <>
          {/* Work Logs */}
          {activeTab === "work" && (
            <div className="section-card">
              {workLogs.length === 0 ? (
                <EmptyState icon={Briefcase} title="No Work Logs" description="No work sessions logged yet." />
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Duration</th>
                        <th>EXP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{formatFullDate(log.createdAt)}</td>
                          <td><span className="badge badge-blue">{log.category}</span></td>
                          <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {log.description}
                          </td>
                          <td>{formatMinutes(log.durationMinutes)}</td>
                          <td><span className="badge badge-green">+{log.expEarned}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Life Logs */}
          {activeTab === "life" && (
            <div className="section-card">
              {lifeLogs.length === 0 ? (
                <EmptyState icon={Heart} title="No Life Logs" description="No life events tracked yet." />
              ) : (
                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lifeLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{formatFullDate(log.createdAt)}</td>
                          <td><span className="badge badge-orange">{log.category}</span></td>
                          <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {log.description}
                          </td>
                          <td>{formatMinutes(log.durationMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Daily Summaries */}
          {activeTab === "summaries" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {summaries.length === 0 ? (
                <div className="section-card">
                  <EmptyState icon={FileText} title="No Summaries" description="No daily summaries generated yet." />
                </div>
              ) : (
                summaries.map((s) => (
                  <div key={s.id} className="section-card">
                    <div className="section-card-header">
                      <div className="section-card-title">{s.summaryDate}</div>
                    </div>
                    <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {s.summaryText}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* EXP Trend */}
          {activeTab === "exp" && (
            <div className="section-card">
              <div className="section-card-header">
                <div className="section-card-title"><BarChart3 size={18} /> Daily EXP (Last 30 Days)</div>
              </div>
              {trend.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No Data" description="No EXP earned in this period." />
              ) : (
                <div className="bar-chart">
                  {trend.map((day) => (
                    <div key={day.date} className="bar-chart-col">
                      <div
                        className="bar-chart-bar"
                        style={{ height: `${(day.total / maxExp) * 100}%` }}
                        title={`${day.date}: ${day.total} EXP`}
                      />
                      <div className="bar-chart-label">
                        {new Date(day.date + "T00:00:00").getDate()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
