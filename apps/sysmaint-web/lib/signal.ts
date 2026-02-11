/**
 * ============================================================================
 * SIGNAL PROTOCOL CHAT MODULE (ALICE)
 * ============================================================================
 *
 * This module manages the Alice identity for chatting with the SysMaint agent.
 * It handles Signal Protocol encryption/decryption and WebSocket communication.
 *
 * RESPONSIBILITIES:
 *
 * 1. Identity Management:
 *    - Bootstrap Alice's Signal identity
 *    - Generate and upload prekeys
 *    - Maintain encrypted database
 *
 * 2. Session Management:
 *    - Establish Signal sessions with peers
 *    - Fetch prekey bundles from relay
 *
 * 3. Message Sending:
 *    - Encrypt chat prompts
 *    - Send via relay server
 *
 * 4. Reply Handling:
 *    - Wait for AI replies via WebSocket
 *    - Decrypt and return responses
 *    - Handle timeouts
 *
 * CONCURRENCY:
 *
 * Chat prompts are serialized using a queue to prevent race conditions
 * when multiple requests arrive simultaneously.
 *
 * ============================================================================
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { ProtocolAddress } from "@signalapp/libsignal-client";
import { WebSocket, type RawData } from "ws";
import {
  createRequestId,
  decodeSysmaintMessage,
  encodeSysmaintMessage,
  type SysmaintChatPrompt
} from "@mega/sysmaint-protocol";
import {
  decryptMessage,
  encryptMessage,
  exportBundle,
  generatePreKeys,
  initSession,
  initializeIdentity,
  loadEnvelope,
  openStore,
  type Bundle
} from "@mega/signal-core";
import { aliceId, relayUrl, signalDbPath, sysmaintId, waitTimeoutMs } from "./config";

/**
 * Signal state singleton.
 * 
 * Lazily initialized on first access.
 */
let signalState: ReturnType<typeof openStore> | null = null;

/**
 * Queue for serializing chat prompt operations.
 * 
 * Ensures prompts are processed one at a time to avoid
 * race conditions with session state.
 */
let chatPromptQueue: Promise<void> = Promise.resolve();

/**
 * Get passphrase from environment.
 *
 * @returns Passphrase string
 * @throws Error if not set
 */
function getPassphrase(): string {
  const value = process.env.MEGA_PASSPHRASE;
  if (!value) {
    throw new Error("MEGA_PASSPHRASE is required for sysmaint-web API.");
  }
  return value;
}

/**
 * Get or initialize Signal state.
 *
 * @returns SignalState instance
 */
function getSignalState() {
  if (signalState) return signalState;
  mkdirSync(path.dirname(signalDbPath), { recursive: true });
  signalState = openStore(signalDbPath, getPassphrase());
  return signalState;
}

/**
 * Exported accessor for Alice's Signal state.
 *
 * Used by other modules (e2ee-chat) that need access.
 *
 * @returns SignalState instance
 */
export function getAliceSignalState() {
  return getSignalState();
}

/**
 * Build WebSocket URL from HTTP URL.
 *
 * @param serverBase - Base HTTP URL
 * @param clientId - Client identity
 * @returns WebSocket URL
 */
function resolveWsUrl(serverBase: string, clientId: string): string {
  const base = new URL(serverBase);
  const protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL("/ws", `${protocol}//${base.host}`);
  wsUrl.searchParams.set("client_id", clientId);
  return wsUrl.toString();
}

/**
 * HTTP GET helper with JSON parsing.
 *
 * @param url - Target URL
 * @returns Promise resolving to JSON response
 * @throws Error on HTTP error
 */
async function httpGetJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

/**
 * HTTP POST helper with JSON body.
 *
 * @param url - Target URL
 * @param body - Request body
 * @returns Promise resolving to JSON response
 * @throws Error on HTTP error
 */
async function httpPostJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

/**
 * Validate prekey bundle payload.
 *
 * @param input - Unknown data to validate
 * @returns Validated Bundle
 * @throws Error if invalid
 */
function ensureBundle(input: unknown): Bundle {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid prekey bundle payload.");
  }
  const bundle = input as Bundle;
  if (!bundle.id) {
    throw new Error("Invalid prekey bundle payload.");
  }
  return bundle;
}

/**
 * Ensure Alice's Signal identity is bootstrapped.
 *
 * This function:
 * 1. Creates identity if not exists
 * 2. Generates fresh prekeys
 * 3. Registers with relay
 * 4. Uploads prekey bundle
 */
