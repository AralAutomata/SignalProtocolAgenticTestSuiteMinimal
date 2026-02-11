/**
 * ============================================================================
 * STATE DATABASE MODULE
 * ============================================================================
 *
 * This module provides read access to the shared state database used by
 * sysmaint-agent. It retrieves telemetry snapshots and usage statistics
 * for display in the web dashboard.
 *
 * DATABASE SCHEMA:
 *
 * The state database is shared between sysmaint-agent and sysmaint-web.
 * It contains:
 * - snapshots: Telemetry data points from diag-probe
 * - chat_messages: Chat history (managed by agent)
 * - usage_resets: Markers for resetting usage counters
 *
 * READ-ONLY OPERATIONS:
 *
 * This module only reads from the database. All writes are performed by
 * sysmaint-agent. The web app queries this data for dashboard display.
 *
 * ============================================================================
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { stateDbPath } from "./config";

/**
 * Type representing a telemetry snapshot.
 * Contains system metrics at a point in time.
 */
export type StatusSnapshot = {
  createdAt: number;           // Timestamp
  cpuPct: number;              // CPU usage %
  memPct: number;              // Memory usage %
  swapPct: number;             // Swap usage %
  netInBytes: number;          // Network bytes received
  netOutBytes: number;         // Network bytes sent
  load: [number, number, number];  // Load averages [1m, 5m, 15m]
  relay: {
    users: number;             // Registered users
    prekeys: number;           // Prekey bundles
    queuedMessages: number;    // Undelivered messages
    activeConnections: number; // Active WebSockets
    uptimeSec: number;         // Relay uptime
  };
};

/**
 * Type representing aggregated usage statistics.
 * Shows AI API usage and costs.
 */
export type UsageTotals = {
  requests: number;            // Number of AI replies
  inputTokens: number;         // Total input tokens
  outputTokens: number;        // Total output tokens
  totalTokens: number;         // Combined tokens
  estimatedCostUsd: number;    // Estimated API cost
  averageTokensPerReply: number;  // Average tokens per response
  lastReplyAt: number | null;  // Timestamp of last reply
};

/**
 * Initialize database connection.
 *
 * Creates directory if needed and opens database.
 * Note: This opens the same database that sysmaint-agent writes to.
 */
mkdirSync(path.dirname(stateDbPath), { recursive: true });
const db = new Database(stateDbPath, { readonly: false });

/**
 * Initialize database schema.
 *
 * Creates tables if they don't exist.
 * These mirror the schema in sysmaint-agent.
 */
db.exec(
  // Telemetry snapshots table
  "CREATE TABLE IF NOT EXISTS snapshots (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "report_id TEXT NOT NULL," +
    "source TEXT NOT NULL," +
    "created_at INTEGER NOT NULL," +
    "cpu_pct REAL NOT NULL," +
    "mem_pct REAL NOT NULL," +
    "swap_pct REAL NOT NULL," +
    "net_in_bytes REAL NOT NULL," +
    "net_out_bytes REAL NOT NULL," +
    "load1 REAL NOT NULL," +
    "load5 REAL NOT NULL," +
    "load15 REAL NOT NULL," +
    "relay_uptime_sec INTEGER NOT NULL," +
    "relay_users INTEGER NOT NULL," +
    "relay_prekeys INTEGER NOT NULL," +
    "relay_queued INTEGER NOT NULL," +
    "relay_active_ws INTEGER NOT NULL" +
    ");" +
    // Usage reset markers table
    "CREATE TABLE IF NOT EXISTS usage_resets (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
    "created_at INTEGER NOT NULL" +
    ");"
);

/**
 * Database row type for snapshot queries.
 */
type SnapshotRow = {
  created_at: number;
  cpu_pct: number;
  mem_pct: number;
  swap_pct: number;
  net_in_bytes: number;
  net_out_bytes: number;
  load1: number;
  load5: number;
  load15: number;
  relay_uptime_sec: number;
  relay_users: number;
  relay_prekeys: number;
  relay_queued: number;
  relay_active_ws: number;
};

/**
 * Database row type for table_info queries.
 */
type TableInfoRow = {
  name: string;
};

/**
 * Database row type for usage queries.
 */
type UsageRow = {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  last_reply_at: number | null;
};

/**
 * Database row type for usage reset queries.
 */
type UsageResetRow = {
  created_at: number | null;
};

/**
 * Map database row to StatusSnapshot type.
 *
 * @param row - Database row
 * @returns StatusSnapshot object
 */
