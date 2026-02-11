/**
 * ============================================================================
 * DENO TEST OVERVIEW SERVICE
 * ============================================================================
 *
 * HTTP service for generating AI-powered test analysis reports.
 * Uses native Deno APIs and fetch (zero dependencies).
 *
 * Endpoints:
 * - POST /analyze - Generate report from test data
 * - GET /health - Health check
 *
 * @module infra/deno/test-overview/main
 * ============================================================================
 */

// Deno 2.x compatible serve (using native Deno.serve)
const PORT = parseInt(Deno.env.get("PORT") || "8000");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  Deno.exit(1);
}

/**
 * Generate formal technical report using OpenAI
 */
async function generateReport(testData: any): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are a technical test analyst generating formal reports for system test suites.

REPORT FORMAT:
═══════════════════════════════════════════════════════════════
TEST SUITE ANALYSIS REPORT
Generated: ${new Date().toISOString()}
═══════════════════════════════════════════════════════════════

EXECUTIVE SUMMARY
─────────────────
• Key pass rate metric
• Total cost summary
• Notable trends (2-3 bullets max)

DETAILED STATISTICS
───────────────────
Overall Performance:
  • Pass rate: X% (X/Y tests)
  • Total runs analyzed: N
  • Average execution time: X seconds

Category Breakdown:
  [Category Name]: X/X passed (X%)
  
Cost Analysis:
  • Total AI API costs: $X.XXXX
  • Average cost per run: $X.XXXX

NOTABLE ISSUES
─────────────────
[List any failing tests or patterns]

RECOMMENDATIONS
─────────────────
• [Actionable recommendation 1]
• [Actionable recommendation 2]

═══════════════════════════════════════════════════════════════
Reply with: "Run tests" to execute test suite
═══════════════════════════════════════════════════════════════

Tone: Professional, technical, data-driven. Include specific numbers and percentages.`,
        },
        {
          role: "user",
          content: `Generate a formal test analysis report from this data:\n\n${JSON.stringify(testData, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

/**
 * HTTP request handler
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Health check
  if (url.pathname === "/health" && req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  // Generate report
  if (url.pathname === "/analyze" && req.method === "POST") {
    try {
      const testData = await req.json();
      console.log(`[${new Date().toISOString()}] Generating report for ${testData.totalRuns} runs`);
      
      const report = await generateReport(testData);
      
      console.log(`[${new Date().toISOString()}] Report generated successfully`);
      
      return new Response(JSON.stringify({ report }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Error:`, error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: { ...headers, "Content-Type": "application/json" } 
        }
      );
    }
  }

  // Not found
  return new Response("Not Found", { status: 404, headers });
}

// Start server
console.log(`[${new Date().toISOString()}] Deno Test Overview Service starting...`);
console.log(`[${new Date().toISOString()}] Listening on port ${PORT}`);

Deno.serve({ port: PORT }, handler);
