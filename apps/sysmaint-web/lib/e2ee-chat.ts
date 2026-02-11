/**
 * ============================================================================
 * END-TO-END ENCRYPTED CHAT MODULE (DEMO)
 * ============================================================================
 *
 * This module implements direct E2EE chat between Alice and Bob for the
 * 3-panel demo page. It supports both identities within the same web app.
 *
 * PURPOSE:
 *
 * The demo page shows three panels:
 * - Alice's chat view
 * - Bob's chat view
 * - Alice <-> SysMaint chat
 *
 * This module handles the Alice <-> Bob direct communication.
 *
 * FEATURES:
 *
 * 1. Dual Identity Support:
 *    - Manages cryptographic state for both Alice and Bob
 *    - Separate Signal databases for each identity
 *
 * 2. Message Sending:
 *    - Encrypt messages from sender to recipient
 *    - Send via relay server
 *
 * 3. Message Receiving:
 *    - Short-polling via WebSocket
 *    - Decrypt and return messages
 *
 * USAGE:
 *
 * ```typescript
 * // Send message from Alice to Bob
 * const message = await sendDirectMessage("alice", "bob", "Hello!");
 *
 * // Pull messages for Bob (waits up to 900ms)
 * const messages = await pullDirectMessages("bob");
 * ```
 *
 * ============================================================================
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProtocolAddress } from "@signalapp/libsignal-client";
import { WebSocket, type RawData } from "ws";
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
import { aliceId, bobId, bobSignalDbPath, relayUrl } from "./config";
import { ensureAliceBootstrapped, ensureAliceSessionWith, getAliceSignalState } from "./signal";

/**
 * Valid demo user identifiers.
 */
export const DemoUserSchema = z.enum(["alice", "bob"]);
export type DemoUser = z.infer<typeof DemoUserSchema>;

/**
 * Schema for direct user-to-user chat messages.
 *
 * These are simple text messages between demo users,
 * separate from the SysMaint protocol messages.
 */
export const DirectUserChatSchema = z.object({
  version: z.literal(1),
  kind: z.literal("user.chat.v1"),
  messageId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.number().int().positive()
});

export type DirectUserChat = z.infer<typeof DirectUserChatSchema>;

/**
 * Type alias for Signal state.
 */
type SignalState = ReturnType<typeof openStore>;

/**
 * Map demo user keys to Signal identity names.
 */
const userIdByKey: Record<DemoUser, string> = {
  alice: aliceId,
  bob: bobId
};

/**
 * Bob's Signal state (lazily initialized).
 */
let bobState: SignalState | null = null;

/**
 * Get passphrase from environment.
 *
 * @returns Passphrase string
 * @throws Error if not set
 */
function getPassphrase(): string {
  const value = process.env.MEGA_PASSPHRASE;
  if (!value) {
    throw new Error("MEGA_PASSPHRASE is required for direct E2EE chat.");
  }
  return value;
}

/**
 * Get Signal state for a demo user.
 *
 * @param user - Demo user ("alice" or "bob")
 * @returns SignalState instance
 */