function mapRow(row: SnapshotRow): StatusSnapshot {
  return {
    createdAt: row.created_at,
    cpuPct: row.cpu_pct,
    memPct: row.mem_pct,
    swapPct: row.swap_pct,
    netInBytes: row.net_in_bytes,
    netOutBytes: row.net_out_bytes,
    load: [row.load1, row.load5, row.load15],
    relay: {
      users: row.relay_users,
      prekeys: row.relay_prekeys,
      queuedMessages: row.relay_queued,
      activeConnections: row.relay_active_ws,
      uptimeSec: row.relay_uptime_sec
    }
  };
}

/**
 * Get the most recent telemetry snapshot.
 *
 * @returns Latest StatusSnapshot or null if no data
 */
export function getLatestSnapshot(): StatusSnapshot | null {
  const row = db
    .prepare(
      "SELECT created_at, cpu_pct, mem_pct, swap_pct, net_in_bytes, net_out_bytes, load1, load5, load15, relay_uptime_sec, relay_users, relay_prekeys, relay_queued, relay_active_ws FROM snapshots ORDER BY created_at DESC LIMIT 1"
    )
    .get() as SnapshotRow | undefined;

  if (!row) return null;
  return mapRow(row);
}

/**
 * Get recent telemetry snapshots.
 *
 * @param minutes - How many minutes of history to fetch
 * @param limit - Maximum number of snapshots (default: 120)
 * @returns Array of StatusSnapshot objects
 */
export function getRecentSnapshots(minutes: number, limit = 120): StatusSnapshot[] {
  const since = Date.now() - minutes * 60_000;
  const rows = db
    .prepare(
      "SELECT created_at, cpu_pct, mem_pct, swap_pct, net_in_bytes, net_out_bytes, load1, load5, load15, relay_uptime_sec, relay_users, relay_prekeys, relay_queued, relay_active_ws FROM snapshots WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(since, limit) as SnapshotRow[];
  return rows.map(mapRow);
}

/**
 * Check if chat_messages table has usage tracking columns.
 *
 * This handles schema migration gracefully.
 *
 * @returns true if columns exist
 */
function hasChatUsageColumns(): boolean {
  const rows = db.prepare("PRAGMA table_info(chat_messages)").all() as TableInfoRow[];
  if (rows.length === 0) return false;
  const names = new Set(rows.map((row) => row.name));
  return (
    names.has("input_tokens") &&
    names.has("output_tokens") &&
    names.has("total_tokens") &&
    names.has("estimated_cost_usd")
  );
}

/**
 * Get the timestamp of the most recent usage reset.
 *
 * @returns Timestamp in milliseconds, or 0 if no resets
 */
function getUsageWindowStart(): number {
  const row = db.prepare("SELECT MAX(created_at) AS created_at FROM usage_resets").get() as UsageResetRow | undefined;
  return row?.created_at ? Number(row.created_at) : 0;
}

/**
 * Record a new usage reset marker.
 *
 * @param at - Timestamp for the reset (default: now)
 * @returns The timestamp
 */
export function resetUsageTotals(at = Date.now()): number {
  db.prepare("INSERT INTO usage_resets (created_at) VALUES (?)").run(at);
  return at;
}

/**
 * Get aggregated AI usage totals since last reset.
 *
 * Calculates:
 * - Total requests (AI replies)
 * - Token counts (input, output, total)
 * - Estimated API cost
 * - Average tokens per reply
 * - Timestamp of last reply
 *
 * @returns UsageTotals object
 */
export function getUsageTotals(): UsageTotals {
  // Check if we can calculate usage (columns exist)
  if (!hasChatUsageColumns()) {
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      averageTokensPerReply: 0,
      lastReplyAt: null
    };
  }

  // Get start time (last reset or 0)
  const startAt = getUsageWindowStart();

  // Query aggregated statistics
  const row = db
    .prepare(
      "SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens, COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd, MAX(created_at) AS last_reply_at FROM chat_messages WHERE direction = 'out' AND created_at > ?"
    )
    .get(startAt) as UsageRow | undefined;

  if (!row) {
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      averageTokensPerReply: 0,
      lastReplyAt: null
    };
  }

  // Calculate derived statistics
  const requests = Number(row.requests) || 0;
  const totalTokens = Number(row.total_tokens) || 0;

  return {
    requests,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    totalTokens,
    estimatedCostUsd: Number((Number(row.estimated_cost_usd) || 0).toFixed(8)),
    averageTokensPerReply: requests > 0 ? Number((totalTokens / requests).toFixed(1)) : 0,
    lastReplyAt: row.last_reply_at ? Number(row.last_reply_at) : null
  };
}
