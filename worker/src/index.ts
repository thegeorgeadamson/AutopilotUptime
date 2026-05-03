interface Env {
  DB: D1Database;
}

type Target = {
  id: string;
  name: string;
  url: string;
  acceptStatus?: number[];
};

const TARGETS: Target[] = [
  {
    id: "app",
    name: "Autopilot App",
    url: "https://aplt.ai/dashboard",
    acceptStatus: [200, 401],
  },
  {
    id: "www",
    name: "aplt.ai",
    url: "https://www.aplt.ai",
    acceptStatus: [200],
  },
  {
    id: "backend",
    name: "Autopilot's Backend",
    url: "https://odoujghomokcenzuacdo.supabase.co/rest/v1/",
    acceptStatus: [200, 401],
  },
  {
    id: "companion",
    name: "Autopilot Companion",
    url: "https://api.anthropic.com",
    acceptStatus: [200, 401, 404, 405],
  },
];

const TIMEOUT_MS = 10_000;

type CheckResult = {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  status: "up" | "degraded" | "down";
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  checkedAt: string;
};

async function checkTarget(t: Target): Promise<CheckResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(t.url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "AutopilotUptime/1.0 (+https://github.com/thegeorgeadamson/AutopilotUptime)",
      },
    });
    const latencyMs = Date.now() - start;
    const accept = t.acceptStatus ?? [200];
    const ok = accept.includes(res.status);
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      ok,
      status: ok ? "up" : "degraded",
      statusCode: res.status,
      latencyMs,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return {
      id: t.id,
      name: t.name,
      url: t.url,
      ok: false,
      status: "down",
      statusCode: null,
      latencyMs: Date.now() - start,
      error: e?.name === "AbortError" ? "timeout" : (e?.message ?? "fetch failed"),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runChecks(env: Env): Promise<CheckResult[]> {
  const results = await Promise.all(TARGETS.map(checkTarget));
  const stmts = results.map((r) =>
    env.DB.prepare(
      `INSERT INTO checks (target_id, ok, status, status_code, latency_ms, error, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      r.id,
      r.ok ? 1 : 0,
      r.status,
      r.statusCode,
      r.latencyMs,
      r.error,
      r.checkedAt
    )
  );
  await env.DB.batch(stmts);
  return results;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=10",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/current") {
      const { results } = await env.DB.prepare(
        `SELECT c.target_id, c.ok, c.status, c.status_code, c.latency_ms, c.error, c.checked_at
         FROM checks c
         INNER JOIN (
           SELECT target_id, MAX(checked_at) AS max_t
           FROM checks
           GROUP BY target_id
         ) latest ON latest.target_id = c.target_id AND latest.max_t = c.checked_at`
      ).all<{
        target_id: string;
        ok: number;
        status: string;
        status_code: number | null;
        latency_ms: number;
        error: string | null;
        checked_at: string;
      }>();

      const byId: Record<string, unknown> = {};
      for (const t of TARGETS) {
        const row = results.find((r) => r.target_id === t.id);
        byId[t.id] = row
          ? {
              id: t.id,
              name: t.name,
              url: t.url,
              ok: !!row.ok,
              status: row.status,
              statusCode: row.status_code,
              latencyMs: row.latency_ms,
              error: row.error,
              checkedAt: row.checked_at,
            }
          : {
              id: t.id,
              name: t.name,
              url: t.url,
              ok: false,
              status: "unknown",
              statusCode: null,
              latencyMs: null,
              error: null,
              checkedAt: null,
            };
      }

      return json({ checkedAt: new Date().toISOString(), targets: byId });
    }

    if (url.pathname === "/history") {
      const hours = Math.min(
        168,
        Math.max(1, Number(url.searchParams.get("hours") ?? 6))
      );
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const { results } = await env.DB.prepare(
        `SELECT target_id, ok, status, status_code, latency_ms, checked_at
         FROM checks
         WHERE checked_at >= ?
         ORDER BY checked_at ASC`
      )
        .bind(since)
        .all<{
          target_id: string;
          ok: number;
          status: string;
          status_code: number | null;
          latency_ms: number;
          checked_at: string;
        }>();

      const byTarget: Record<string, unknown[]> = {};
      for (const t of TARGETS) byTarget[t.id] = [];
      for (const row of results) {
        const arr = byTarget[row.target_id];
        if (arr) {
          arr.push({
            t: row.checked_at,
            ok: !!row.ok,
            status: row.status,
            code: row.status_code,
            ms: row.latency_ms,
          });
        }
      }
      return json(byTarget);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "Autopilot Uptime API\n\nGET /current — latest check per target\nGET /history?hours=N — raw checks for the last N hours (max 168)\n",
        { headers: { "Content-Type": "text/plain", ...CORS } }
      );
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
