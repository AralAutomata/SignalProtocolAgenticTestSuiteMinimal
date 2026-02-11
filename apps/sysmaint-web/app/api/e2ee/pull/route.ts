/**
 * ============================================================================
 * Next.js API Route Handler: /api/e2ee/pull
 * ============================================================================
 * 
 * PURPOSE:
 * End-to-end encrypted message retrieval endpoint for the Alice ↔ Bob demo.
 * This route allows a demo user to pull their encrypted messages from the
 * relay server and decrypt them locally. It's part of the educational E2EE
 * demonstration showing how secure message retrieval works in practice.
 * 
 * ARCHITECTURE:
 * - HTTP GET endpoint for retrieving encrypted messages
 * - Runtime: Node.js (required for Signal Protocol native bindings)
 * - Dynamic rendering (stateful cryptographic operations)
 * - Query parameter validation via Zod schemas
 * - Integrates with @/lib/e2ee-chat for Signal Protocol decryption
 * 
 * DEMO CONTEXT:
 * This endpoint completes the E2EE demo by allowing users to:
 * 1. Poll for new encrypted messages on the relay server
 * 2. Receive encrypted message envelopes
 * 3. Decrypt messages locally using their private keys
 * 4. Display plaintext in the UI
 * 
 * The demo illustrates:
 * - Asynchronous message retrieval (store-and-forward)
 * - Client-side decryption (E2EE principle)
 * - Session management across multiple messages
 * - Forward secrecy (each message uses unique key)
 * 
 * MESSAGE RETRIEVAL FLOW:
 * 1. Client sends GET with user identity as query parameter
 * 2. Route validates the user parameter using Zod
 * 3. pullDirectMessages() performs the following:
 *    a. Query relay server for messages addressed to user
 *    b. For each encrypted message:
 *       - Load user's identity and session keys
 *       - Decrypt using Double Ratchet algorithm
 *       - Verify message integrity
 *       - Delete from relay server (optional)
 *    c. Return array of decrypted plaintext messages
 * 4. Route returns JSON with user identity and messages
 * 
 * SECURITY MODEL:
 * - Messages remain encrypted during transmission from relay
 * - Decryption happens server-side in this demo (for simplicity)
 * - In production: decryption would happen client-side
 * - Each message decrypted with unique ratchet key
 * - Deleted from relay after retrieval (default behavior)
 * - Message integrity verified via authentication tags
 * 
 * QUERY PARAMETERS:
 * - user (required): Identity of the user pulling messages
 *   - Must be "alice" or "bob"
 *   - Passed as URL query parameter: ?user=alice
 * 
 * VALIDATION:
 * - User must be a valid demo user ("alice" or "bob")
 * - Type safety enforced via Zod + TypeScript
 * - Missing or invalid user returns error
 * 
 * ERROR HANDLING:
 * - Zod validation errors: Return 500 with error details
 * - Signal Protocol errors: Return 500 with error message
 * - Network failures (relay unavailable): Return 500
 * - Decryption failures: Individual message errors handled internally
 * 
 * USE CASES:
 * - Receiving encrypted messages in demo chat
 * - Polling for new messages (real-time chat simulation)
 * - Educational demonstration of E2EE message retrieval
 * - Testing Signal Protocol decryption
 * 
 * PERFORMANCE:
 * - Network latency depends on relay server response time
 * - Decryption overhead: ~5-10ms per message
 * - Batch processing: All messages decrypted in parallel
 * - Suitable for polling every 2-5 seconds in demo
 * 
 * DEPENDENCIES:
 * - Zod: Runtime type validation
 * - @/lib/e2ee-chat: Signal Protocol implementation for demo
 * - NextResponse: Next.js response helper
 * - URL API: Native Node.js for query parsing
 * 
 * @module apps/sysmaint-web/app/api/e2ee/pull/route
 * @see {@link @/lib/e2ee-chat} For E2EE implementation details
 * @see {@link /api/e2ee/send} For sending messages endpoint
 * @see {@link @signalapp/libsignal-client} Official Signal Protocol library
 * ============================================================================
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { DemoUserSchema, pullDirectMessages } from "@/lib/e2ee-chat";

/**
 * Runtime configuration for this API route.
 * "nodejs" is required because the Signal Protocol library uses native
 * Node.js bindings for cryptographic operations.
 */
