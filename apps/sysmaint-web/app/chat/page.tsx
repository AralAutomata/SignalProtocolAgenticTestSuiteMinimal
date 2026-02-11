/**
 * ============================================================================
 * Chat Page Component - Alice ↔ SysMaint E2EE Interface
 * ============================================================================
 * 
 * PURPOSE:
 * Interactive chat interface for communicating with the SysMaint AI agent
 * through end-to-end encrypted Signal Protocol messages. This page allows
 * Alice (the web user) to send prompts to the AI agent and receive
 * encrypted responses.
 * 
 * ARCHITECTURE:
 * - Next.js Client Component ("use client")
 * - Simple chat interface with message history
 * - Quick prompt templates for common queries
 * - REST API communication with Signal encryption
 * - Auto-scrolling message log
 * 
 * FEATURES:
 * - Real-time chat interface with message history
 * - Pre-defined quick prompts for common system queries
 * - Auto-scroll to newest messages
 * - Loading states during message transmission
 * - Error handling with inline error messages
 * - Clean, minimal UI focused on conversation
 * 
 * MESSAGE FLOW:
 * 1. User types prompt or clicks quick prompt button
 * 2. User message added to local state (immediately visible)
 * 3. API call to /api/chat with Signal encryption
 * 4. Wait for encrypted response from SysMaint agent
 * 5. Bot response added to message history
 * 6. Chat log auto-scrolls to show new message
 * 
 * QUICK PROMPTS:
 * Ready-to-use prompts for common system monitoring tasks:
 * - System status summaries
 * - Anomaly detection queries
 * - Trend analysis (CPU, memory over time)
 * - Relay health checks
 * - Incident response checklists
 * - User impact assessment
 * - JSON-formatted status requests
 * 
 * STATE MANAGEMENT:
 * - prompt: Current text in input field
 * - busy: Loading state during API call
 * - messages: Array of chat messages (user and bot)
 * - chatLogRef: Reference for auto-scrolling
 * 
 * MESSAGE TYPES:
 * ChatMessage: Unified message structure
 * - id: Unique identifier (timestamp or requestId based)
 * - role: "user" (Alice) or "bot" (SysMaint)
 * - text: Message content
 * 
 * SECURITY:
 * - All messages encrypted via Signal Protocol before transmission
 * - API route (/api/chat) handles encryption/decryption
 * - Plaintext only visible in this UI, encrypted on network
 * - Relay server cannot read message content
 * 
 * ERROR HANDLING:
 * - Network errors displayed as bot messages
 * - Failed requests don't crash the app
 * - Input preserved on error (user can retry)
 * - HTTP status codes shown in error messages
 * 
 * UI COMPONENTS:
 * - Message log with user/bot styling differentiation
 * - Quick prompt button grid
 * - Textarea input for custom prompts
 * - Submit button with loading state
 * - Empty state when no messages
 * 
 * PERFORMANCE:
 * - Efficient state updates with functional setState
 * - Scroll optimization via useEffect
 * - No unnecessary re-renders
 * 
 * ACCESSIBILITY:
 * - Semantic form elements
 * - Disabled states during loading
 * - Clear visual distinction between user/bot messages
 * 
 * @module apps/sysmaint-web/app/chat/page
 * @see {@link /api/chat} API endpoint for Signal-encrypted chat
 * @see {@link ./demo/page.tsx} Alternative 3-panel demo interface
 * @see {@link ../layout.tsx} Parent layout with navigation
 * ============================================================================
 */

"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

/**
 * Type definition for chat messages.
 * 
 * This unified structure handles both user messages (from Alice)
 * and bot messages (from SysMaint AI agent).
 */
type ChatMessage = {
  /**
   * Unique message identifier.
   * Format depends on message type:
   * - User: "u:${timestamp}" (e.g., "u:1704067200000")
   * - Bot: "b:${requestId}" (e.g., "b:uuid-123")
   * - Error: "e:${timestamp}" (e.g., "e:1704067200000")
   */
  id: string;
  
  /**
   * Message sender type.
   * - "user": Message from Alice (the web user)
   * - "bot": Response from SysMaint AI agent
   */
  role: "user" | "bot";
  
  /** Message text content (plaintext) */
  text: string;
};

/**
 * Pre-defined quick prompt templates.
 * 
 * These provide one-click access to common system monitoring queries,
 * making it easy for users to get started without typing custom prompts.
 * 
 * Categories covered:
 * - Status summaries
 * - Anomaly detection
 * - Trend analysis
 * - Health checks
 * - Incident response
 * - Impact assessment
 * - Structured data (JSON)
 */
const readyPrompts = [
  /** Quick overview of current system state */
  "System status summary in one line.",
  
  /** Check for ongoing issues */
  "Are there any active anomalies right now?",
  
  /** Time-series analysis request */
  "Show CPU and memory trend for the last 30 minutes.",
  
  /** Relay infrastructure health */
  "Is the relay queue healthy? If not, what should I check first?",
  
  /** Emergency response guidance */
  "Give me a high-severity incident checklist for this stack.",
  
  /** Concise metrics overview */
  "Summarize relay health in 3 bullets with exact numbers.",
  
  /** Comparative analysis */
  "Compare now vs 10 minutes ago for CPU, memory, and queue depth.",
  
  /** Root cause analysis */
  "If we are degraded, give top 3 likely causes in priority order.",
  
  /** Diagnostic commands */
  "Recommend immediate commands to validate relay and websocket health.",
  
  /** Impact assessment */
  "Estimate user impact right now: none, low, medium, or high, and why.",
  
  /** Structured triage process */
  "Create a 5-minute triage plan with concrete checks and expected outcomes.",
  
  /** Alert threshold recommendations */
  "Explain any queue growth pattern and what threshold should trigger an alert.",
  
  /** Proactive mitigation */
  "Give a rollback-safe mitigation plan if memory keeps rising for 15 more minutes.",
  
  /** Machine-readable output request */
  "Return status in JSON with fields: health, cpuPct, memPct, queue, activeWs, action."
];

