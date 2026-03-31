"use client";

import { useState, useCallback } from "react";
import { Settings, Bot, Shield, Database, Zap, Save } from "lucide-react";
import { fetchConfig, updateCoachProfile, type AgentConfig } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import { LoadingPage } from "@/components/LoadingState";

export default function SettingsPage() {
  const { data: agentConfig, refresh } = usePolling<AgentConfig>(fetchConfig, 10000);
  const [saving, setSaving] = useState(false);
  const [toneMode, setToneMode] = useState<string | null>(null);

  const currentTone = toneMode ?? agentConfig?.coach.toneMode ?? "";

  const handleSave = useCallback(async () => {
    if (!toneMode) return;
    setSaving(true);
    try {
      await updateCoachProfile({ toneMode });
      refresh();
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }, [toneMode, refresh]);

  if (!agentConfig) return <PageShell title="Settings" subtitle="Agent configuration"><LoadingPage /></PageShell>;

  return (
    <PageShell title="Settings" subtitle="Agent configuration and coaching profile">
      {/* Agent Info */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title"><Bot size={18} /> Agent Info</div>
          <span className="badge badge-green">v{agentConfig.agent.version}</span>
        </div>
        <div className="config-grid">
          <div className="config-item">
            <div className="config-item-label">Name</div>
            <div className="config-item-value">{agentConfig.agent.name}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Model</div>
            <div className="config-item-value">{agentConfig.agent.model}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Backup Model</div>
            <div className="config-item-value">{agentConfig.agent.backupModel ?? "None"}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Max Iterations</div>
            <div className="config-item-value">{agentConfig.agent.maxIterations}</div>
          </div>
        </div>
      </div>

      {/* Coach Profile */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title"><Shield size={18} /> Coaching Profile</div>
        </div>
        <div className="config-grid" style={{ marginBottom: 16 }}>
          <div className="config-item">
            <div className="config-item-label">Drift Score</div>
            <div className="config-item-value">{agentConfig.coach.driftScore.toFixed(2)}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Logging Reliability</div>
            <div className="config-item-value">{agentConfig.coach.loggingReliability.toFixed(2)}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Active Hours</div>
            <div className="config-item-value">{agentConfig.coach.activeHours}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Encouragement</div>
            <div className="config-item-value">{agentConfig.coach.encouragementStyle}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Pressure</div>
            <div className="config-item-value">{agentConfig.coach.pressureStyle}</div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Tone Mode</label>
          <select
            className="form-select"
            value={currentTone}
            onChange={(e) => setToneMode(e.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="warm_firm">Warm & Firm</option>
            <option value="supportive">Supportive</option>
            <option value="strict">Strict</option>
          </select>
        </div>

        {toneMode && toneMode !== agentConfig.coach.toneMode && (
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setToneMode(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
              <Save size={14} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}
      </div>

      {/* Integrations */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title"><Zap size={18} /> Integrations</div>
        </div>
        <div>
          {Object.entries(agentConfig.integrations).map(([name, active]) => (
            <div key={name} className="integration-row">
              <div className={`integration-status ${active ? "active" : "inactive"}`} />
              <span className="integration-name">
                {name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
              </span>
              <span className={`badge ${active ? "badge-green" : "badge-red"}`} style={{ marginLeft: "auto" }}>
                {active ? "Connected" : "Not Set"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Memory */}
      <div className="section-card">
        <div className="section-card-header">
          <div className="section-card-title"><Database size={18} /> Memory Settings</div>
        </div>
        <div className="config-grid">
          <div className="config-item">
            <div className="config-item-label">Decay Days</div>
            <div className="config-item-value">{agentConfig.memory.decayDays}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Max Context Tokens</div>
            <div className="config-item-value">{agentConfig.memory.maxContextTokens.toLocaleString()}</div>
          </div>
          <div className="config-item">
            <div className="config-item-label">Semantic Memory</div>
            <div className="config-item-value">{agentConfig.memory.semanticEnabled ? "Enabled" : "Disabled"}</div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
