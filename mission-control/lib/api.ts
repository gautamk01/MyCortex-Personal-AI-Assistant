const PROD_URL = process.env.NEXT_PUBLIC_PROD_URL || "";
const LOCAL_URL = process.env.NEXT_PUBLIC_LOCAL_URL || "http://localhost:3456";
const API_SECRET = process.env.NEXT_PUBLIC_DASHBOARD_SECRET || "";

// ── Environment Detection ──────────────────────────────────────

export type Environment = "production" | "local" | "offline";

let cachedEnv: { env: Environment; baseUrl: string } | null = null;
let cacheExpiry = 0;

export async function detectEnvironment(): Promise<{
  env: Environment;
  baseUrl: string;
}> {
  if (cachedEnv && Date.now() < cacheExpiry) {
    return cachedEnv;
  }

  // Try local first (priority when running)
  try {
    const res = await fetch(`${LOCAL_URL}/api/dashboard/stats`, {
      headers: { "x-dashboard-secret": API_SECRET },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      cachedEnv = { env: "local", baseUrl: LOCAL_URL };
      cacheExpiry = Date.now() + 30_000;
      return cachedEnv;
    }
  } catch {
    // Local not reachable, try production
  }

  // Fall back to production
  if (PROD_URL) {
    try {
      const res = await fetch(`${PROD_URL}/api/dashboard/stats`, {
        headers: { "x-dashboard-secret": API_SECRET },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        cachedEnv = { env: "production", baseUrl: PROD_URL };
        cacheExpiry = Date.now() + 30_000;
        return cachedEnv;
      }
    } catch {
      // Production not reachable either
    }
  }

  cachedEnv = { env: "offline", baseUrl: "" };
  cacheExpiry = Date.now() + 5_000;
  return cachedEnv;
}

export function resetEnvironmentCache() {
  cachedEnv = null;
  cacheExpiry = 0;
}

// ── Generic API Helpers ───────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const { baseUrl, env } = await detectEnvironment();
  if (env === "offline") {
    throw new Error("Agent is offline — neither production nor local is reachable");
  }

  const res = await fetch(`${baseUrl}/api/dashboard${path}`, {
    headers: { "x-dashboard-secret": API_SECRET },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const { baseUrl, env } = await detectEnvironment();
  if (env === "offline") {
    throw new Error("Agent is offline");
  }

  const res = await fetch(`${baseUrl}/api/dashboard${path}`, {
    method: "POST",
    headers: {
      "x-dashboard-secret": API_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API POST ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const { baseUrl, env } = await detectEnvironment();
  if (env === "offline") {
    throw new Error("Agent is offline");
  }

  const res = await fetch(`${baseUrl}/api/dashboard${path}`, {
    method: "PUT",
    headers: {
      "x-dashboard-secret": API_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API PUT ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const { baseUrl, env } = await detectEnvironment();
  if (env === "offline") {
    throw new Error("Agent is offline");
  }

  const res = await fetch(`${baseUrl}/api/dashboard${path}`, {
    method: "DELETE",
    headers: { "x-dashboard-secret": API_SECRET },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API DELETE ${path} failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Types ──────────────────────────────────────────────────────

// Dashboard Stats
export interface DashboardStats {
  level: number;
  totalExp: number;
  expToday: number;
  heartbeatsToday: number;
  totalFacts: number;
  uptime: string;
  uptimeMs: number;
  plan: {
    total: number;
    done: number;
    mustTotal: number;
    mustDone: number;
  };
}

// Activity Feed
export interface HeartbeatActivity {
  type: "heartbeat";
  id: string;
  theme: string;
  message: string;
  reason: string;
  responded: boolean;
  createdAt: string;
}

export interface ExpActivity {
  type: "exp";
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export type ActivityItem = HeartbeatActivity | ExpActivity;

// Agent Config
export interface AgentConfig {
  agent: {
    name: string;
    version: string;
    model: string;
    backupModel: string | null;
    maxIterations: number;
  };
  coach: {
    toneMode: string;
    encouragementStyle: string;
    pressureStyle: string;
    driftScore: number;
    loggingReliability: number;
    activeHours: string;
  };
  integrations: Record<string, boolean>;
  memory: {
    decayDays: number;
    maxContextTokens: number;
    semanticEnabled: boolean;
  };
}

// Daily Plan
export interface PlanItem {
  id: number;
  title: string;
  category: string;
  priority: string;
  status: string;
  timeBlock: string;
}

export interface PlanResponse {
  plan: {
    id: number;
    planDate: string;
    status: string;
    items: PlanItem[];
  } | null;
  stats: {
    total: number;
    done: number;
    mustTotal: number;
    mustDone: number;
  } | null;
}

// Second Brain
export interface Fact {
  id: number;
  key: string;
  value: string;
  category: string;
  importance: number;
  accessCount: number;
  createdAt: string;
  lastAccessed: string;
}

export interface Entity {
  id: number;
  name: string;
  type: string;
  properties: string;
  importance: number;
  createdAt: string;
}

export interface Relation {
  id: number;
  fromEntity: string;
  toEntity: string;
  relationType: string;
  importance: number;
}

// Logs
export interface WorkLog {
  id: number;
  category: string;
  description: string;
  durationMinutes: number;
  expEarned: number;
  createdAt: string;
}

export interface LifeLog {
  id: number;
  category: string;
  description: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  createdAt: string;
}

export interface DailySummary {
  id: number;
  summaryDate: string;
  summaryText: string;
  metricsJson: string;
  createdAt: string;
}

export interface ExpLogEntry {
  id: number;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface ExpTrendDay {
  date: string;
  total: number;
}

// Scheduler
export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  action: string;
  chatId: number;
  paused: boolean;
  createdAt: string;
}

// MCP
export interface McpServer {
  name: string;
  tools: string[];
  toolCount: number;
  connected: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

// Skills
export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  filePath: string;
}

export interface SkillContent {
  name: string;
  content: string;
}

// Tools
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
}

// Connections
export interface IntegrationStatus {
  name: string;
  connected: boolean;
  details?: string;
}

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  hasSecret: boolean;
  chatId: number;
}

// ── API Functions: Existing ───────────────────────────────────

export function fetchStats(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>("/stats");
}

export function fetchActivity(limit = 30): Promise<{ activity: ActivityItem[] }> {
  return apiFetch<{ activity: ActivityItem[] }>(`/activity?limit=${limit}`);
}

export function fetchConfig(): Promise<AgentConfig> {
  return apiFetch<AgentConfig>("/config");
}

export function fetchPlan(): Promise<PlanResponse> {
  return apiFetch<PlanResponse>("/plan");
}

// ── API Functions: Tasks / Plan ───────────────────────────────

export function completePlanItem(itemId: number): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/plan/items/${itemId}/complete`, {});
}

export function updatePlanItem(
  itemId: number,
  data: { status?: string; title?: string; priority?: string }
): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/plan/items/${itemId}/update`, data);
}

// ── API Functions: Settings ───────────────────────────────────

export function updateCoachProfile(data: {
  toneMode?: string;
  encouragementStyle?: string;
  pressureStyle?: string;
}): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/config/coach", data);
}

// ── API Functions: Second Brain ───────────────────────────────

export function fetchFacts(query = "", limit = 50): Promise<{ facts: Fact[] }> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch<{ facts: Fact[] }>(`/brain/facts?${params}`);
}

export function addFact(data: { key: string; value: string; category: string }): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/brain/facts", data);
}

export function deleteFact(id: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/brain/facts/${id}`);
}

export function fetchEntities(query = "", limit = 50): Promise<{ entities: Entity[] }> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch<{ entities: Entity[] }>(`/brain/entities?${params}`);
}

export function addEntity(data: { name: string; type: string; properties?: string }): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/brain/entities", data);
}

export function deleteEntity(id: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/brain/entities/${id}`);
}

export function fetchRelations(query = "", limit = 50): Promise<{ relations: Relation[] }> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch<{ relations: Relation[] }>(`/brain/relations?${params}`);
}

export function addRelation(data: { from: string; to: string; relationType: string }): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/brain/relations", data);
}

export function deleteRelation(id: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/brain/relations/${id}`);
}

// ── API Functions: Logs & Analytics ───────────────────────────

export function fetchWorkLogs(limit = 30, from?: string, to?: string): Promise<{ logs: WorkLog[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiFetch<{ logs: WorkLog[] }>(`/logs/work?${params}`);
}

export function fetchLifeLogs(limit = 30, from?: string, to?: string): Promise<{ logs: LifeLog[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiFetch<{ logs: LifeLog[] }>(`/logs/life?${params}`);
}

export function fetchDailySummaries(limit = 14): Promise<{ summaries: DailySummary[] }> {
  return apiFetch<{ summaries: DailySummary[] }>(`/logs/summaries?limit=${limit}`);
}

export function fetchExpHistory(days = 30): Promise<{ entries: ExpLogEntry[] }> {
  return apiFetch<{ entries: ExpLogEntry[] }>(`/logs/exp?days=${days}`);
}

export function fetchExpTrend(days = 30): Promise<{ trend: ExpTrendDay[] }> {
  return apiFetch<{ trend: ExpTrendDay[] }>(`/logs/exp/trend?days=${days}`);
}

// ── API Functions: Scheduler ──────────────────────────────────

export function fetchScheduledTasks(): Promise<{ tasks: ScheduledTask[] }> {
  return apiFetch<{ tasks: ScheduledTask[] }>("/scheduler/tasks");
}

export function createScheduledTask(data: {
  name: string;
  cron: string;
  action: string;
}): Promise<{ ok: boolean; id: string }> {
  return apiPost<{ ok: boolean; id: string }>("/scheduler/tasks", data);
}

export function pauseScheduledTask(id: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/scheduler/tasks/${id}/pause`, {});
}

export function resumeScheduledTask(id: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/scheduler/tasks/${id}/resume`, {});
}

export function deleteScheduledTask(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/scheduler/tasks/${id}`);
}

// ── API Functions: MCP ────────────────────────────────────────

export function fetchMcpServers(): Promise<{ servers: McpServer[] }> {
  return apiFetch<{ servers: McpServer[] }>("/mcp/servers");
}

export function fetchMcpConfig(): Promise<McpConfig> {
  return apiFetch<McpConfig>("/mcp/config");
}

export function addMcpServer(data: {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/mcp/servers", data);
}

export function removeMcpServer(name: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/mcp/servers/${encodeURIComponent(name)}`);
}

export function restartMcpServer(name: string): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>(`/mcp/servers/${encodeURIComponent(name)}/restart`, {});
}

// ── API Functions: Skills ─────────────────────────────────────

export function fetchSkills(): Promise<{ skills: Skill[] }> {
  return apiFetch<{ skills: Skill[] }>("/skills");
}

export function fetchSkillContent(name: string): Promise<SkillContent> {
  return apiFetch<SkillContent>(`/skills/${encodeURIComponent(name)}`);
}

export function saveSkill(name: string, content: string): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}`, { content });
}

export function createSkill(data: { name: string; content: string }): Promise<{ ok: boolean }> {
  return apiPost<{ ok: boolean }>("/skills", data);
}

export function deleteSkill(name: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}`);
}

export function reloadSkills(): Promise<{ ok: boolean; count: number }> {
  return apiPost<{ ok: boolean; count: number }>("/skills/reload", {});
}

// ── API Functions: Tools ──────────────────────────────────────

export function fetchAllTools(): Promise<{ tools: ToolDefinition[] }> {
  return apiFetch<{ tools: ToolDefinition[] }>("/tools");
}

// ── API Functions: Connections ─────────────────────────────────

export function fetchIntegrationHealth(): Promise<{ integrations: IntegrationStatus[] }> {
  return apiFetch<{ integrations: IntegrationStatus[] }>("/connections/health");
}

export function fetchWebhooks(): Promise<{ webhooks: WebhookInfo[] }> {
  return apiFetch<{ webhooks: WebhookInfo[] }>("/connections/webhooks");
}

// ── API Functions: Content ────────────────────────────────────

export function fetchMediaMemories(limit = 20): Promise<{ media: Array<Record<string, unknown>> }> {
  return apiFetch<{ media: Array<Record<string, unknown>> }>(`/content/media?limit=${limit}`);
}

export function fetchContentStats(): Promise<{ totalMedia: number; totalFacts: number }> {
  return apiFetch<{ totalMedia: number; totalFacts: number }>("/content/stats");
}

// ── Workflow Types ────────────────────────────────────────────

export interface WorkflowNodeData {
  toolName?: string;
  toolParams?: Record<string, unknown>;
  label: string;
  category?: string;
  description?: string;
  conditionType?: "includes" | "equals" | "not_empty";
  conditionValue?: string;
  delayMs?: number;
}

export interface WorkflowNode {
  id: string;
  type: "tool" | "condition" | "delay";
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: "draft" | "ready" | "running" | "error";
  lastRunAt?: string;
  lastRunStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodeExecutionResult {
  nodeId: string;
  status: "success" | "error" | "skipped";
  result?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "success" | "error";
  nodeResults: NodeExecutionResult[];
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// ── API Functions: Workflows ──────────────────────────────────

export function fetchWorkflows(): Promise<{ workflows: Workflow[] }> {
  return apiFetch<{ workflows: Workflow[] }>("/workflows");
}

export function fetchWorkflow(id: string): Promise<Workflow> {
  return apiFetch<Workflow>(`/workflows/${id}`);
}

export function createWorkflow(data?: { name?: string; description?: string }): Promise<{ ok: boolean; id: string }> {
  return apiPost<{ ok: boolean; id: string }>("/workflows", data ?? {});
}

export function updateWorkflow(
  id: string,
  data: { name?: string; description?: string; nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; status?: string }
): Promise<{ ok: boolean }> {
  return apiPut<{ ok: boolean }>(`/workflows/${id}`, data);
}

export function deleteWorkflow(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/workflows/${id}`);
}

export function executeWorkflowApi(id: string): Promise<{ ok: boolean; runId: string; status: string }> {
  return apiPost<{ ok: boolean; runId: string; status: string }>(`/workflows/${id}/execute`, {});
}

export function fetchWorkflowRuns(id: string): Promise<{ runs: WorkflowRun[] }> {
  return apiFetch<{ runs: WorkflowRun[] }>(`/workflows/${id}/runs`);
}

export function fetchWorkflowRun(runId: string): Promise<WorkflowRun> {
  return apiFetch<WorkflowRun>(`/workflows/runs/${runId}`);
}

