/**
 * ============================================================================
 * Demo Page Component - 3-Panel E2EE Demonstration
 * ============================================================================
 * 
 * PURPOSE:
 * Educational demonstration page showcasing end-to-end encryption capabilities
 * in a 3-panel layout. This page demonstrates:
 * - Direct Signal E2EE messaging between Alice and Bob
 * - AI agent integration via Signal Protocol
 * - Simultaneous conversations in one view
 * - Real-time message polling and state synchronization
 * 
 * ARCHITECTURE:
 * - Next.js Client Component ("use client")
 * - 3-column responsive grid layout
 * - Left: Alice's chat interface (sending to Bob)
 * - Center: SysMaint AI chat interface
 * - Right: Bob's chat interface (sending to Alice)
 * - Shared message state between Alice and Bob panels
 * - Separate state for SysMaint conversation
 * 
 * MESSAGE FLOWS:
 * 
 * 1. Alice ↔ Bob Direct Messaging:
 *    - Alice sends message via /api/e2ee/send
 *    - Message encrypted with Signal Protocol (X3DH + Double Ratchet)
 *    - Sent to relay server
 *    - Bob's panel polls /api/e2ee/pull every 1.2s
 *    - Bob receives and decrypts message
 *    - Shared thread state updates both panels
 * 
 * 2. Auto-Status Feature:
 *    - After each Alice→Bob message
 *    - System automatically queries SysMaint for E2EE health status
 *    - Displays encrypted delivery confirmation
 *    - Shows relay statistics
 * 
 * 3. Alice ↔ SysMaint AI:
 *    - Direct chat with AI agent
 *    - Same Signal encryption as Alice↔Bob
 *    - Separate conversation history
 *    - Quick prompt templates available
 * 
 * STATE MANAGEMENT:
 * 
 * Direct Messaging State:
 * - directMessages: Array of all E2EE messages (Alice↔Bob)
 * - aliceInput/bobInput: Input field values
 * - aliceBusy/bobBusy: Loading states
 * - directError: Error display
 * 
 * SysMaint Chat State:
 * - sysmaintPrompt: Input field value
 * - sysmaintBusy: Loading state
 * - sysmaintMessages: Conversation history
 * 
 * UI Refs:
 * - aliceLogRef/bobLogRef: Auto-scroll refs for E2EE panels
 * - sysmaintLogRef: Auto-scroll ref for AI panel
 * 
 * POLLING STRATEGY:
 * - Polls Bob's queue every 1.2 seconds
 * - Avoids polling Alice's queue (WebSocket conflict with chat)
 * - Silent failures (no error display for poll failures)
 * - Cleanup on unmount prevents memory leaks
 * 
 * COMPONENT STRUCTURE:
 * 
 * ThreadPanel (sub-component):
 * - Reusable chat panel for Alice and Bob
 * - Props: title, owner, thread, input state, handlers
 * - Handles both outbound and inbound messages
 * - Shows sender differentiation
 * 
 * Main DemoPage:
 * - Manages all state and data flow
 * - Renders 3 ThreadPanels in grid layout
 * - Handles all API interactions
 * - Coordinates auto-status feature
 * 
 * TYPE DEFINITIONS:
 * 
 * DemoUser: Union type "alice" | "bob"
 * - Constrains user identities to valid demo users
 * - Used for type-safe sender/recipient handling
 * 
 * DirectMessage: Signal E2EE message structure
 * - version: Protocol version (1)
 * - kind: Message type discriminator
 * - messageId: Unique identifier
 * - from/to: Sender and recipient
 * - text: Decrypted content
 * - createdAt: Timestamp
 * 
 * BotMessage: SysMaint chat message
 * - id: Unique identifier
 * - role: "user" (Alice) or "bot" (SysMaint)
 * - text: Message content
 * 
 * QUICK PROMPTS:
 * Ready-to-use prompts for SysMaint AI covering:
 * - Status summaries
 * - Anomaly detection
 * - Trend analysis
 * - Health checks
 * - Incident response
 * 
 * UTILITY FUNCTIONS:
 * 
 * formatTime: Formats timestamp to localized time string
 * buildAutoStatusPrompt: Generates auto-status query from message
 * mergeDirectMessages: Deduplicates and sorts message arrays
 * 
 * ERROR HANDLING:
 * - Network errors displayed in UI
 * - Failed sends restore input for retry
 * - Silent poll failures (background operation)
 * - Individual panel errors don't crash entire page
 * 
 * PERFORMANCE:
 * - useMemo for thread filtering
 * - Efficient state updates
 * - Controlled polling frequency
 * - Auto-scroll optimization
 * 
 * SECURITY DEMONSTRATION:
 * - Shows end-to-end encryption in action
 * - Visual proof of encrypted delivery
 * - Auto-status confirms encryption health
 * - Educational tool for understanding Signal Protocol
 * 
 * @module apps/sysmaint-web/app/demo/page
 * @see {@link /api/e2ee/send} Send encrypted message API
 * @see {@link /api/e2ee/pull} Retrieve encrypted messages API
 * @see {@link /api/chat} SysMaint chat API
 * @see {@link ../lib/e2ee-chat.ts} E2EE implementation
 * @see {@link ./chat/page.tsx} Simplified 1-panel chat interface
 * ============================================================================
 */

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type RefObject } from "react";

