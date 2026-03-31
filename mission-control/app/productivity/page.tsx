"use client";

import { useState, useMemo } from "react";
import { Zap, Flame, Target, Trophy, Plus, Trash2, Check } from "lucide-react";
import { useLocalStorage } from "@/lib/hooks";
import PageShell from "@/components/PageShell";
import StatCard from "@/components/StatCard";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

const PHASES = [
  { name: "Foundation", range: [1, 30], color: "var(--brand-blue)" },
  { name: "Building", range: [31, 60], color: "var(--brand-orange)" },
  { name: "Mastery", range: [61, 90], color: "var(--brand-green)" },
];

function getMotivation(daysCompleted: number): string {
  if (daysCompleted === 0) return "Start your journey today.";
  if (daysCompleted < 7) return "Building the foundation. Keep showing up.";
  if (daysCompleted < 14) return "One week down. Momentum is building.";
  if (daysCompleted < 30) return "You're establishing a real habit. Don't stop.";
  if (daysCompleted < 45) return "Phase 1 complete. Growth mode unlocked.";
  if (daysCompleted < 60) return "Halfway there. You're in the arena.";
  if (daysCompleted < 75) return "The finish line is in sight. Push through.";
  if (daysCompleted < 90) return "Final stretch. Champions finish what they start.";
  return "90 days complete. You've transformed. What's next?";
}

export default function ProductivityPage() {
  const [habitData, setHabitData] = useLocalStorage<Record<string, boolean>>("mc-habits", {});
  const [todos, setTodos] = useLocalStorage<Todo[]>("mc-todos", []);
  const [notes, setNotes] = useLocalStorage<string>("mc-notes", "");
  const [startDate, setStartDate] = useLocalStorage<string>("mc-start-date", new Date().toISOString().slice(0, 10));
  const [newTodo, setNewTodo] = useState("");

  // Calculate dates for the 90-day grid
  const days = useMemo(() => {
    const start = new Date(startDate + "T00:00:00");
    return Array.from({ length: 90 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [startDate]);

  const today = new Date().toISOString().slice(0, 10);
  const daysCompleted = days.filter((d) => habitData[d]).length;

  // Current streak
  const streak = useMemo(() => {
    let count = 0;
    const todayIdx = days.indexOf(today);
    if (todayIdx === -1) return 0;
    for (let i = todayIdx; i >= 0; i--) {
      if (habitData[days[i]]) count++;
      else break;
    }
    return count;
  }, [days, today, habitData]);

  const currentPhase = PHASES.find((p) => daysCompleted >= p.range[0] - 1 && daysCompleted < p.range[1]) ?? PHASES[0];

  const toggleDay = (date: string) => {
    setHabitData((prev) => ({ ...prev, [date]: !prev[date] }));
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    setTodos((prev) => [...prev, { id: Date.now(), text: newTodo.trim(), done: false }]);
    setNewTodo("");
  };

  const toggleTodo = (id: number) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const deleteTodo = (id: number) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <PageShell title="Productivity" subtitle="90-day habit tracker and personal progress">
      <div className="stats-grid">
        <StatCard icon={Target} value={`${daysCompleted}/90`} label="Days Completed" color="green" />
        <StatCard icon={Flame} value={streak} label="Current Streak" color="orange" />
        <StatCard icon={Trophy} value={currentPhase.name} label="Current Phase" color="blue" />
        <StatCard icon={Zap} value={`${Math.round((daysCompleted / 90) * 100)}%`} label="Progress" color="red" />
      </div>

      {/* Progress Bar */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{currentPhase.name} Phase</span>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {daysCompleted} days complete
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${(daysCompleted / 90) * 100}%` }} />
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 10, fontStyle: "italic" }}>
          {getMotivation(daysCompleted)}
        </p>
      </div>

      {/* 90-Day Habit Grid */}
      <div className="section-card" style={{ marginBottom: 20 }}>
        <div className="section-card-header">
          <div className="section-card-title">90-Day Grid</div>
          <div className="section-card-subtitle">
            Start: {startDate}{" "}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => {
                const d = prompt("Start date (YYYY-MM-DD):", startDate);
                if (d) setStartDate(d);
              }}
            >
              Change
            </button>
          </div>
        </div>

        {/* Phase labels */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {PHASES.map((p) => (
            <span key={p.name} className="badge" style={{ background: `${p.color}20`, color: p.color }}>
              {p.name} ({p.range[0]}-{p.range[1]})
            </span>
          ))}
        </div>

        <div className="habit-grid">
          {days.map((date, i) => {
            const isDone = habitData[date];
            const isToday = date === today;
            const isFuture = date > today;
            const phase = PHASES.find((p) => i + 1 >= p.range[0] && i + 1 <= p.range[1]);

            return (
              <div
                key={date}
                className={`habit-cell ${isDone ? "done" : isToday ? "today" : isFuture ? "future" : "missed"}`}
                onClick={() => !isFuture && toggleDay(date)}
                title={`Day ${i + 1} — ${date}${isDone ? " (done)" : ""}`}
                style={isDone && phase ? { background: phase.color } : undefined}
              />
            );
          })}
        </div>
      </div>

      <div className="two-col">
        {/* Quick Todos */}
        <div className="section-card">
          <div className="section-card-header">
            <div className="section-card-title">Quick Todos</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              className="form-input"
              style={{ flex: 1 }}
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="Add a task..."
              onKeyDown={(e) => e.key === "Enter" && addTodo()}
            />
            <button className="btn btn-primary btn-sm" onClick={addTodo}>
              <Plus size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {todos.map((todo) => (
              <div key={todo.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: "var(--radius-sm)",
                background: "var(--bg-page)", border: "1px solid var(--border-subtle)",
              }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: 2 }}
                  onClick={() => toggleTodo(todo.id)}
                >
                  <Check size={14} style={{ color: todo.done ? "var(--brand-green)" : "var(--text-muted)" }} />
                </button>
                <span style={{
                  flex: 1, fontSize: "0.84rem",
                  textDecoration: todo.done ? "line-through" : "none",
                  color: todo.done ? "var(--text-muted)" : "var(--text-primary)",
                }}>
                  {todo.text}
                </span>
                <button className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => deleteTodo(todo.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="section-card">
          <div className="section-card-header">
            <div className="section-card-title">Notes</div>
          </div>
          <textarea
            className="form-textarea"
            style={{ minHeight: 200, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Quick notes, reflections, ideas..."
          />
        </div>
      </div>
    </PageShell>
  );
}
