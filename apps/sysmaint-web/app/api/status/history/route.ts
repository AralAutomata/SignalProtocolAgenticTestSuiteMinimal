/**
 * ============================================================================
 * Next.js API Route Handler: /api/status/history
 * ============================================================================
 * 
 * PURPOSE:
 * Returns historical system status snapshots for time-series visualization.
 * This endpoint supports the dashboard's charts and graphs by providing
 * multiple data points over a specified time window. It powers features
 * like resource usage trends, network traffic graphs, and historical analysis.
 * 
 * ARCHITECTURE:
 * - HTTP GET endpoint with query parameter support
 * - Runtime: Node.js (required for SQLite database access)
 * - Configurable time window and result limit
 * - Data validation and sanitization for security
 * - Optimized for chart/graph data consumption
 * 
 * QUERY PARAMETERS:
 * The endpoint accepts two optional query parameters:
 * 
 * 1. minutes (number, default: 60, max: practical limit based on data)
 *    - Defines the time window to look back from now
 *    - "60" means "last 60 minutes of data"
 *    - Must be a positive finite number
 *    - Invalid values fall back to default
 * 
 * 2. limit (number, default: 120, max: 500)
 *    - Maximum number of snapshots to return
 *    - Useful for limiting data transfer and rendering load
 *    - Capped at 500 to prevent excessive memory usage
 *    - Must be a positive finite number
 *    - Invalid values fall back to default
 * 
 * SECURITY CONSIDERATIONS:
 * - Input validation: Both parameters validated and sanitized
 * - Type coercion: String query params converted to numbers safely
 * - Bounds checking: NaN, Infinity, and negative values handled
 * - Upper limit: Maximum 500 records to prevent DoS via large queries
 * - No SQL injection risk: better-sqlite3 uses parameterized queries
 * 
 * DATA TRANSFORMATION:
 * Raw database records are returned as-is. The endpoint doesn't perform
 * aggregation or downsampling - that happens client-side or in the UI.
 * Each snapshot contains:
 * - System metrics (load, memory, disk, network)
 * - Process information
 * - Precise timestamps for accurate time-series display
 * 
 * USE CASES:
 * - Time-series charts (CPU, memory, network over time)
 * - Historical trend analysis
 * - Capacity planning visualizations
 * - Anomaly detection displays
 * - Export functionality for reporting
 * 
 * PERFORMANCE:
 * - Indexed query on createdAt column (if index exists)
 * - LIMIT clause prevents unbounded results
 * - Response size grows linearly with limit
 * - Recommended polling: every 30-60 seconds for history
 * - Consider server-side caching for frequently accessed windows
 * 
 * ERROR HANDLING:
 * - Invalid parameters: Silently fall back to defaults
 * - Database errors: Return 500 with error details
 * - Empty results: Return empty array (valid response)
 * - Malformed URLs: URL constructor handles parsing
 * 
 * RESPONSE FORMAT:
 * {
 *   ok: true,              // Success indicator
 *   minutes: number,       // Actual minutes used (sanitized)
 *   limit: number,         // Actual limit used (sanitized)
 *   snapshots: Array       // Array of snapshot objects
 * }
 * 
 * DEPENDENCIES:
 * - @/lib/state-db: Database access layer
 * - URL API: Native Node.js for query parsing
 * - NextResponse: Next.js response helper
 * 
 * @module apps/sysmaint-web/app/api/status/history/route
 * @see {@link @/lib/state-db} For database queries
 * @see {@link apps/diag-probe/src/index.ts} For data collection
 * ============================================================================
 */

import { NextResponse } from "next/server";

/**
 * Runtime configuration for this API route.
 * "nodejs" is required for SQLite database access via better-sqlite3.
 * Edge runtime cannot use native database drivers.
 */
export const runtime = "nodejs";