/**
 * Valid demo user identities.
 * Union type ensures only "alice" or "bob" can be used,
 * providing compile-time type safety.
 */
type DemoUser = "alice" | "bob";

/**
 * Signal Protocol direct message structure.
 * 
 * This represents a decrypted message in the Alice↔Bob conversation.
 * The message was encrypted during transmission and decrypted
 * locally using the Signal Protocol.
 */
type DirectMessage = {
  /** Protocol version for future compatibility */
  version: 1;
  
  /** Message type discriminator for protocol routing */
  kind: "user.chat.v1";
  
  /** Unique message identifier (UUID) */
  messageId: string;
  
  /** Sender identity ("alice" or "bob") */
  from: string;
  
  /** Recipient identity ("alice" or "bob") */
  to: string;
  
  /** Decrypted message content (plaintext) */
  text: string;
  
  /** Unix timestamp when message was sent */
  createdAt: number;
};

/**
 * SysMaint AI chat message structure.
 * 
 * Used for the center panel conversation with the AI agent.
 * Simpler structure than DirectMessage as it doesn't need
 * the full Signal Protocol metadata.
 */
type BotMessage = {
  /** Unique message identifier */
  id: string;
  
  /** Message sender type */
  role: "user" | "bot";
  
  /** Message text content */
  text: string;
};

/**
 * Pre-defined quick prompt templates for SysMaint AI.
 * 
 * These one-click prompts make it easy to demonstrate
 * common system monitoring queries.
 */
const sysmaintReadyPrompts = [
  "System status summary in one line.",
  "Are there any active anomalies right now?",
  "Show CPU and memory trend for the last 30 minutes.",
  "Is the relay queue healthy? If not, what should I check first?",
  "Give me a high-severity incident checklist for this stack."
];

/**
 * Formats a Unix timestamp to localized time string.
 * 
 * @param ts - Unix timestamp in milliseconds
 * @returns Localized time (e.g., "12:00:00 PM")
 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/**
 * Builds an auto-status prompt from a direct message.
 * 
 * When Alice sends a message to Bob, the system automatically
 * queries SysMaint for encryption health status. This function
 * constructs the prompt that asks for E2EE delivery confirmation
 * and relay statistics.
 * 
 * @param message - The direct message that triggered auto-status
 * @returns Formatted prompt string for SysMaint AI
 */
function buildAutoStatusPrompt(message: DirectMessage): string {
  return [
    "Auto E2EE health check requested by demo UI.",
    `A Signal direct message was sent from ${message.from} to ${message.to}.`,
    `Message ID: ${message.messageId}`,
    `Timestamp (UTC): ${new Date(message.createdAt).toISOString()}`,
    `Payload length (chars): ${message.text.length}`,
    "Reply in exactly two lines:",
    "1) E2EE: Alice<->Bob session/delivery health.",
    "2) System: relay/users/prekeys/queue/active_ws status with key numbers."
  ].join("\n");
}

/**
 * Merges two arrays of direct messages, removing duplicates.
 * 
 * Uses a Map for O(n) deduplication based on messageId.
 * Results are sorted by creation timestamp (oldest first).
 * 
 * @param existing - Current messages in state
 * @param incoming - New messages from API
 * @returns Deduplicated, sorted array of messages
 */
