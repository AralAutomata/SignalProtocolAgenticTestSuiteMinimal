/**
 * ============================================================================
 * ENVELOPE SCHEMA MODULE
 * ============================================================================
 * 
 * This module defines the Envelope schema and types for Signal Protocol
 * message transport. The envelope is the container format for encrypted
 * messages sent through the relay server.
 * 
 * PURPOSE:
 * The envelope wraps encrypted Signal Protocol messages with metadata needed
 * for routing and delivery. It contains NO plaintext message content - only
 * encrypted payload and routing information.
 * 
 * ENVELOPE STRUCTURE:
 * 
 * An envelope contains:
 * - Routing info: senderId, recipientId (who it's from/to)
 * - Session info: sessionId (identifies the conversation)
 * - Message type: type (PreKey or Whisper message)
 * - Encrypted payload: body (base64-encoded ciphertext)
 * - Timestamp: timestamp (for ordering and deduplication)
 * 
 * SECURITY CONSIDERATIONS:
 * 
 * - The envelope is NOT encrypted itself - only the body is encrypted
 * - The relay can see sender, recipient, and message type
 * - The relay CANNOT see the message content (it's in the encrypted body)
 * - Metadata analysis is possible (who talks to whom, when, message sizes)
 * 
 * For strong metadata privacy, additional measures like padding,
 * traffic shaping, or mix networks would be needed.
 * 
 * ============================================================================
 */

// Zod is a TypeScript-first schema validation library with static type inference
// It provides runtime validation that matches TypeScript's static types
import { z } from "zod";

/**
 * EnvelopeSchema - Zod schema defining the envelope structure.
 * 
 * This schema validates that envelope objects have the correct structure
 * and data types before they're processed. Using Zod provides:
 * 
 * 1. RUNTIME VALIDATION: Catch malformed data at runtime
 * 2. TYPE SAFETY: Inferred TypeScript types match the schema
 * 3. ERROR MESSAGES: Detailed error information on validation failures
 * 4. COMPOSABILITY: Schemas can be combined and reused
 * 
 * FIELD EXPLANATIONS:
 * 
 * version: Protocol version for future compatibility
 *   - Type: positive integer
 *   - Purpose: Allows protocol evolution while maintaining backward compatibility
 *   - Current value: 1
 * 
 * senderId: Signal identity of the sender
 *   - Type: non-empty string
 *   - Example: "alice", "sysmaint"
 *   - Used by relay for delivery and by recipient for decryption
 * 
 * recipientId: Signal identity of the recipient
 *   - Type: non-empty string
 *   - Example: "bob", "sysmaint"
 *   - Used by relay to route the message
 * 
 * sessionId: Conversation session identifier
 *   - Type: non-empty string
 *   - Format: "senderId::recipientId" (e.g., "alice::bob")
 *   - Used to identify which Signal session this message belongs to
 * 
 * type: Signal message type
 *   - Type: non-negative integer
 *   - Values: 2 = PreKey message (initial), 1 = Whisper message (subsequent)
 *   - Indicates which decryption routine to use
 * 
 * body: Encrypted message payload
 *   - Type: non-empty string (base64-encoded)
 *   - This is the AES-encrypted ciphertext from Signal protocol
 *   - Contains the actual message content + authentication tag
 * 
 * timestamp: Message creation time
 *   - Type: positive integer (milliseconds since Unix epoch)
 *   - Used for message ordering and deduplication
 *   - Also included in Signal's authenticated data (prevents replay attacks)
 */
export const EnvelopeSchema = z.object({
  // Protocol version - positive integer
  // Must be > 0, must be an integer
  version: z.number().int().positive(),
  
  // Sender's Signal identity - non-empty string
  // Examples: "alice", "sysmaint", "diagprobe"
  senderId: z.string().min(1),
  
  // Recipient's Signal identity - non-empty string
  // Examples: "bob", "sysmaint"
  recipientId: z.string().min(1),
  
  // Session identifier - non-empty string
  // Format: "senderId::recipientId"
  // Example: "alice::sysmaint"
  sessionId: z.string().min(1),
  
  // Message type - non-negative integer
  // 2 = CiphertextMessageType.PreKey (initial message)
  // 1 = CiphertextMessageType.Whisper (subsequent messages)
  type: z.number().int().nonnegative(),
  
  // Encrypted payload - base64-encoded string, non-empty
  // This is the Signal protocol ciphertext
  body: z.string().min(1),
  
  // Timestamp - positive integer (milliseconds since epoch)
  // Date.now() in JavaScript returns this format
  timestamp: z.number().int().positive()
});