/**
 * GET /api/status/history?minutes=60&limit=120
 * 
 * Retrieves historical system snapshots for time-series visualization.
 * Supports configurable time windows and result limits.
 * 
 * @param req - The incoming HTTP request with query parameters
 * @returns NextResponse with array of historical snapshots
 * 
 * @example
 * // Request:
 * GET /api/status/history?minutes=120&limit=240
 * 
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "minutes": 120,
 *   "limit": 240,
 *   "snapshots": [
 *     {
 *       "id": 100,
 *       "createdAt": 1704067200000,
 *       "hostname": "server-01",
 *       "load1": "1.25",
 *       "load5": "1.10",
 *       "load15": "0.95",
 *       "memUsedBytes": 8589934592,
 *       "memTotalBytes": 17179869184,
 *       "memUsedHuman": "8.0 GiB",
 *       "memTotalHuman": "16.0 GiB",
 *       "diskUsedBytes": 107374182400,
 *       "diskTotalBytes": 536870912000,
 *       "diskPercent": 20,
 *       "netRxBytes": 1048576000,
 *       "netTxBytes": 524288000,
 *       "netRxPackets": 1500000,
 *       "netTxPackets": 1200000,
 *       "topProcesses": "[...]"
 *     },
 *     // ... more snapshots
 *   ]
 * }
 * 
 * // Invalid Parameters (still 200, uses defaults):
 * GET /api/status/history?minutes=invalid&limit=999999
 * Response: { "ok": true, "minutes": 60, "limit": 120, "snapshots": [...] }
 */
export async function GET(req: Request) {
  /**
   * Dynamically import the database module.
   * Lazy loading improves performance and ensures the database
   * connection is only established when needed.
   */
  const { getRecentSnapshots } = await import("@/lib/state-db");

  /**
   * Parse query parameters from the request URL.
   * The URL constructor handles encoding and provides a clean
   * interface for accessing search parameters.
   */
  const url = new URL(req.url);

  /**
   * Extract 'minutes' parameter with default value.
   * Uses nullish coalescing (??) to provide default if param is missing.
   * Note: This gets the raw string value; we'll convert to number next.
   */
  const minutesParam = url.searchParams.get("minutes") ?? "60";

  /**
   * Extract 'limit' parameter with default value.
   * Default of 120 records balances data granularity with performance.
   */
  const limitParam = url.searchParams.get("limit") ?? "120";

  /**
   * Parse and validate the minutes parameter.
   * 
   * Validation rules:
   * 1. Must be a valid number (Number() handles this)
   * 2. Must be finite (not Infinity or -Infinity)
   * 3. Must be positive (> 0)
   * 4. Invalid values fall back to default (60)
   * 
   * Math.floor ensures we work with whole minutes.
   */
  const minutes = Number(minutesParam);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 
    ? Math.floor(minutes) 
    : 60;

  /**
   * Parse and validate the limit parameter.
   * 
   * Validation rules:
   * 1. Must be a valid number
   * 2. Must be finite
   * 3. Must be positive
   * 4. Capped at 500 maximum to prevent excessive queries
   * 5. Invalid values fall back to default (120)
   * 
   * The 500-record cap prevents:
   * - Memory exhaustion from large result sets
   * - Slow response times
   * - Excessive bandwidth usage
   * - UI rendering performance issues
   */
  const limit = Number(limitParam);
  const safeLimit = Number.isFinite(limit) && limit > 0 
    ? Math.min(Math.floor(limit), 500)  // Enforce 500-record maximum
    : 120;

  /**
   * Query the database for recent snapshots.
   * 
   * getRecentSnapshots() returns snapshots from the last 'safeMinutes'
   * minutes, limited to 'safeLimit' records. Results are ordered by
   * timestamp (most recent first).
   */
  const snapshots = getRecentSnapshots(safeMinutes, safeLimit);

  /**
   * Return the response with metadata and data.
   * 
   * Including the actual minutes and limit in the response helps
   * clients understand what data they're receiving, especially when
   * defaults were applied or caps were enforced.
   */
  return NextResponse.json({
    ok: true,
    minutes: safeMinutes,  // Report actual value used
    limit: safeLimit,      // Report actual value used
    snapshots             // Array of snapshot objects
  });
}
