/**
 * ============================================================================
 * API ROUTE: GET /api/test/history
 * ============================================================================
 *
 * Get test run history
 *
 * @module apps/sysmaint-web/app/api/test/history/route
 * ============================================================================
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";

/**
 * GET handler - Return test run history
 */
export async function GET(request: NextRequest) {
  try {
    // Dynamic import server-side only module
    const { getTestHistory } = await import("../../../../lib/test-suite/database");
    
    // Parse limit parameter
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "10", 10),
      100
    );

    // Get history from database
    const history = getTestHistory(limit);

    // Return JSON response
    return Response.json({ runs: history });
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: "Failed to fetch test history",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
