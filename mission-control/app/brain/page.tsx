"use client";

import { useState, useCallback } from "react";
import { Brain, Database, GitBranch, Link2, Plus, Trash2 } from "lucide-react";
import {
  fetchFacts, addFact, deleteFact,
  fetchEntities, addEntity, deleteEntity,
  fetchRelations, addRelation, deleteRelation,
  type Fact, type Entity, type Relation,
} from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";
import TabBar from "@/components/TabBar";
import SearchBar from "@/components/SearchBar";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingState";

const tabs = [
  { key: "facts", label: "Facts", icon: Database },
  { key: "entities", label: "Entities", icon: GitBranch },
  { key: "relations", label: "Relations", icon: Link2 },
];

export default function BrainPage() {
  const [activeTab, setActiveTab] = useState("facts");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Form state
  const [formKey, setFormKey] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formRelType, setFormRelType] = useState("");

  const factsFetcher = useCallback(() => fetchFacts(search, 50), [search]);
  const entitiesFetcher = useCallback(() => fetchEntities(search, 50), [search]);
  const relationsFetcher = useCallback(() => fetchRelations(search, 50), [search]);

  const { data: factsData, loading: factsLoading, refresh: refreshFacts } = usePolling<{ facts: Fact[] }>(factsFetcher, 10000);
  const { data: entitiesData, refresh: refreshEntities } = usePolling<{ entities: Entity[] }>(entitiesFetcher, 10000);
  const { data: relationsData, refresh: refreshRelations } = usePolling<{ relations: Relation[] }>(relationsFetcher, 10000);

  const resetForm = () => {
    setFormKey(""); setFormValue(""); setFormCategory("");
    setFormName(""); setFormType("");
    setFormFrom(""); setFormTo(""); setFormRelType("");
    setShowAdd(false);
  };

  const handleAdd = async () => {
    try {
      if (activeTab === "facts") {
        await addFact({ key: formKey, value: formValue, category: formCategory || "general" });
        refreshFacts();
      } else if (activeTab === "entities") {
        await addEntity({ name: formName, type: formType });
        refreshEntities();
      } else {
        await addRelation({ from: formFrom, to: formTo, relationType: formRelType });
        refreshRelations();
      }
      resetForm();
    } catch (err) {
      console.error("Add failed:", err);
    }
  };

  const handleDeleteFact = async (id: number) => { await deleteFact(id); refreshFacts(); };
  const handleDeleteEntity = async (id: number) => { await deleteEntity(id); refreshEntities(); };
  const handleDeleteRelation = async (id: number) => { await deleteRelation(id); refreshRelations(); };

  const facts = factsData?.facts ?? [];
  const entities = entitiesData?.entities ?? [];
  const relations = relationsData?.relations ?? [];

  return (
    <PageShell title="Second Brain" subtitle="Your agent's knowledge base">
      <div className="stats-grid">
        <StatCard icon={Database} value={facts.length} label="Facts" color="green" />
        <StatCard icon={GitBranch} value={entities.length} label="Entities" color="blue" />
        <StatCard icon={Link2} value={relations.length} label="Relations" color="orange" />
      </div>

      <div className="toolbar">
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="toolbar-spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add
        </button>
      </div>

      <SearchBar
        placeholder={`Search ${activeTab}...`}
        value={search}
        onChange={setSearch}
      />

      {factsLoading && !factsData ? <LoadingPage /> : (
        <div className="section-card">
          {activeTab === "facts" && (
            facts.length === 0 ? (
              <EmptyState icon={Database} title="No Facts" description="Your agent hasn't stored any facts yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {facts.map((f) => (
                  <div key={f.id} className="activity-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: "0.86rem", color: "var(--text-primary)" }}>{f.key}</span>
                        <span className="badge badge-muted">{f.category}</span>
                      </div>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>{f.value}</p>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {formatDate(f.createdAt)} · accessed {f.accessCount}x
                      </span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteFact(f.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === "entities" && (
            entities.length === 0 ? (
              <EmptyState icon={GitBranch} title="No Entities" description="No knowledge graph entities yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entities.map((e) => (
                  <div key={e.id} className="activity-item">
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{e.name}</span>
                        <span className="badge badge-blue">{e.type}</span>
                      </div>
                      {e.properties && e.properties !== "{}" && (
                        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{e.properties}</p>
                      )}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteEntity(e.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === "relations" && (
            relations.length === 0 ? (
              <EmptyState icon={Link2} title="No Relations" description="No entity relationships stored yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {relations.map((r) => (
                  <div key={r.id} className="activity-item">
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{r.fromEntity}</span>
                      <span style={{ color: "var(--brand-orange)", margin: "0 8px", fontSize: "0.8rem" }}>{r.relationType}</span>
                      <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{r.toEntity}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteRelation(r.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={resetForm} title={`Add ${activeTab === "facts" ? "Fact" : activeTab === "entities" ? "Entity" : "Relation"}`}>
        {activeTab === "facts" && (
          <>
            <div className="form-group">
              <label className="form-label">Key</label>
              <input className="form-input" value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="e.g. favorite_language" />
            </div>
            <div className="form-group">
              <label className="form-label">Value</label>
              <textarea className="form-textarea" value={formValue} onChange={(e) => setFormValue(e.target.value)} placeholder="e.g. TypeScript" />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="e.g. preferences" />
            </div>
          </>
        )}
        {activeTab === "entities" && (
          <>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. React" />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <input className="form-input" value={formType} onChange={(e) => setFormType(e.target.value)} placeholder="e.g. technology" />
            </div>
          </>
        )}
        {activeTab === "relations" && (
          <>
            <div className="form-group">
              <label className="form-label">From Entity</label>
              <input className="form-input" value={formFrom} onChange={(e) => setFormFrom(e.target.value)} placeholder="e.g. User" />
            </div>
            <div className="form-group">
              <label className="form-label">Relation Type</label>
              <input className="form-input" value={formRelType} onChange={(e) => setFormRelType(e.target.value)} placeholder="e.g. uses" />
            </div>
            <div className="form-group">
              <label className="form-label">To Entity</label>
              <input className="form-input" value={formTo} onChange={(e) => setFormTo(e.target.value)} placeholder="e.g. React" />
            </div>
          </>
        )}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={resetForm}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd}>
            <Plus size={14} /> Add
          </button>
        </div>
      </Modal>
    </PageShell>
  );
}
