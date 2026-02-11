/**
 * ============================================================================
 * Next.js API Route Handler: /api/chat
 * ============================================================================
 * 
 * PURPOSE:
 * Chat API endpoint for interacting with the SysMaint AI agent through the
 * Signal Protocol. This route receives user prompts, encrypts them using
 * end-to-end encryption, transmits them to the SysMaint agent via the Signal
 * Protocol relay server, receives encrypted responses, decrypts them, and
 * returns the plaintext reply to the web UI.
 * 
 * ARCHITECTURE:
 * - HTTP POST endpoint (Next.js App Router Route Handler)
 * - Runtime: Node.js (required for native Signal Protocol bindings)
 * - Stateless request-response model
 * - Leverages the Signal Protocol for E2EE communication with the AI agent
 * 
 * SECURITY MODEL:
 * - User prompt encrypted before leaving the server (E2EE to SysMaint agent)
 * - No plaintext messages transmitted over the network
 * - Reply decrypted server-side for display in the web UI
 * - Note: This is a demo setup where the web server has access to decrypted
 *   messages; in production, client-side encryption would be preferred
 * 
 * REQUEST FLOW:
 * 1. Client sends JSON with user prompt
 * 2. Input validated using Zod schema
 * 3. sendPromptToSysmaint() called (from @/lib/signal)
 *    - Establishes Signal session if needed
 *    - Encrypts message
 *    - Sends via relay server
 *    - Waits for encrypted response
 *    - Decrypts response
 * 4. Returns JSON with requestId, reply, and timestamp
 * 
 * ERROR HANDLING:
 * - Zod validation errors return 500 with error message
 * - Signal Protocol errors (network, crypto, etc.) caught and returned as JSON
 * - All errors logged for debugging
 * 
 * DEPENDENCIES:
 * - Zod: Runtime type validation
 * - NextResponse: Next.js server response helper
 * - @/lib/signal: Alice's Signal Protocol operations for SysMaint communication
 * 
 * @module apps/sysmaint-web/app/api/chat/route
 * @see {@link @/lib/signal} For Signal Protocol implementation details
 * @see {@link @signalapp/libsignal-client} Official Signal Protocol library
 * ============================================================================
 */

import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Runtime configuration for this API route.
 * "nodejs" is required because the Signal Protocol library uses native
 * Node.js bindings for cryptographic operations. Edge runtime is not
 * compatible with the libsignal-client native module.
 */
export const runtime = "nodejs";

/**
 * Zod schema for validating the request body.
 * Ensures the prompt is a non-empty string.
 * This validation prevents malformed requests and provides type safety
 * through Zod's inferred TypeScript types.
 */
const BodySchema = z.object({
  /**
   * The user's prompt/question to send to the SysMaint AI agent.
   * Must be a non-empty string (min: 1 character).
   */
  prompt: z.string().min(1)
});

/**
 * POST /api/chat
 * 
 * Handles incoming chat requests from the web UI, encrypts them using the
 * Signal Protocol, sends them to the SysMaint agent, and returns the
 * decrypted response.
 * 
 * @param req - The incoming HTTP request object
 * @returns NextResponse with JSON containing the AI agent's reply
 * 
 * @example
 * // Request:
 * POST /api/chat
 * Content-Type: application/json
 * 
 * {
 *   "prompt": "What is the CPU usage?"
 * }
 * 
 * // Success Response (200):
 * {
 *   "ok": true,
 *   "requestId": "uuid-string",
 *   "reply": "Current CPU usage is 45%...",
 *   "respondedAt": 1704067200000
 * }
 * 
 * // Error Response (500):
 * {
 *   "ok": false,
 *   "error": "Failed to establish Signal session"
 * }
 */
export async function POST(req: Request) {
  try {
    // Parse and validate the request body using Zod schema
    // This ensures 'prompt' exists and is a non-empty string
    const body = BodySchema.parse(await req.json());

    /**
     * Dynamically import the Signal library.
     * Dynamic import is used here to avoid loading the heavy Signal
     * Protocol library at build time, improving startup performance.
     * The libsignal-client module has native dependencies that should
     * only be loaded when needed.
     */
    const { sendPromptToSysmaint } = await import("@/lib/signal");

    /**
     * Send the prompt through the Signal Protocol.
     * This function handles the full E2EE lifecycle:
     * 1. Load Alice's identity and session state
     * 2. Encrypt the message using Signal Protocol
     * 3. Send encrypted envelope to relay server
     * 4. Poll for response from SysMaint agent
     * 5. Decrypt the response
     * 6. Return plaintext reply
     * 
     * The result contains the decrypted reply and metadata.
     */
    const result = await sendPromptToSysmaint(body.prompt);

    /**
     * Return success response with:
     * - ok: true to indicate success
     * - requestId: Unique identifier for this conversation turn
     * - reply: The decrypted response from the AI agent
     * - respondedAt: Server timestamp when response was received
     */
    return NextResponse.json({
      ok: true,
      requestId: result.requestId,
      reply: result.reply,
      respondedAt: Date.now()
    });
  } catch (err) {
    /**
     * Error handling:
     * Catches any errors from validation, Signal Protocol operations,
     * or network failures. Converts error to string for JSON serialization.
     * Returns 500 status code to indicate server-side error.
     */
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
