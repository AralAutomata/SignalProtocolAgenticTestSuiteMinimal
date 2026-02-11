/**
 * ============================================================================
 * Next.js API Route Handler: /api/status/current
 * ============================================================================
 * 
 * PURPOSE:
 * Returns the current real-time system status snapshot and cumulative usage
 * statistics. This endpoint powers the dashboard's live metrics display,
 * showing the most recent telemetry data collected from the diag-probe.
 * 
 * ARCHITECTURE:
 * - HTTP GET endpoint (Next.js App Router Route Handler)
 * - Runtime: Node.js (required for SQLite database access)
 * - Simple read-only endpoint - no authentication in this demo
 * - Data sourced from local SQLite database via @/lib/state-db
 * 
 * DATA MODEL:
 * The endpoint returns three key pieces of information:
 * 
 * 1. Snapshot: The most recent system metrics collected, including:
 *    - Timestamp (createdAt)
 *    - System hostname
 *    - Load averages (1, 5, 15 minute)
 *    - Memory usage (used/total in bytes and human-readable)
 *    - Disk usage (used/total and percentage)
 *    - Network statistics (rx/tx bytes and packets)
 *    - Top processes by resource usage
 * 
 * 2. Usage Totals: Cumulative metrics since last reset:
 *    - Total data received (rx) and transmitted (tx)
 *    - Total packets received and transmitted
 *    - First recorded timestamp
 *    - Last update timestamp
 *    - Duration of monitoring period
 * 
 * 3. Staleness Indicator: Time elapsed since last snapshot:
 *    - Calculated as (now - snapshot.createdAt) in seconds
 *    - null if no snapshot exists
 *    - Useful for detecting when data collection has stopped
 * 
 * USE CASES:
 * - Dashboard "current status" card display
 * - Real-time health monitoring
 * - Alert systems (staleness detection)
 * - System overview pages
 * 
 * PERFORMANCE:
 * - Fast query (single row lookup with LIMIT 1)
 * - No complex joins or aggregations
 * - Response time typically < 10ms
 * - Suitable for frequent polling (e.g., every 5 seconds)
 * 
 * ERROR HANDLING:
 * - Returns 200 with null snapshot if no data exists
 * - Database errors bubble up as 500 with error message
 * - No input validation needed (no query parameters)
 * 
 * DEPENDENCIES:
 * - @/lib/state-db: Database access layer for telemetry data
 * - NextResponse: Next.js server response helper
 * 
 * @module apps/sysmaint-web/app/api/status/current/route
 * @see {@link @/lib/state-db} For database schema and query implementation
 * @see {@link apps/diag-probe/src/index.ts} For data collection source
 * ============================================================================
 */

import { NextResponse } from "next/server";

/**
 * Runtime configuration for this API route.
 * "nodejs" is required because the state-db module uses better-sqlite3,
 * which has native Node.js dependencies. Edge runtime is not compatible
 * with native database drivers.
 */
export const runtime = "nodejs";

/**
 * GET /api/status/current
 * 
 * Retrieves the latest system status snapshot and usage totals.
 * This is a read-only endpoint that queries the local SQLite database
 * for the most recent telemetry data.
 * 
 * @returns NextResponse with JSON containing current status
 * 
 * @example
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "snapshot": {
 *     "id": 123,
 *     "createdAt": 1704067200000,
 *     "hostname": "server-01",
 *     "load1": "1.25",
 *     "load5": "1.10",
 *     "load15": "0.95",
 *     "memUsedBytes": 8589934592,
 *     "memTotalBytes": 17179869184,
 *     "memUsedHuman": "8.0 GiB",
 *     "memTotalHuman": "16.0 GiB",
 *     "diskUsedBytes": 107374182400,
 *     "diskTotalBytes": 536870912000,
 *     "diskPercent": 20,
 *     "netRxBytes": 1048576000,
 *     "netTxBytes": 524288000,
 *     "netRxPackets": 1500000,
 *     "netTxPackets": 1200000,
 *     "topProcesses": "[{\"pid\":1234,\"name\":\"node\",...}]"
 *   },
 *   "usage": {
 *     "totalRx": 10737418240,
 *     "totalTx": 5368709120,
 *     "totalRxPackets": 15000000,
 *     "totalTxPackets": 12000000,
 *     "firstAt": 1704060000000,
 *     "lastAt": 1704067200000,
 *     "durationMinutes": 120
 *   },
 *   "staleSeconds": 0
 * }
 * 
 * // No Data Response (200):
 * {
 *   "ok": true,
 *   "snapshot": null,
 *   "usage": { ... },
 *   "staleSeconds": null
 * }
 */
export async function GET() {
  /**
   * Dynamically import the database module.
   * Using dynamic import improves cold start performance and ensures
   * the database connection is only established when this endpoint
   * is actually invoked.
   */
  const { getLatestSnapshot, getUsageTotals } = await import("@/lib/state-db");

  /**
   * Fetch the latest system snapshot from the database.
   * getLatestSnapshot() returns the most recent telemetry record
   * or null if no snapshots have been recorded yet.
   */
  const snapshot = getLatestSnapshot();

  /**
   * Fetch cumulative usage statistics.
   * getUsageTotals() aggregates network I/O metrics across all
   * recorded snapshots since the last reset.
   */
  const usage = getUsageTotals();

  /**
   * Calculate staleness indicator.
   * This shows how many seconds have passed since the last data
   * collection. Useful for detecting if the diag-probe has stopped
   * sending updates.
   * 
   * Formula: max(0, floor((now - createdAt) / 1000))
   * - Converts milliseconds to seconds
   * - Ensures non-negative value
   * - Returns null if no snapshot exists
   */
  const staleSeconds = snapshot 
    ? Math.max(0, Math.floor((Date.now() - snapshot.createdAt) / 1000)) 
    : null;

  /**
   * Return combined response with all status information.
   * The response structure is designed to be consumed directly
   * by the dashboard UI components.
   */
  return NextResponse.json({
    ok: true,
    snapshot,
    usage,
    staleSeconds
  });
}