function getState(user: DemoUser): SignalState {
  if (user === "alice") return getAliceSignalState();
  if (bobState) return bobState;
  mkdirSync(path.dirname(bobSignalDbPath), { recursive: true });
  bobState = openStore(bobSignalDbPath, getPassphrase());
  return bobState;
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
 * Ensure a demo user's Signal identity is bootstrapped.
 *
 * @param user - Demo user to bootstrap
 */
async function ensureUserBootstrapped(user: DemoUser): Promise<void> {
  // Alice uses shared function from signal.ts
  if (user === "alice") {
    await ensureAliceBootstrapped();
    return;
  }

  // Bob needs separate initialization
  const state = getState(user);
  const userId = userIdByKey[user];

  if (!state.getLocalIdentity()) {
    await initializeIdentity(state, userId, 1);
  }

  await generatePreKeys(state, 1);
  await httpPostJson(`${relayUrl}/v1/register`, { id: userId });
  const bundle = await exportBundle(state);
  await httpPostJson(`${relayUrl}/v1/prekeys`, { id: userId, bundle });
}

/**
 * Ensure Signal session between two demo users.
 *
 * @param from - Sender demo user
 * @param peerId - Recipient Signal identity name
 */
async function ensureSessionWith(from: DemoUser, peerId: string): Promise<void> {
  // Alice uses shared function
  if (from === "alice") {
    await ensureAliceSessionWith(peerId);
    return;
  }

  // Bob needs separate session management
  const state = getState(from);
  const address = ProtocolAddress.new(peerId, 1);
  const existing = await state.sessionStore.getSession(address);
  if (existing) return;

  const payload = await httpGetJson<{ id: string; bundle: Bundle }>(`${relayUrl}/v1/prekeys/${peerId}`);
  await initSession(state, ensureBundle(payload.bundle));
}

/**
 * Send direct encrypted message from one demo user to another.
 *
 * @param from - Sender demo user
 * @param to - Recipient demo user
 * @param text - Message text
 * @returns Sent message object
 * @throws Error if from === to
 */
export async function sendDirectMessage(from: DemoUser, to: DemoUser, text: string): Promise<DirectUserChat> {
  if (from === to) {
    throw new Error("Sender and recipient must be different.");
  }

  const fromId = userIdByKey[from];
  const toId = userIdByKey[to];
  const state = getState(from);

  // Ensure both users are bootstrapped
  await ensureUserBootstrapped(from);
  await ensureUserBootstrapped(to);

  // Ensure session exists
  await ensureSessionWith(from, toId);

  // Build message
  const message: DirectUserChat = {
    version: 1,
    kind: "user.chat.v1",
    messageId: randomUUID(),
    from: fromId,
    to: toId,
    text,
    createdAt: Date.now()
  };

  // Encrypt and send
  const envelope = await encryptMessage(state, toId, JSON.stringify(message));
  await httpPostJson(`${relayUrl}/v1/messages`, {
    from: fromId,
    to: toId,
    envelope
  });

  return message;
}

/**
 * Pull direct messages for a demo user.
 *
 * Opens WebSocket and collects messages for a short window.
 * Used for short-polling message retrieval.
 *
 * @param user - Demo user to pull messages for
 * @param windowMs - How long to wait for messages (default: 900ms)
 * @returns Array of received messages
 */
export async function pullDirectMessages(user: DemoUser, windowMs = 900): Promise<DirectUserChat[]> {
  const userId = userIdByKey[user];
  const state = getState(user);

  await ensureUserBootstrapped(user);

  return await new Promise<DirectUserChat[]>((resolve, reject) => {
    const ws = new WebSocket(resolveWsUrl(relayUrl, userId));
    const received = new Map<string, DirectUserChat>();
    const pending: Promise<void>[] = [];
    let settled = false;

    /**
     * Mark operation as complete.
     */
    const done = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void Promise.allSettled(pending).then(() => {
        try {
          ws.close(1000, "pull-complete");
        } catch {
          // ignore
        }
        if (err) reject(err);
        else resolve(Array.from(received.values()).sort((a, b) => a.createdAt - b.createdAt));
      });
    };

    // Set window timer
    const timer = setTimeout(() => done(), windowMs);
    timer.unref();

    // Handle incoming messages
    ws.on("message", (raw: RawData) => {
      const task = (async () => {
        try {
          const payload = JSON.parse(raw.toString()) as { envelope?: unknown };
          const envelope = loadEnvelope(payload.envelope ?? payload);
          const plaintext = await decryptMessage(state, envelope);
          const parsed = DirectUserChatSchema.safeParse(JSON.parse(plaintext));

          if (!parsed.success) return;
          if (parsed.data.to !== userId) return;

          received.set(parsed.data.messageId, parsed.data);
        } catch {
          // Ignore unrelated payloads
        }
      })();
      pending.push(task);
    });

    ws.on("error", (err) => {
      done(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on("close", () => {
      done();
    });
  });
}