function mergeDirectMessages(
  existing: DirectMessage[], 
  incoming: DirectMessage[]
): DirectMessage[] {
  const merged = new Map<string, DirectMessage>();
  
  // Add existing messages to map
  for (const msg of existing) {
    merged.set(msg.messageId, msg);
  }
  
  // Add incoming messages (overwrites if duplicate)
  for (const msg of incoming) {
    merged.set(msg.messageId, msg);
  }
  
  // Convert to array and sort by timestamp
  return Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * ThreadPanel Sub-Component
 * 
 * Reusable chat panel component for Alice and Bob's interfaces.
 * Displays the shared conversation thread from the owner's perspective.
 * 
 * Props:
 * - title: Panel header text
 * - owner: Which user's view this is ("alice" or "bob")
 * - thread: Array of messages to display
 * - inputValue: Current input text
 * - inputPlaceholder: Placeholder text for empty input
 * - sending: Whether a message is being sent
 * - onInputChange: Handler for input changes
 * - onSend: Handler for form submission
 * - logRef: Ref for auto-scrolling
 */
function ThreadPanel({
  title,
  owner,
  thread,
  inputValue,
  inputPlaceholder,
  sending,
  onInputChange,
  onSend,
  logRef
}: {
  title: string;
  owner: DemoUser;
  thread: DirectMessage[];
  inputValue: string;
  inputPlaceholder: string;
  sending: boolean;
  onInputChange: (text: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  logRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="demo-panel">
      {/* Panel header */}
      <h2>{title}</h2>
      <p className="sub">Signal E2EE channel</p>
      
      {/* Message log with auto-scroll */}
      <div className="chat-log" ref={logRef}>
        {/* Empty state */}
        {thread.length === 0 ? (
          <div className="sub">No direct messages yet.</div>
        ) : null}
        
        {/* Render all messages */}
        {thread.map((msg) => {
          // Determine if this message was sent by the owner
          const outbound = msg.from === owner;
          
          return (
            <div key={msg.messageId} className={`msg ${outbound ? "user" : "bot"}`}>
              {/* Sender name and content */}
              <strong>{msg.from}:</strong> {msg.text}
              {/* Timestamp */}
              <div className="sub">{formatTime(msg.createdAt)}</div>
            </div>
          );
        })}
      </div>
      
      {/* Message input form */}
      <form onSubmit={onSend}>
        <textarea
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={inputPlaceholder}
        />
        <div style={{ marginTop: 10 }}>
          <button type="submit" disabled={sending || inputValue.trim().length === 0}>
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Demo Page Component - Main Application
 * 
 * 3-panel demonstration of Signal Protocol end-to-end encryption.
 * Shows Alice↔Bob messaging and SysMaint AI integration.
 * 
 * @returns JSX.Element - The complete 3-panel demo interface
 */
export default function DemoPage() {
  /**
   * STATE: Direct Messaging (Alice ↔ Bob)
   */
  
  /** All E2EE messages in the conversation */
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  
  /** Alice's input field value */
  const [aliceInput, setAliceInput] = useState("");
  
  /** Bob's input field value */
  const [bobInput, setBobInput] = useState("");
  
  /** Alice's sending state */
  const [aliceBusy, setAliceBusy] = useState(false);
  
  /** Bob's sending state */
  const [bobBusy, setBobBusy] = useState(false);
  
  /** Error message for direct chat */
  const [directError, setDirectError] = useState<string | null>(null);

  /**
   * STATE: SysMaint AI Chat (Center Panel)
   */
  
  /** Input field value for AI chat */
  const [sysmaintPrompt, setSysmaintPrompt] = useState("");
  
  /** AI chat loading state */
  const [sysmaintBusy, setSysmaintBusy] = useState(false);
  
  /** AI conversation history */
  const [sysmaintMessages, setSysmaintMessages] = useState<BotMessage[]>([]);

  /**
   * REFS: Auto-scroll references
   */
  const aliceLogRef = useRef<HTMLDivElement | null>(null);
  const bobLogRef = useRef<HTMLDivElement | null>(null);
  const sysmaintLogRef = useRef<HTMLDivElement | null>(null);

  /**
   * Effect: Auto-scroll Alice and Bob panels.
   * Runs whenever directMessages changes.
   */
  useEffect(() => {
    if (aliceLogRef.current) {
      aliceLogRef.current.scrollTop = aliceLogRef.current.scrollHeight;
    }
    if (bobLogRef.current) {
      bobLogRef.current.scrollTop = bobLogRef.current.scrollHeight;
    }
  }, [directMessages]);

  /**
   * Effect: Auto-scroll SysMaint panel.
   * Runs whenever sysmaintMessages changes.
   */
  useEffect(() => {
    if (!sysmaintLogRef.current) return;
    sysmaintLogRef.current.scrollTop = sysmaintLogRef.current.scrollHeight;
  }, [sysmaintMessages]);

  /**
   * Effect: Poll for Bob's messages.
   * 
   * Sets up polling every 1.2 seconds to check for new messages
   * addressed to Bob. Updates the shared directMessages state.
   * 
   * Note: Only polls Bob's queue to avoid WebSocket conflicts
   * with the Alice↔SysMaint chat which uses the same identity.
   */
  useEffect(() => {
    let stop = false;

    const poll = async () => {
      try {
        /**
         * Poll Bob's message queue via API.
         * cache: "no-store" ensures fresh data.
         */
        const bobRes = await fetch("/api/e2ee/pull?user=bob", { cache: "no-store" });
        if (!bobRes.ok) return;

        const bobPayload = (await bobRes.json()) as { 
          ok: boolean; 
          messages?: DirectMessage[] 
        };
        
        if (stop) return;
        if (!bobPayload.ok) return;

        // Merge new messages into state
        const incoming = [...(bobPayload.messages ?? [])];
        if (incoming.length === 0) return;
        setDirectMessages((prev) => mergeDirectMessages(prev, incoming));
      } catch {
        // Silent failures are acceptable for polling
        // Errors in the sending path are displayed explicitly
      }
    };

    // Initial poll and interval setup
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1200);

    // Cleanup on unmount
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  /**
   * Computed: Filter messages to Alice↔Bob thread.
   * 
   * useMemo prevents unnecessary recalculation on every render.
   * Only includes messages between Alice and Bob (not system messages).
   */
  const thread = useMemo(() => {
    return directMessages.filter(
      (msg) =>
        (msg.from === "alice" && msg.to === "bob") ||
        (msg.from === "bob" && msg.to === "alice")
    );
  }, [directMessages]);

  /**
   * Handler: Send direct message (Alice ↔ Bob).
   * 
   * Encrypts and sends a message between demo users.
   * Also triggers auto-status query to SysMaint after sending.
   * 
   * @param from - Sender identity ("alice" or "bob")
   * @param to - Recipient identity ("alice" or "bob")
   * @param text - Message content
   */
  const sendDirect = async (from: DemoUser, to: DemoUser, text: string) => {
    // Send encrypted message via API
    const res = await fetch("/api/e2ee/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, text })
    });
    
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`HTTP ${res.status} ${payload}`);
    }
    
    const payload = (await res.json()) as { 
      ok: boolean; 
      message?: DirectMessage; 
      error?: string 
    };
    
    if (!payload.ok || !payload.message) {
      throw new Error(payload.error ?? "Failed to send direct message.");
    }
    
    const message = payload.message;
    
    // Add sent message to local state
    setDirectMessages((prev) => mergeDirectMessages(prev, [message]));
    
    /**
     * Auto-status feature:
     * After sending a direct message, automatically query SysMaint
     * for E2EE health status and relay statistics.
     */
    void (async () => {
      try {
        const autoPrompt = buildAutoStatusPrompt(message);
        
        const statusRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: autoPrompt })
        });
        
        if (!statusRes.ok) {
          const errText = await statusRes.text();
          throw new Error(`HTTP ${statusRes.status} ${errText}`);
        }
        
        const statusPayload = (await statusRes.json()) as { 
          ok: boolean; 
          requestId?: string; 
          reply?: string 
        };
        
        if (!statusPayload.ok || !statusPayload.reply) {
          throw new Error("Missing SysMaint auto status reply.");
        }
        
        // Add auto-status response to SysMaint chat
        setSysmaintMessages((prev) => [
          ...prev,
          {
            id: `auto:${statusPayload.requestId ?? message.messageId}`,
            role: "bot",
            text: `Auto E2EE status (${message.from} -> ${message.to}): ${statusPayload.reply}`
          }
        ]);
      } catch (err) {
        // Add error message if auto-status fails
        setSysmaintMessages((prev) => [
          ...prev,
          {
            id: `auto-error:${message.messageId}:${Date.now()}`,
            role: "bot",
            text: `Auto E2EE status failed (${message.from} -> ${message.to}): ${err instanceof Error ? err.message : String(err)}`
          }
        ]);
      }
    })();
  };

  /**
   * Handler: Alice sends message to Bob.
   */
  const onAliceSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = aliceInput.trim();
    if (!text || aliceBusy) return;

    setAliceBusy(true);
    setDirectError(null);
    setAliceInput("");
    
    try {
      await sendDirect("alice", "bob", text);
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : String(err));
      setAliceInput(text); // Restore input on error
    } finally {
      setAliceBusy(false);
    }
  };

  /**
   * Handler: Bob sends message to Alice.
   */
  const onBobSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = bobInput.trim();
    if (!text || bobBusy) return;

    setBobBusy(true);
    setDirectError(null);
    setBobInput("");
    
    try {
      await sendDirect("bob", "alice", text);
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : String(err));
      setBobInput(text); // Restore input on error
    } finally {
      setBobBusy(false);
    }
  };

  /**
   * Handler: Send message to SysMaint AI.
   */
  const onSysmaintSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = sysmaintPrompt.trim();
    if (!text || sysmaintBusy) return;

    // Add user message immediately
    const userMessage: BotMessage = {
      id: `u:${Date.now()}`,
      role: "user",
      text
    };
    setSysmaintMessages((prev) => [...prev, userMessage]);
    setSysmaintPrompt("");
    setSysmaintBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      
      if (!res.ok) {
        const payload = await res.text();
        throw new Error(`HTTP ${res.status} ${payload}`);
      }
      
      const payload = (await res.json()) as { reply: string; requestId: string };
      
      // Add bot response
      setSysmaintMessages((prev) => [
        ...prev,
        {
          id: `b:${payload.requestId}`,
          role: "bot",
          text: payload.reply
        }
      ]);
    } catch (err) {
      // Add error message
      setSysmaintMessages((prev) => [
        ...prev,
        {
          id: `e:${Date.now()}`,
          role: "bot",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    } finally {
      setSysmaintBusy(false);
    }
  };

  return (
    <section>
      {/* Page header */}
      <h1>E2EE Demo: Alice ↔ Bob + SysMaint</h1>
      
      {/* Description */}
      <p className="sub">
        Left and right panes demonstrate Signal E2EE direct chat between Alice and Bob. 
        Center pane is SysMaint AI.
      </p>
      
      {/* Error display */}
      {directError ? <p className="sub">Direct chat error: {directError}</p> : null}
      
      {/* 3-Panel Grid Layout */}
      <div className="demo-grid">
        {/* Left Panel: Alice's View */}
        <ThreadPanel
          title="Alice (to Bob)"
          owner="alice"
          thread={thread}
          inputValue={aliceInput}
          inputPlaceholder="Alice writes to Bob..."
          sending={aliceBusy}
          onInputChange={setAliceInput}
          onSend={onAliceSend}
          logRef={aliceLogRef}
        />

        {/* Center Panel: SysMaint AI */}
        <section className="demo-panel">
          <h2>SysMaint AI</h2>
          <p className="sub">
            Signal E2EE path: Alice ↔ SysMaint (plus auto status after each Alice/Bob message)
          </p>
          
          {/* SysMaint chat log */}
          <div className="chat-log" ref={sysmaintLogRef}>
            {sysmaintMessages.length === 0 ? (
              <div className="sub">No SysMaint messages yet.</div>
            ) : null}
            
            {sysmaintMessages.map((msg) => (
              <div key={msg.id} className={`msg ${msg.role}`}>
                <strong>{msg.role === "user" ? "Alice" : "SysMaint"}:</strong> {msg.text}
              </div>
            ))}
          </div>
          
          {/* SysMaint input form */}
          <form onSubmit={onSysmaintSend}>
            {/* Quick prompt buttons */}
            <div className="quick-prompts">
              {sysmaintReadyPrompts.map((template) => (
                <button
                  key={template}
                  type="button"
                  className="quick-btn"
                  onClick={() => setSysmaintPrompt(template)}
                  disabled={sysmaintBusy}
                >
                  {template}
                </button>
              ))}
            </div>
            
            <textarea
              value={sysmaintPrompt}
              onChange={(event) => setSysmaintPrompt(event.target.value)}
              placeholder="Ask SysMaint about status, anomalies, trends..."
            />
            
            <div style={{ marginTop: 10 }}>
              <button type="submit" disabled={sysmaintBusy || sysmaintPrompt.trim().length === 0}>
                {sysmaintBusy ? "Waiting for encrypted reply..." : "Send to SysMaint"}
              </button>
            </div>
          </form>
        </section>

        {/* Right Panel: Bob's View */}
        <ThreadPanel
          title="Bob (to Alice)"
          owner="bob"
          thread={thread}
          inputValue={bobInput}
          inputPlaceholder="Bob writes to Alice..."
          sending={bobBusy}
          onInputChange={setBobInput}
          onSend={onBobSend}
          logRef={bobLogRef}
        />
      </div>
    </section>
  );
}
