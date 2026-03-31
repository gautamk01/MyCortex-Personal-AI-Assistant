"use client";

import { useState, useCallback } from "react";
import { BookOpen, Plus, Save, Trash2, RefreshCw, FileText } from "lucide-react";
import {
  fetchSkills, fetchSkillContent, saveSkill, createSkill, deleteSkill, reloadSkills,
  type Skill, type SkillContent,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

const SKILL_TEMPLATE = `---
name: New Skill
description: What this skill does
triggers: keyword1, keyword2
---

Instructions go here...
`;

export default function SkillsPage() {
  const { data, loading, refresh } = usePolling<{ skills: Skill[] }>(
    useCallback(() => fetchSkills(), []), 10000
  );

  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState<string>("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const skills = data?.skills ?? [];

  const handleSelect = async (skill: Skill) => {
    setEditorLoading(true);
    try {
      const content: SkillContent = await fetchSkillContent(skill.name);
      setSelectedSkill(skill.name);
      setEditorContent(content.content);
      setDirty(false);
    } catch (err) {
      console.error("Failed to load skill:", err);
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      await saveSkill(selectedSkill, editorContent);
      setDirty(false);
      refresh();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSkill) return;
    try {
      await deleteSkill(selectedSkill);
      setSelectedSkill(null);
      setEditorContent("");
      refresh();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleCreate = async () => {
    if (!newName) return;
    try {
      const content = SKILL_TEMPLATE.replace("New Skill", newName);
      await createSkill({ name: newName, content });
      setNewName("");
      setShowCreate(false);
      refresh();
    } catch (err) {
      console.error("Create failed:", err);
    }
  };

  const handleReload = async () => {
    try {
      await reloadSkills();
      refresh();
    } catch (err) {
      console.error("Reload failed:", err);
    }
  };

  return (
    <PageShell title="Skills" subtitle="Manage agent skill definitions">
      {loading && !data ? <LoadingPage /> : (
        <>
          <div className="stats-grid">
            <StatCard icon={BookOpen} value={skills.length} label="Loaded Skills" color="blue" />
          </div>

          <div className="toolbar">
            <button className="btn btn-sm btn-secondary" onClick={handleReload}>
              <RefreshCw size={14} /> Reload All
            </button>
            <div className="toolbar-spacer" />
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> New Skill
            </button>
          </div>

          <div className="split-pane">
            {/* Skill List */}
            <div className="split-pane-sidebar">
              {skills.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", padding: 8 }}>No skills loaded</p>
              ) : (
                skills.map((skill) => (
                  <div
                    key={skill.name}
                    className={`list-item${selectedSkill === skill.name ? " active" : ""}`}
                    onClick={() => handleSelect(skill)}
                  >
                    <div className="list-item-title">{skill.name}</div>
                    <div className="list-item-desc">{skill.description}</div>
                    {skill.triggers.length > 0 && (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                        {skill.triggers.map((t) => (
                          <span key={t} className="badge badge-muted" style={{ fontSize: "0.62rem" }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Editor */}
            <div className="split-pane-main">
              {!selectedSkill ? (
                <EmptyState icon={FileText} title="Select a Skill" description="Choose a skill from the list to view and edit." />
              ) : editorLoading ? (
                <div className="skeleton" style={{ width: "100%", height: 300 }} />
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>{selectedSkill}</h3>
                    <div style={{ display: "flex", gap: 6 }}>
                      {dirty && (
                        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                          <Save size={14} /> {saving ? "Saving..." : "Save"}
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="form-textarea"
                    style={{
                      flex: 1,
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      fontSize: "0.8rem",
                      minHeight: 400,
                      resize: "vertical",
                    }}
                    value={editorContent}
                    onChange={(e) => {
                      setEditorContent(e.target.value);
                      setDirty(true);
                    }}
                  />
                </>
              )}
            </div>
          </div>

          <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Skill">
            <div className="form-group">
              <label className="form-label">Skill Name</label>
              <input className="form-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Code Reviewer" />
            </div>
            <p className="form-hint">A template will be created with the frontmatter format. You can edit it after creation.</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newName}>
                <Plus size={14} /> Create
              </button>
            </div>
          </Modal>
        </>
      )}
    </PageShell>
  );
}
