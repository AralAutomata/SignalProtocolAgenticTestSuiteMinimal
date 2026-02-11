# Signal Protocol E2EE + SysMaint Agent Architecture

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Data Flow](#data-flow)
4. [Security Model](#security-model)
5. [Component Deep-Dive](#component-deep-dive)
6. [Deployment Architecture](#deployment-architecture)
7. [Key Design Decisions](#key-design-decisions)

---

## Executive Summary

This system demonstrates a **Signal Protocol-based end-to-end encrypted (E2EE)** communication stack for system maintenance operations. It combines:

- **Signal Protocol** for cryptographic messaging (X3DH key agreement, Double Ratchet algorithm)
- **AI-powered system monitoring** via LangChain/OpenAI integration
- **Real-time telemetry collection** and visualization
- **Educational demonstration** of E2EE concepts through interactive demos

The architecture prioritizes **security**, **observability**, and **educational clarity**.

---

## System Architecture Overview

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │   Web Browser   │  │   Web Browser   │  │       SysMaint CLI          │ │
│  │  (Alice User)   │  │   (Dashboard)   │  │    (AI Agent Terminal)      │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────────┬───────────────┘ │
└───────────┼────────────────────┼─────────────────────────┼─────────────────┘
            │                    │                         │
            ▼                    ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Next.js Web Application                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │   │
│  │  │  Dashboard   │  │  Chat Page   │  │      Demo Page           │    │   │
│  │  │   (page.tsx) │  │ (chat/page)  │  │   (demo/page.tsx)        │    │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘    │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │   │
│  │  │                     API Routes                                   │  │   │
│  │  │  /api/status/*  │  /api/chat  │  /api/e2ee/send  │  /api/e2ee/pull │   │
│  │  └─────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SIGNAL PROTOCOL LAYER                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │   signal-core       │  │   @signalapp/       │  │   sysmaint-protocol │  │
│  │   (Crypto + Store)  │  │   libsignal-client  │  │   (Message Types)   │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RELAY LAYER                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                         Relay Server                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐     │   │
│  │  │ HTTP Routes  │  │  WebSocket   │  │   Message Queue          │     │   │
│  │  │  (REST API)  │  │   Server     │  │   (In-Memory Store)      │     │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘     │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TELEMETRY LAYER                                        │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │    diag-probe       │  │   sysmaint-agent    │  │     state-db        │  │
│  │  (Metrics Collector)│  │ (AI + Signal Client)│  │   (SQLite Storage)  │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Web UI** | User interface for monitoring and chat | Next.js 14, React, TypeScript |
| **Relay Server** | Message routing without content access | Node.js, Express, ws |
| **Signal Core** | Cryptographic operations | @signalapp/libsignal-client |
| **SysMaint Agent** | AI-powered system analysis | LangChain, OpenAI, Signal Protocol |
| **Diag Probe** | System metrics collection | Node.js, systeminformation |
| **State DB** | Telemetry and usage persistence | better-sqlite3 |

---

## Data Flow

### 1. Alice → SysMaint AI Chat Flow

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Alice   │────▶│   Web UI    │────▶│ /api/chat    │────▶│   Signal    │────▶│ Relay Server │
│  (User)  │     │  (Browser)  │     │   (POST)     │     │  Protocol   │     │              │
└──────────┘     └─────────────┘     └──────────────┘     └─────────────┘     └──────┬───────┘
                                                                                      │
                                                                                      │ Encrypted Envelope
                                                                                      ▼
                                                                             ┌──────────────┐
                                                                             │ SysMaint     │
                                                                             │   Agent      │
                                                                             └──────┬───────┘
                                                                                    │
                                                                                    │ AI Processing
                                                                                    ▼
                                                                             ┌──────────────┐
                                                                             │   OpenAI     │
                                                                             │    API       │
                                                                             └──────────────┘
```

**Step-by-Step:**

1. **User Input**: Alice types prompt in web UI
2. **API Call**: Browser POSTs to `/api/chat` with plaintext
3. **Signal Encryption**: Server-side encryption using:
   - Load Alice's identity key pair
   - Establish Signal session with SysMaint (X3DH if needed)
   - Encrypt with Double Ratchet
   - Create encrypted envelope
4. **Relay Delivery**: Send envelope to relay server via HTTP POST
5. **Agent Retrieval**: SysMaint agent polls relay, receives envelope
6. **Decryption**: Agent decrypts using private keys
7. **AI Processing**: LangChain processes prompt with OpenAI
8. **Response Encryption**: Reply encrypted and sent back via same path
9. **UI Display**: Web UI receives and displays decrypted response

### 2. Alice ↔ Bob Direct Messaging Flow

```
┌─────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│  Alice  │────▶│   Demo UI    │────▶│ /api/e2ee/   │────▶│   Signal    │────▶│   Relay     │
│  (Web)  │     │  (demo/page) │     │   send      │     │  Protocol   │     │   Server    │
└─────────┘     └──────────────┘     └──────────────┘     └─────────────┘     └──────┬──────┘
                                                                                     │
                                                                                     │ Store & Forward
                                                                                     ▼
                                                                              ┌──────────────┐
                                                                              │   Message    │
                                                                              │    Queue     │
                                                                              └──────┬───────┘
                                                                                     │
┌─────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐          │
│   Bob   │◀────│   Demo UI    │◀────│ /api/e2ee/   │◀────│   Signal    │◀─────────┘
│  (Web)  │     │  (demo/page) │     │   pull      │     │  Decrypt    │
└─────────┘     └──────────────┘     └──────────────┘     └─────────────┘
```

**Security Properties:**

- **End-to-End Encryption**: Content encrypted before leaving sender
- **Forward Secrecy**: Each message uses unique key via Double Ratchet
- **Metadata Only**: Relay sees sender/recipient, not content
- **No Server Access**: Neither web server nor relay can read messages

### 3. Telemetry Collection Flow

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  diag-probe     │────▶│   Signal     │────▶│    Relay     │────▶│  Web UI      │
│ (System Stats)  │     │  Encryption  │     │   Server     │     │  Dashboard   │
└─────────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
        │                                                            │
        │ SQLite                                                      │ SQLite
        ▼                                                            ▼
┌─────────────────┐                                           ┌──────────────┐
│   state-db      │                                           │   state-db   │
│ (Local SQLite)  │                                           │ (Web Server) │
└─────────────────┘                                           └──────────────┘
```

**Collection Cycle:**

1. **Metrics Collection** (diag-probe): Gather CPU, memory, disk, network stats
2. **Local Storage**: Save to local SQLite for persistence
3. **E2EE Transmission**: Encrypt and send to web dashboard
4. **Database Storage**: Web server saves to its SQLite
5. **UI Display**: Dashboard queries and displays real-time metrics

---

## Security Model

### Threat Model

**Assumptions:**

- **Relay server is honest but curious**: Follows protocol but may log metadata
- **Network is untrusted**: Traffic may be intercepted
- **Web server compromise**: Attacker may gain access to web server but not to user's Signal keys
- **Physical security**: User devices are physically secure

**Threats Mitigated:**

| Threat | Mitigation |
|--------|-----------|
| **Eavesdropping** | End-to-end encryption via Signal Protocol |
| **Message Tampering** | Cryptographic authentication (HMAC) |
| **Replay Attacks** | Unique message IDs and timestamps |
| **Forward Secrecy** | Double Ratchet key rotation |
| **Server Compromise** | Server never has plaintext access |
| **Quantum Computing** | CRYSTALS-Kyber post-quantum prekeys |

### Cryptographic Components

```
┌─────────────────────────────────────────────────────────────┐
│                  SIGNAL PROTOCOL STACK                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  X3DH (Extended Triple Diffie-Hellman)              │   │
│  │  - Identity keys (long-term)                        │   │
│  │  - Signed prekeys (medium-term)                     │   │
│  │  - One-time prekeys (ephemeral)                     │   │
│  │  - Kyber post-quantum keys (optional)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Double Ratchet Algorithm                           │   │
│  │  - Root key chain                                   │   │
│  │  - Sending chain (for outbound)                     │   │
│  │  - Receiving chain (for inbound)                    │   │
│  │  - Per-message key derivation                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AES-256-GCM Encryption                             │   │
│  │  - 256-bit keys                                     │   │
│  │  - 96-bit nonce                                     │   │
│  │  - Authentication tag (128-bit)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Management

```
┌──────────────────────────────────────────────────────────────┐
│                    KEY HIERARCHY                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐                                         │
│  │ Master Password │ (User-provided)                         │
│  └────────┬────────┘                                         │
│           │ scrypt (N=2^14, r=8, p=5)                        │
│           ▼                                                  │
│  ┌─────────────────┐                                         │
│  │  32-byte Key    │                                         │
│  └────────┬────────┘                                         │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              ENCRYPTED KEY STORE                         ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ Identity Key Pair (Curve25519 or P-256)             │││
│  │  │ - Public: shared with contacts                      │││
│  │  │ - Private: never leaves device                      │││
│  │  └─────────────────────────────────────────────────────┘││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ Signed Prekey (medium-term)                         │││
│  │  │ - Rotated periodically (e.g., weekly)               │││
│  │  │ - Signed by identity key                            │││
│  │  └─────────────────────────────────────────────────────┘││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ One-Time Prekeys (ephemeral)                        │││
│  │  │ - Consumed on first use                             │││
│  │  │ - Batch generated (e.g., 100 at a time)             │││
│  │  └─────────────────────────────────────────────────────┘││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │ Kyber Keys (post-quantum)                           │││
│  │  │ - CRYSTALS-Kyber KEM                                │││
│  │  │ - Encapsulation keys for PQ security                │││
│  │  └─────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Message Encryption Process

```
Plaintext Message
       │
       ▼
┌──────────────────────┐
│ Double Ratchet       │
│ - Advance chain key  │
│ - Derive message key │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ AES-256-GCM Encrypt  │
│ - Key: message key   │
│ - Nonce: unique      │
│ - Auth tag: 128-bit  │
└──────────┬───────────┘
           │
           ▼
     Ciphertext
           │
           ▼
┌──────────────────────┐
│ Signal Envelope      │
│ - Sender identity    │
│ - Recipient          │
│ - Ciphertext         │
│ - Metadata           │
└──────────┬───────────┘
           │
           ▼
     Network Transport
```

---

## Component Deep-Dive

### 1. Web Application (Next.js)

**File Structure:**

```
apps/sysmaint-web/
├── app/
│   ├── layout.tsx          # Root layout with navigation
│   ├── page.tsx            # Dashboard (system status)
│   ├── chat/
│   │   └── page.tsx        # Alice ↔ SysMaint chat
│   ├── demo/
│   │   └── page.tsx        # 3-panel E2EE demo
│   └── api/
│       ├── chat/route.ts   # Signal-encrypted chat API
│       ├── e2ee/send/      # Send encrypted messages
│       ├── e2ee/pull/      # Retrieve encrypted messages
│       └── status/         # Telemetry endpoints
├── lib/
│   ├── config.ts           # Configuration management
│   ├── signal.ts           # Alice's Signal operations
│   ├── e2ee-chat.ts        # Demo E2EE messaging
│   └── state-db.ts         # Database access layer
└── globals.css             # Global styles
```

**Key Features:**

- **Server-side Signal operations** for educational demo
- **Real-time dashboard** with 5-second polling
- **Interactive E2EE demo** showing Alice↔Bob encryption
- **Quick prompt templates** for common queries

### 2. Signal Protocol Integration

**Core Module:** `packages/signal-core/`

```typescript
// Key Components:

// 1. Crypto Utilities (crypto.ts)
- deriveKey(password)           // scrypt key derivation
- encryptAES(key, plaintext)    // AES-256-GCM encryption
- decryptAES(key, ciphertext)   // AES-256-GCM decryption
- constantTimeEqual(a, b)       // Timing-safe comparison

// 2. Encrypted Store (store.ts)
- EncryptedSqliteStore          // Encrypted database wrapper
- SignalSqliteStore             // Signal Protocol adapter

// 3. High-Level API (index.ts)
- createIdentity(registrationId)
- createSession(theirBundle)
- encryptMessage(session, plaintext)
- decryptMessage(session, ciphertext)
```

### 3. Relay Server

**Purpose:** Message routing without content access

**API Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/register` | POST | Register user with prekeys |
| `/prekey-bundle/:clientId` | GET | Retrieve user's public keys |
| `/messages/:clientId` | GET | Poll for encrypted messages |
| `/messages/:clientId` | DELETE | Clear message queue |
| `/send` | POST | Send encrypted message |

**WebSocket Events:**

- `subscribe`: Listen for real-time message delivery
- `message`: Receive incoming encrypted envelope

### 4. SysMaint Agent

**Architecture:**

```
┌─────────────────────────────────────────┐
│         SysMaint Agent                  │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   Signal Protocol Client        │   │
│  │   - Identity management         │   │
│  │   - Session handling            │   │
│  │   - Encrypt/decrypt             │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   LangChain Agent               │   │
│  │   - Prompt processing           │   │
│  │   - Tool selection              │   │
│  │   - Response generation         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   Tools                         │   │
│  │   - fetchTelemetry()            │   │
│  │   - getStatus()                 │   │
│  │   - executeCommand()            │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   OpenAI Integration            │   │
│  │   - GPT-4/3.5-turbo            │   │
│  │   - Token tracking              │   │
│  │   - Cost estimation             │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

**Message Processing Flow:**

1. Poll relay for encrypted messages
2. Decrypt using Signal Protocol
3. Parse message envelope
4. Route to appropriate handler (chat, telemetry, control)
5. Process with LangChain agent
6. Generate response with OpenAI
7. Encrypt response
8. Send back via relay

### 5. Diag Probe

**Purpose:** Collect system metrics and transmit via E2EE

**Metrics Collected:**

- **CPU**: Usage percentage, load averages
- **Memory**: Used/total, swap usage
- **Disk**: Usage by filesystem
- **Network**: RX/TX bytes and packets
- **Processes**: Top processes by CPU/memory
- **Relay Stats**: Queue depth, active connections

**Collection Cycle:**

```javascript
// Every 30 seconds:
1. Collect system metrics
2. Save to local SQLite
3. Encrypt payload with Signal Protocol
4. Send to web dashboard via relay
5. Wait for acknowledgment
```

---

## Deployment Architecture

### Docker Compose Setup

```yaml
version: '3.8'

services:
  relay:
    build: ./packages/relay-server
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      
  web:
    build: ./apps/sysmaint-web
    ports:
      - "3000:3000"
    environment:
      - RELAY_URL=http://relay:8080
      - DATABASE_URL=/data/state.db
    volumes:
      - ./data:/data
      
  agent:
    build: ./apps/sysmaint-agent
    environment:
      - RELAY_URL=http://relay:8080
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      
  probe:
    build: ./apps/diag-probe
    environment:
      - RELAY_URL=http://relay:8080
      - INTERVAL=30000
```

### Network Topology

```
┌─────────────────────────────────────────────────────────────┐
│                      HOST NETWORK                           │
│                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│   │   User   │    │   User   │    │  SysMaint │            │
│   │ Browser  │    │ Browser  │    │   Agent   │            │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘            │
│        │               │               │                   │
└────────┼───────────────┼───────────────┼───────────────────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
              ┌──────────┴──────────┐
              │    Docker Network   │
              │                     │
              │  ┌───────────────┐  │
              │  │  Relay Server │  │  Port 8080
              │  └───────────────┘  │
              │                     │
              │  ┌───────────────┐  │
              │  │   Web Server  │  │  Port 3000
              │  └───────────────┘  │
              │                     │
              │  ┌───────────────┐  │
              │  │  Diag Probe   │  │
              │  └───────────────┘  │
              └─────────────────────┘
```

### Data Persistence

| Service | Storage | Path | Persistence |
|---------|---------|------|-------------|
| Web | SQLite | `/data/state.db` | Docker volume |
| Diag Probe | SQLite | `/data/probe.db` | Docker volume |
| Relay | In-Memory | N/A | Ephemeral (messages) |

---

## Key Design Decisions

### 1. Server-Side vs Client-Side Encryption

**Decision:** Server-side Signal operations for web demo

**Rationale:**
- ✅ Simplifies browser compatibility
- ✅ Easier to implement and debug
- ✅ Educational clarity
- ⚠️ Trade-off: Web server has temporary plaintext access

**Production Alternative:** Client-side encryption with WebAssembly Signal library

### 2. SQLite vs External Database

**Decision:** SQLite for local storage

**Rationale:**
- ✅ Zero external dependencies
- ✅ Simple deployment
- ✅ Sufficient for demo scale
- ✅ ACID transactions
- ⚠️ Single-node limitation (acceptable for demo)

### 3. Polling vs WebSocket for Dashboard

**Decision:** HTTP polling every 5 seconds for dashboard

**Rationale:**
- ✅ Simpler implementation
- ✅ Works through proxies/firewalls
- ✅ Easier to cache and scale
- ✅ Sufficient for monitoring use case
- ⚠️ Higher latency than WebSocket (acceptable for 5s refresh)

### 4. Signal Protocol Library Choice

**Decision:** Official @signalapp/libsignal-client

**Rationale:**
- ✅ Official implementation
- ✅ Production-tested cryptography
- ✅ Post-quantum support (Kyber)
- ✅ Active maintenance
- ⚠️ Native dependencies (require Node.js runtime)

### 5. LangChain vs Direct OpenAI

**Decision:** LangChain for AI agent

**Rationale:**
- ✅ Structured tool use
- ✅ Memory and context management
- ✅ Prompt templates
- ✅ Observability hooks
- ✅ Easy to extend with more tools

### 6. Monorepo Structure

**Decision:** Turborepo with shared packages

**Rationale:**
- ✅ Code sharing between apps
- ✅ Consistent tooling
- ✅ Atomic changes across packages
- ✅ Shared TypeScript types
- ✅ Simplified dependency management

---

## Performance Characteristics

### Latency Benchmarks

| Operation | Typical | Notes |
|-----------|---------|-------|
| Dashboard refresh | ~50ms | SQLite query + JSON serialization |
| Signal encryption | ~5-10ms | AES-256-GCM + ratchet advance |
| Session establishment | ~50-100ms | X3DH key agreement (one-time) |
| AI response (GPT-4) | 2-5s | Depends on prompt complexity |
| Message delivery | <100ms | HTTP round-trip to relay |

### Scalability Considerations

**Current Limits (Demo Scale):**

- Relay: ~1,000 concurrent WebSocket connections
- Database: ~10,000 snapshots per table (SQLite)
- AI Agent: Rate-limited by OpenAI API

**Production Scaling:**

- Replace SQLite with PostgreSQL
- Add Redis for message queue
- Horizontal scaling of relay servers
- Load balancer with sticky sessions
- Separate AI worker pool

---

## Security Checklist

### Pre-Deployment

- [ ] Change all default passwords
- [ ] Enable HTTPS (TLS 1.3)
 [ ] Configure CORS properly
- [ ] Set up authentication (JWT or session-based)
- [ ] Enable rate limiting
- [ ] Configure logging and monitoring
- [ ] Set up backup strategy for databases
- [ ] Review OpenAI API key permissions
- [ ] Disable debug mode in production
- [ ] Run security audit on dependencies

### Runtime Security

- [ ] Regular key rotation
- [ ] Monitor for unusual traffic patterns
- [ ] Set up alerts for errors
- [ ] Log all authentication attempts
- [ ] Encrypt data at rest (database files)
- [ ] Use secrets manager for API keys
- [ ] Regular security updates

---

## Development Guide

### Adding a New Tool to SysMaint Agent

```typescript
// 1. Define tool in apps/sysmaint-agent/src/index.ts
const myTool = new DynamicStructuredTool({
  name: "my_new_tool",
  description: "Description of what this tool does",
  schema: z.object({
    param1: z.string().describe("Parameter description"),
    param2: z.number().describe("Another parameter")
  }),
  func: async ({ param1, param2 }) => {
    // Implementation
    return "Tool result";
  }
});

// 2. Add to tools array
const tools = [/* existing tools */, myTool];
```

### Adding a New API Endpoint

```typescript
// 1. Create route file: app/api/my-endpoint/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // Implementation
  return NextResponse.json({ ok: true, data: {} });
}
```

### Adding a New Page

```typescript
// 1. Create page file: app/my-page/page.tsx
"use client";

export default function MyPage() {
  return (
    <section>
      <h1>My Page</h1>
      {/* Content */}
    </section>
  );
}

// 2. Add to navigation in app/layout.tsx
<nav>
  <a href="/">Dashboard</a>
  <a href="/chat">Alice Chat</a>
  <a href="/demo">Demo</a>
  <a href="/my-page">My Page</a>  {/* New link */}
</nav>
```

---

## Troubleshooting

### Common Issues

**Issue:** "Cannot find module '@signalapp/libsignal-client'"
- **Solution:** Run `npm install` in the package directory. Native module requires compilation.

**Issue:** Relay server not receiving messages
- **Solution:** Check RELAY_URL environment variable. Ensure relay is running on correct port.

**Issue:** AI agent not responding
- **Solution:** Verify OPENAI_API_KEY is set. Check rate limits on OpenAI dashboard.

**Issue:** Database "table not found" errors
- **Solution:** Run `npm run db:init` to create tables. Check DATABASE_URL path.

**Issue:** WebSocket connection fails
- **Solution:** Check firewall rules. Ensure WebSocket port is open.

---

## Glossary

| Term | Definition |
|------|------------|
| **E2EE** | End-to-End Encryption - Only sender and recipient can read content |
| **X3DH** | Extended Triple Diffie-Hellman - Key agreement protocol |
| **Double Ratchet** | Algorithm providing forward secrecy and future secrecy |
| **Prekey** | One-time public key for establishing sessions without real-time coordination |
| **Kyber** | CRYSTALS-Kyber - Post-quantum key encapsulation mechanism |
| **Relay** | Server that routes encrypted messages without accessing content |
| **Session** | Established encryption context between two users |
| **Ratchet** | Cryptographic mechanism that advances keys with each message |
| **Forward Secrecy** | Past messages remain secure even if current keys are compromised |
| **Envelope** | Encrypted message container with metadata |

---

## References

- [Signal Protocol Specification](https://signal.org/docs/)
- [libsignal-client Documentation](https://github.com/signalapp/libsignal-client)
- [Next.js Documentation](https://nextjs.org/docs)
- [LangChain Documentation](https://js.langchain.com/)
- [Turborepo Documentation](https://turbo.build/repo/docs)

---

## License

This project is for educational purposes. Signal Protocol is © Signal Messenger, LLC.

---

*Last Updated: February 2026*
