/**
 * ============================================================================
 * Next.js API Route Handler: /api/status/usage/reset
 * ============================================================================
 * 
 * PURPOSE:
 * Administrative endpoint to reset cumulative usage statistics counters.
 * This allows operators to clear the running totals for network I/O metrics
 * and start fresh accumulation. Useful for:
 * - Beginning a new monitoring period
 * - Resetting after system changes
 * - Clearing test data
 * - Starting monthly/quarterly reporting periods
 * 
 * ARCHITECTURE:
 * - HTTP POST endpoint (state-changing operation)
 * - Runtime: Node.js (required for SQLite database access)
 * - Dynamic export: Forces dynamic rendering (no caching)
 * - Simple administrative action with no request body required
 * 
 * SECURITY WARNING:
 * ⚠️  This endpoint has NO AUTHENTICATION in the current implementation!
 * In a production environment, this endpoint MUST be protected by:
 * - API key authentication
 * - Session-based authentication (cookies/JWT)
 * - Role-based access control (admin only)
 * - Rate limiting to prevent abuse
 * 
 * Without protection, anyone can reset your usage statistics,
 * potentially disrupting monitoring and reporting.
 * 
 * DATA IMPACT:
 * This operation:
 * ✓ Resets cumulative counters (totalRx, totalTx, totalRxPackets, totalTxPackets)
 * ✓ Updates the 'firstAt' timestamp to current time
 * ✓ Preserves historical snapshot data (individual records)
 * ✗ Cannot be undone (data loss for cumulative stats)
 * 
 * The individual snapshot records in the snapshots table are NOT deleted.
 * Only the usage_totals table is reset. This means:
 * - Historical charts still work
 * - Individual data points remain
 * - Only the running totals are cleared
 * 
 * USE CASES:
 * - Monthly billing period reset
 * - Post-maintenance reset
 * - Testing and development
 * - Data retention policy compliance
 * 
 * PERFORMANCE:
 * - Single UPDATE query on usage_totals table
 * - Very fast execution (< 1ms typically)
 * - No table locks on snapshots table
 * - Minimal database impact
 * 
 * ERROR HANDLING:
 * - Database errors return 500 with error message
 * - Success returns 200 with reset timestamp
 * - No partial failure state (atomic operation)
 * 
 * RESPONSE FORMAT:
 * {
 *   ok: true,              // Success indicator
 *   resetAt: number        // Unix timestamp when reset occurred
 * }
 * 
 * DEPENDENCIES:
 * - @/lib/state-db: Database access layer
 * - NextResponse: Next.js response helper
 * 
 * @module apps/sysmaint-web/app/api/status/usage/reset/route
 * @see {@link @/lib/state-db} For database operations
 * @see {@link /api/status/current} For viewing current usage totals
 * ============================================================================
 */

import { NextResponse } from "next/server";

/**
 * Runtime configuration for this API route.
 * "nodejs" is required for SQLite database operations via better-sqlite3.
 */
export const runtime = "nodejs";

/**
 * Dynamic rendering configuration.
 * Forces Next.js to treat this route as dynamic, preventing static
 * generation at build time. This is appropriate for state-changing
 * endpoints that should never be cached.
 */
export const dynamic = "force-dynamic";

/**
 * POST /api/status/usage/reset
 * 
 * Resets the cumulative usage statistics counters to zero.
 * This is a destructive operation that cannot be undone.
 * 
 * @returns NextResponse with confirmation and timestamp
 * 
 * @example
 * // Request:
 * POST /api/status/usage/reset
 * Content-Type: application/json
 * 
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "resetAt": 1704067200000
 * }
 * 
 * // Error Response (500):
 * {
 *   "ok": false,
 *   "error": "Database connection failed"
 * }
 */
export async function POST() {
  try {
    /**
     * Dynamically import the database module.
     * Ensures the database connection is only established when
     * this administrative endpoint is actually invoked.
     */
    const { resetUsageTotals } = await import("@/lib/state-db");

    /**
     * Execute the reset operation.
     * 
     * resetUsageTotals() performs the following SQL operations:
     * 1. DELETE FROM usage_totals (clears existing row)
     * 2. INSERT INTO usage_totals (creates new row with zeros)
     * 
     * This atomic operation:
     * - Resets totalRx, totalTx to 0
     * - Resets totalRxPackets, totalTxPackets to 0
     * - Sets firstAt and lastAt to current timestamp
     * - Returns the timestamp when reset occurred
     */
    const resetAt = resetUsageTotals();

    /**
     * Return success confirmation with timestamp.
     * The resetAt timestamp allows clients to track when the
     * reset occurred for audit and display purposes.
     */
    return NextResponse.json({
      ok: true,
      resetAt  // Unix timestamp (milliseconds) of reset operation
    });
  } catch (err) {
    /**
     * Error handling for database or system failures.
     * Converts any error to a string message suitable for JSON
     * serialization and returns a 500 status code to indicate
     * a server-side error.
     */
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