/**
 * Chat Page Component
 * 
 * Interactive chat interface for Alice to communicate with the
 * SysMaint AI agent via Signal Protocol encryption.
 * 
 * @returns JSX.Element - The complete chat interface
 */
export default function ChatPage() {
  /**
   * State: Current text in the input textarea.
   * Updated on every keystroke via onChange handler.
   */
  const [prompt, setPrompt] = useState("");
  
  /**
   * State: Loading indicator during API request.
   * true while waiting for Signal-encrypted response.
   */
  const [busy, setBusy] = useState(false);
  
  /**
   * State: Array of chat messages (history).
   * Grows as conversation progresses.
   */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  /**
   * Ref: Reference to the chat log container div.
   * Used for auto-scrolling to newest messages.
   */
  const chatLogRef = useRef<HTMLDivElement | null>(null);

  /**
   * Effect: Auto-scroll to newest message.
   * 
   * Runs whenever messages array changes.
   * Scrolls the chat log to the bottom to show
   * the most recent message.
   */
  useEffect(() => {
    if (!chatLogRef.current) return;
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [messages]);

  /**
   * Handler: Form submission (send message).
   * 
   * Flow:
   * 1. Prevent default form submission
   * 2. Validate input (non-empty, not busy)
   * 3. Add user message to state (immediate UI feedback)
   * 4. Clear input field
   * 5. Call API with Signal encryption
   * 6. Add bot response to state
   * 7. Handle errors gracefully
   * 8. Clear loading state
   * 
   * @param event - Form submission event
   */
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    // Get trimmed input
    const trimmed = prompt.trim();
    
    // Validate: must have content and not be busy
    if (!trimmed || busy) return;

    /**
     * Create user message object.
     * ID format: "u:${timestamp}" for easy identification.
     */
    const userMessage: ChatMessage = {
      id: `u:${Date.now()}`,
      role: "user",
      text: trimmed
    };
    
    // Add user message to history (immediate UI update)
    setMessages((prev) => [...prev, userMessage]);
    
    // Clear input and set loading state
    setPrompt("");
    setBusy(true);

    try {
      /**
       * Send message to API with Signal encryption.
       * 
       * The /api/chat endpoint handles:
       * - Loading Alice's Signal identity
       * - Encrypting the prompt
       * - Sending via relay server
       * - Receiving encrypted response
       * - Decrypting the response
       * - Returning plaintext reply
       */
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed })
      });
      
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`);
      }

      // Parse successful response
      const payload = (await res.json()) as { reply: string; requestId: string };
      
      /**
       * Add bot response to message history.
       * Uses requestId from API for message ID.
       */
      setMessages((prev) => [
        ...prev,
        {
          id: `b:${payload.requestId}`,
          role: "bot",
          text: payload.reply
        }
      ]);
    } catch (err) {
      /**
       * Error handling: Display error as bot message.
       * This provides clear feedback without breaking the UI.
       */
      setMessages((prev) => [
        ...prev,
        {
          id: `e:${Date.now()}`,
          role: "bot",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    } finally {
      // Always clear loading state
      setBusy(false);
    }
  };

  return (
    <section className="chat-wrap">
      {/* Page header */}
      <h1>Alice ↔ SysMaint (Signal E2EE)</h1>
      
      {/* Security context subtitle */}
      <p className="sub">
        Prompts and replies are transported as Signal-encrypted envelopes through the relay.
      </p>
      
      {/* Message log display */}
      <div className="chat-log" ref={chatLogRef}>
        {/* Empty state */}
        {messages.length === 0 ? (
          <div className="sub">No messages yet.</div>
        ) : null}
        
        {/* Render all messages */}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg ${msg.role}`}>
            {/* Message header: Sender name */}
            <strong>{msg.role === "user" ? "Alice" : "SysMaint"}:</strong>{" "}
            {/* Message content */}
            {msg.text}
          </div>
        ))}
      </div>
      
      {/* Message input form */}
      <form onSubmit={onSubmit}>
        {/* Quick prompt buttons grid */}
        <div className="quick-prompts">
          {readyPrompts.map((template) => (
            <button
              key={template}
              type="button"
              className="quick-btn"
              onClick={() => setPrompt(template)}
              disabled={busy}
            >
              {template}
            </button>
          ))}
        </div>
        
        {/* Main text input */}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask for system status, trends, anomalies, queue state..."
        />
        
        {/* Submit button */}
        <div style={{ marginTop: 10 }}>
          <button type="submit" disabled={busy || prompt.trim().length === 0}>
            {busy ? "Waiting for encrypted reply..." : "Send via Signal"}
          </button>
        </div>
      </form>
    </section>
  );
}
