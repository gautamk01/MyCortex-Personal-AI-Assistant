const PROD_URL = process.env.NEXT_PUBLIC_PROD_URL || "";
const LOCAL_URL = process.env.NEXT_PUBLIC_LOCAL_URL || "http://localhost:3456";
const API_SECRET = process.env.NEXT_PUBLIC_DASHBOARD_SECRET || "";

// ── Environment Detection ──────────────────────────────────────

export type Environment = "production" | "local" | "offline";

let cachedEnv: { env: Environment; baseUrl: string } | null = null;

/**
 * Try production first, then local. Caches the result for 30 seconds.
 */
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
  cacheExpiry = Date.now() + 5_000; // retry faster when offline
  return cachedEnv;
}

/** Force re-detect on next call */
export function resetEnvironmentCache() {
  cachedEnv = null;
  cacheExpiry = 0;
}

// ── API Fetch ──────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const { baseUrl, env } = await detectEnvironment();
  if (env === "offline") {
    throw new Error("Agent is offline — neither production nor local is reachable");
  }

  const res = await fetch(`${baseUrl}/api/dashboard${path}`, {
    headers: {
      "x-dashboard-secret": API_SECRET,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ── Types ──────────────────────────────────────────────────────

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

// ── API Functions ──────────────────────────────────────────────

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