export async function ensureAliceBootstrapped(): Promise<void> {
  const state = getSignalState();
  if (!state.getLocalIdentity()) {
    await initializeIdentity(state, aliceId, 1);
  }

  await generatePreKeys(state, 1);
  await httpPostJson(`${relayUrl}/v1/register`, { id: aliceId });

  const bundle = await exportBundle(state);
  await httpPostJson(`${relayUrl}/v1/prekeys`, { id: aliceId, bundle });
}

/**
 * Ensure we have a Signal session with a peer.
 *
 * @param peerId - Peer identity name
 */
export async function ensureAliceSessionWith(peerId: string): Promise<void> {
  const state = getSignalState();
  const address = ProtocolAddress.new(peerId, 1);
  const existing = await state.sessionStore.getSession(address);
  if (existing) return;

  const payload = await httpGetJson<{ id: string; bundle: Bundle }>(`${relayUrl}/v1/prekeys/${peerId}`);
  await initSession(state, ensureBundle(payload.bundle));
}

/**
 * Wait for chat reply from SysMaint agent.
 *
 * Opens WebSocket connection and waits for reply matching requestId.
 * Implements timeout handling.
 *
 * @param requestId - Request ID to match
 * @param timeoutMs - Maximum wait time
 * @returns Promise resolving to reply text
 * @throws Error on timeout or connection error
 */
async function waitForChatReply(requestId: string, timeoutMs: number): Promise<string> {
  const state = getSignalState();

  return await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(resolveWsUrl(relayUrl, aliceId));
    let settled = false;

    /**
     * Mark operation as complete.
     */
    const done = (fn: (value: string | Error) => void, value: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      try {
        ws.close(1000, "done");
      } catch {
        // ignore close errors
      }
      fn(value);
    };

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      done((err) => reject(err), new Error(`Timed out waiting for SysMaint reply (requestId=${requestId}).`));
    }, timeoutMs);
    timeoutHandle.unref();

    // Handle incoming messages
    ws.on("message", (raw: RawData) => {
      void (async () => {
        try {
          const payload = JSON.parse(raw.toString()) as { envelope?: unknown };
          const envelope = loadEnvelope(payload.envelope ?? payload);
          const plaintext = await decryptMessage(state, envelope);
          const message = decodeSysmaintMessage(plaintext);

          // Only handle chat replies
          if (message.kind !== "chat.reply") return;
          
          // Only handle replies to our request
          if (message.requestId !== requestId) return;

          done((text) => resolve(String(text)), message.reply);
        } catch {
          // Ignore invalid/unrelated frames
        }
      })().catch((err) => {
        done((error) => reject(error), err as Error);
      });
    });

    ws.on("error", (err) => {
      done((error) => reject(error), err as Error);
    });

    ws.on("close", () => {
      if (!settled) {
        done((error) => reject(error), new Error("WebSocket closed before reply arrived."));
      }
    });
  });
}

/**
 * Run chat prompt task serially.
 *
 * Ensures only one chat operation runs at a time
 * to prevent race conditions.
 *
 * @param task - Async function to execute
 * @returns Promise resolving to task result
 */
function runChatPromptSerial<T>(task: () => Promise<T>): Promise<T> {
  const run = chatPromptQueue.then(task, task);
  chatPromptQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Send chat prompt to SysMaint agent and wait for reply.
 *
 * This is the main API for AI chat. It:
 * 1. Ensures identity and session
 * 2. Encrypts the prompt
 * 3. Sends via relay
 * 4. Waits for encrypted reply
 * 5. Returns decrypted response
 *
 * @param prompt - User's prompt text
 * @returns Object with requestId and reply text
 */
export async function sendPromptToSysmaint(prompt: string): Promise<{ requestId: string; reply: string }> {
  return await runChatPromptSerial(async () => {
    const state = getSignalState();

    // Ensure we're ready to communicate
    await ensureAliceBootstrapped();
    await ensureAliceSessionWith(sysmaintId);

    // Create prompt message
    const requestId = createRequestId();
    const message: SysmaintChatPrompt = {
      version: 1,
      kind: "chat.prompt",
      requestId,
      prompt,
      from: aliceId,
      createdAt: Date.now()
    };

    // Encrypt and send
    const envelope = await encryptMessage(state, sysmaintId, encodeSysmaintMessage(message));
    await httpPostJson(`${relayUrl}/v1/messages`, {
      from: aliceId,
      to: sysmaintId,
      envelope
    });

    // Wait for reply
    const reply = await waitForChatReply(requestId, waitTimeoutMs);
    return { requestId, reply };
  });
}