/**
 * Envelope type - TypeScript type inferred from Zod schema.
 * 
 * This type is automatically generated from the EnvelopeSchema above.
 * It ensures TypeScript knows the exact structure of valid envelopes.
 * 
 * TypeScript will enforce that any Envelope-typed variable has all
 * required fields with correct types.
 * 
 * Example usage:
 * ```typescript
 * const envelope: Envelope = {
 *   version: 1,
 *   senderId: "alice",
 *   recipientId: "bob",
 *   sessionId: "alice::bob",
 *   type: 1,
 *   body: "base64-encoded-ciphertext...",
 *   timestamp: 1704067200000
 * };
 * ```
 */
export type Envelope = z.infer<typeof EnvelopeSchema>;

/**
 * Parse and validate an envelope from unknown input.
 * 
 * This function takes any unknown value and validates it against the
 * EnvelopeSchema. If validation passes, it returns the value as a typed
 * Envelope object. If validation fails, it throws a ZodError with details.
 * 
 * USE CASES:
 * - Validating incoming WebSocket messages
 * - Validating HTTP request bodies
 * - Type-safe parsing of JSON data
 * 
 * ERROR HANDLING:
 * 
 * If validation fails, Zod throws a ZodError containing:
 * - issues: Array of specific validation failures
 * - format(): Human-readable error messages
 * - flatten(): Simplified error structure
 * 
 * Example error:
 * ```
 * ZodError: [
 *   {
 *     "code": "too_small",
 *     "minimum": 1,
 *     "type": "string",
 *     "inclusive": true,
 *     "message": "String must contain at least 1 character(s)",
 *     "path": ["senderId"]
 *   }
 * ]
 * ```
 * 
 * EXAMPLE USAGE:
 * ```typescript
 * try {
 *   const envelope = parseEnvelope(jsonData);
 *   // envelope is now typed as Envelope
 *   console.log(envelope.senderId);  // TypeScript knows this is string
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     console.error("Invalid envelope:", error.errors);
 *   }
 * }
 * ```
 * 
 * @param input - Unknown data to validate (e.g., parsed JSON)
 * @returns Validated Envelope object
 * @throws ZodError if validation fails
 */
export function parseEnvelope(input: unknown): Envelope {
  // EnvelopeSchema.parse() validates the input
  // If valid, returns the data with proper typing
  // If invalid, throws ZodError with detailed error information
  return EnvelopeSchema.parse(input);
}

/**
 * ============================================================================
 * WHY ZOD FOR SCHEMA VALIDATION?
 * ============================================================================
 * 
 * 1. TYPE SAFETY: Zod schemas produce TypeScript types automatically.
 *    The Envelope type is inferred from EnvelopeSchema - they can't diverge.
 * 
 * 2. RUNTIME VALIDATION: TypeScript types are erased at runtime.
 *    Zod provides actual runtime checking of data.
 * 
 * 3. DECLARATIVE: Schemas are easy to read and maintain.
 *    The validation rules are clear from the schema definition.
 * 
 * 4. COMPOSABLE: Schemas can be combined, extended, and reused.
 *    We could create PartialEnvelopeSchema, EnvelopeArraySchema, etc.
 * 
 * 5. ERROR MESSAGES: Zod provides detailed, helpful error messages
 *    that make debugging easier.
 * 
 * ALTERNATIVES CONSIDERED:
 * 
 * - io-ts: Similar to Zod, more functional programming style
 * - class-validator: Decorator-based, requires classes
 * - Joi: Popular but no TypeScript integration
 * - Yup: Similar to Zod, slightly different API
 * 
 * Zod was chosen for its excellent TypeScript integration and clean API.
 * 
 * ============================================================================
 */