export const runtime = "nodejs";

/**
 * Dynamic rendering configuration.
 * Forces dynamic execution since this endpoint performs stateful
 * cryptographic operations that depend on current relay server state.
 */
export const dynamic = "force-dynamic";

/**
 * Zod schema for validating the query parameters.
 * 
 * Fields:
 * - user: Identity of the user pulling messages ("alice" or "bob")
 * 
 * DemoUserSchema provides validation for alice/bob enum values,
 * ensuring only valid demo users can retrieve messages.
 */
const QuerySchema = z.object({
  /**
   * The demo user identity.
   * Must be either "alice" or "bob".
   * This determines which user's messages to retrieve and decrypt.
   */
  user: DemoUserSchema
});

/**
 * GET /api/e2ee/pull?user=alice
 * 
 * Retrieves and decrypts end-to-end encrypted messages for a demo user.
 * Messages are pulled from the relay server and decrypted using the
 * Signal Protocol.
 * 
 * @param req - The incoming HTTP request with user query parameter
 * @returns NextResponse with array of decrypted messages
 * 
 * @example
 * // Request:
 * GET /api/e2ee/pull?user=bob
 * 
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "user": "bob",
 *   "messages": [
 *     {
 *       "id": "msg-uuid-123",
 *       "from": "alice",
 *       "to": "bob",
 *       "text": "Hello Bob! This is encrypted.",
 *       "timestamp": 1704067200000,
 *       "decryptedAt": 1704067201000
 *     },
 *     {
 *       "id": "msg-uuid-124",
 *       "from": "alice",
 *       "to": "bob",
 *       "text": "How are you?",
 *       "timestamp": 1704067260000,
 *       "decryptedAt": 1704067261000
 *     }
 *   ]
 * }
 * 
 * // No Messages Response (200):
 * {
 *   "ok": true,
 *   "user": "bob",
 *   "messages": []
 * }
 * 
 * // Error Response (500):
 * {
 *   "ok": false,
 *   "error": "Invalid user: must be 'alice' or 'bob'"
 * }
 */
export async function GET(req: Request) {
  try {
    /**
     * Parse the request URL to extract query parameters.
     * The URL constructor provides a convenient interface for
     * accessing search parameters from the request URL.
     */
    const url = new URL(req.url);

    /**
     * Extract and validate the user parameter.
     * 
     * The user parameter identifies which demo user's messages to
     * retrieve. It must be either "alice" or "bob".
     * 
     * QuerySchema.parse() validates:
     * - User parameter exists
     * - Value is "alice" or "bob"
     * - Returns typed object for type safety
     */
    const parsed = QuerySchema.parse({
      user: url.searchParams.get("user")
    });

    /**
     * Retrieve and decrypt messages for the specified user.
     * 
     * pullDirectMessages() performs the complete retrieval flow:
     * 1. Query relay server for messages addressed to parsed.user
     * 2. For each encrypted message envelope:
     *    a. Load recipient's identity and session keys
     *    b. Decrypt ciphertext using Double Ratchet algorithm
     *    c. Verify message integrity and authenticity
     *    d. Parse plaintext content
     *    e. Delete message from relay server (if configured)
     * 3. Return array of decrypted message objects
     * 
     * If no messages are available, returns empty array.
     */
    const messages = await pullDirectMessages(parsed.user);

    /**
     * Return success response with decrypted messages.
     * 
     * The response includes:
     * - ok: true to indicate success
     * - user: The identity of the user who retrieved messages
     * - messages: Array of decrypted message objects
     * 
     * Each message object contains:
     * - id: Unique message identifier
     * - from: Sender identity
     * - to: Recipient identity (should match user param)
     * - text: Decrypted plaintext content
     * - timestamp: Original send time
     * - decryptedAt: Time when decryption occurred
     */
    return NextResponse.json({
      ok: true,
      user: parsed.user,
      messages
    });
  } catch (err) {
    /**
     * Error handling for validation or Signal Protocol failures.
     * 
     * Common error scenarios:
     * - Zod validation error (invalid or missing user parameter)
     * - Signal Protocol error (decryption failure, session error)
     * - Network error (relay server unavailable)
     * - Key management error (keys not found or corrupted)
     */
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
