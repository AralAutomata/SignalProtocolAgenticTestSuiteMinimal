/**
 * ============================================================================
 * WEB API TESTS
 * ============================================================================
 *
 * Tests 14-15: Web API and database operation tests
 * Tests database queries and API endpoint functionality
 *
 * Tests:
 * 14. Database Query Operations
 * 15. Chat API End-to-End
 *
 * @module apps/sysmaint-web/lib/test-suite/web-api
 * ============================================================================
 */

import type { TestDefinition } from "../../types/test";
import { getLatestSnapshot, getRecentSnapshots } from "../state-db";

export const webTests: TestDefinition[] = [
  // Test 14: Database Query Operations
  {
    id: "web-database",
    name: "Database Query Operations",
    category: "web",
    description: "Test state database query functions",
    estimatedDuration: 100,
    fn: async (context) => {
      context.log("Testing getLatestSnapshot()");
      const snapshot = getLatestSnapshot();

      if (!snapshot) {
        context.log("No snapshot available - this is OK if system just started");
        return { hasSnapshot: false };
      }

      context.log(
        `Latest snapshot - CPU: ${snapshot.cpuPct}%, Memory: ${snapshot.memPct}%`
      );

      if (snapshot.cpuPct < 0 || snapshot.cpuPct > 100) {
        throw new Error(`Invalid CPU percentage: ${snapshot.cpuPct}`);
      }

      if (snapshot.memPct < 0 || snapshot.memPct > 100) {
        throw new Error(`Invalid memory percentage: ${snapshot.memPct}`);
      }

      context.log("Testing getRecentSnapshots(60)");
      const history = getRecentSnapshots(60);
      context.log(`Retrieved ${history.length} snapshots from last hour`);

      if (!Array.isArray(history)) {
        throw new Error("getRecentSnapshots did not return an array");
      }

      context.log("✅ Database operations working correctly");
      return {
        hasSnapshot: true,
        cpuPct: snapshot.cpuPct,
        memPct: snapshot.memPct,
        historyCount: history.length,
      };
    },
  },

  // Test 15: Chat API Flow
  {
    id: "web-chat-api",
    name: "Chat API End-to-End",
    category: "web",
    description: "Test chat API endpoint with test prompt",
    estimatedDuration: 500,
    fn: async (context) => {
      const testPrompt = "Test ping from automated test suite";
      context.log(`Sending test prompt: "${testPrompt}"`);

      // Determine base URL - use localhost for testing
      const baseUrl = "http://localhost:3000";
      const apiUrl = `${baseUrl}/api/chat`;
      context.log(`API URL: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: testPrompt }),
        });

        context.log(`Response status: ${response.status}`);

        const data = await response.json();
        context.log(`Response data: ${JSON.stringify(data)}`);

        // We accept both success and graceful failures
        // Success: has reply field
        // Graceful failure: has error field
        if (!data.reply && !data.error) {
          throw new Error("Response missing both 'reply' and 'error' fields");
        }

        if (data.reply) {
          context.log(
            `✅ Chat API returned reply: ${data.reply.substring(0, 100)}...`
          );
        } else {
          context.log(
            `⚠️ Chat API returned error (may be expected): ${data.error}`
          );
        }

        return {
          statusCode: response.status,
          hasReply: !!data.reply,
          hasError: !!data.error,
          replyPreview: data.reply ? data.reply.substring(0, 100) : null,
        };
      } catch (error: any) {
        // If fetch fails (server not running), that's a legitimate test failure
        context.log(`Fetch error: ${error.message}`);
        throw new Error(`Chat API request failed: ${error.message}`);
      }
    },
  },
];
