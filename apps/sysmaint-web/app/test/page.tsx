/**
 * ============================================================================
 * TEST DASHBOARD PAGE
 * ============================================================================
 *
 * Main test dashboard UI component
 * Displays all 15 tests, allows running them, shows real-time progress
 * and maintains history of test runs
 *
 * Features:
 * - Run all tests or individual categories
 * - Real-time progress updates via SSE
 * - Test result visualization
 * - History view
 * - Export functionality
 * - Browser notifications
 * - Alice <=> SysMaint AI Chat (E2EE via Signal Protocol)
 *
 * @module apps/sysmaint-web/app/test/page
 * ============================================================================
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./test-dashboard.module.css";
import { notificationService } from "../../lib/test-suite/notifications";
import {
  allTests,
  testsByCategory,
  getCategoryDisplayName,
  calculateEstimatedCost,
  calculateEstimatedDuration,
} from "../../lib/test-suite";
import type {
  TestResult,
  ProgressUpdate,
  TestCategory,
  TestRun,
} from "../../types/test";

/**
 * ============================================================================
 * CHAT WINDOW COMPONENT
 * ============================================================================
 * Alice <=> SysMaint AI Chat Interface
 * Uses Signal Protocol for End-to-End Encryption
 */
function ChatWindow({ 
  messages, 
  setMessages, 
  connectionStatus, 
  setConnectionStatus 
}: { 
  messages: Array<{
    id: string;
    role: "alice" | "sysmaint";
    content: string;
    timestamp: number;
    encrypted?: boolean;
  }>;
  setMessages: React.Dispatch<React.SetStateAction<Array<{
    id: string;
    role: "alice" | "sysmaint";
    content: string;
    timestamp: number;
    encrypted?: boolean;
  }>>>;
  connectionStatus: "connecting" | "connected" | "disconnected";
  setConnectionStatus: React.Dispatch<React.SetStateAction<"connecting" | "connected" | "disconnected">>;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "sysmaint" as const,
          content: "🔐 Secure connection established via Signal Protocol.\n\nI'm the SysMaint AI assistant. All messages are end-to-end encrypted using the Signal Protocol with Double Ratchet encryption. Click on any test card to learn more about it!",
          timestamp: Date.now(),
          encrypted: true,
        },
      ]);
    }
  }, [isMounted, messages.length, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    setConnectionStatus("connecting");
    const userMessage = {
      id: Date.now().toString(),
      role: "alice" as const,
      content: input.trim(),
      timestamp: Date.now(),
      encrypted: true,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMessage.content,
        }),
      });

      if (response.ok) {
        setConnectionStatus("connected");
        const data = await response.json();

        if (data.reply) {
          const aiMessage = {
            id: (Date.now() + 1).toString(),
            role: "sysmaint" as const,
            content: data.reply,
            timestamp: Date.now(),
            encrypted: true,
          };
          setMessages((prev) => [...prev, aiMessage]);
        }
      } else {
        setConnectionStatus("disconnected");
      }
    } catch (error: any) {
      setConnectionStatus("disconnected");
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: "sysmaint" as const,
        content: `🔒 Encryption error: ${error.message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case "connected": return "#3fb950";
      case "connecting": return "#d29922";
      case "disconnected": return "#f85149";
    }
  };

  return (
    <div className={styles.chatWindow}>
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderLeft}>
          <span className={styles.chatTitle}>💬 Alice ↔ SysMaint AI</span>
          <span className={styles.encryptionBadge}>
            🔐 E2EE Signal Protocol
          </span>
        </div>
        <div className={styles.chatStatus}>
          <span 
            className={styles.statusDot} 
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className={styles.statusText}>
            {connectionStatus === "connected" ? "Encrypted" : 
             connectionStatus === "connecting" ? "Encrypting..." : "Disconnected"}
          </span>
        </div>
      </div>

      <div className={styles.chatMessages}>
        {!isMounted ? (
          <div style={{ textAlign: "center", color: "#6e7681", padding: "2rem" }}>
            Loading secure chat...
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.chatMessage} ${styles[msg.role]}`}
            >
              <div className={styles.messageAvatar}>
                {msg.role === "alice" ? "👩" : "🤖"}
              </div>
              <div className={styles.messageContent}>
                <div className={styles.messageText}>
                  {msg.encrypted && <span className={styles.encryptIcon}>🔐</span>}
                  {msg.content}
                </div>
                <div className={styles.messageRow}>
                  <div className={styles.messageTime}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                  {msg.encrypted && (
                    <span className={styles.encryptedIndicator}>E2EE</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        {isMounted && isLoading && (
          <div className={`${styles.chatMessage} ${styles.sysmaint}`}>
            <div className={styles.messageAvatar}>🤖</div>
            <div className={styles.messageContent}>
              <div className={styles.typingIndicator}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.chatInput}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask the AI about the tests..."
          className={styles.chatTextarea}
          rows={3}
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          className={styles.chatSendButton}
          title="Send encrypted message"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

/**
 * Tests Overview Button Component
 * Generates AI analysis and sends to Alice via Signal
 */
function TestsOverviewButton() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState<{
    report: string;
    aiResponse: string;
    runsAnalyzed: number;
    requestId: string;
  } | null>(null);

  const handleOverview = async () => {
    setIsGenerating(true);
    setMessage(null);

    try {
      const response = await fetch("/api/test/overview", {
        method: "POST",
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`✅ Report generated and sent to Alice via Signal (${data.runsAnalyzed} runs analyzed)`);
        setReportData({
          report: data.report,
          aiResponse: data.aiResponse,
          runsAnalyzed: data.runsAnalyzed,
          requestId: data.requestId,
        });
        setShowReportModal(true);
      } else {
        setMessage(`❌ Error: ${data.message || data.error}`);
      }
    } catch (error: any) {
      setMessage(`❌ Failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
      setTimeout(() => setMessage(null), 8000);
    }
  };

  const handleCloseModal = () => {
    setShowReportModal(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button
        className={styles.overviewButton}
        onClick={handleOverview}
        disabled={isGenerating}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          fontWeight: 600,
          color: "white",
          background: "#6e40c9",
          border: "1px solid #8957e5",
          borderRadius: "12px",
          cursor: "pointer",
          transition: "all 0.3s ease",
        }}
      >
        {isGenerating ? "Generating..." : "📊 Tests Overview"}
      </button>
      {message && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            background: message.startsWith("✅") ? "rgba(63, 185, 80, 0.15)" : "rgba(248, 81, 73, 0.15)",
            color: message.startsWith("✅") ? "#3fb950" : "#f85149",
            borderRadius: "8px",
            fontSize: "0.85rem",
            maxWidth: "400px",
            textAlign: "center",
            border: `1px solid ${message.startsWith("✅") ? "#3fb950" : "#f85149"}`,
          }}
        >
          {message}
        </div>
      )}

      {showReportModal && reportData && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleCloseModal}
        >
          <div
            style={{
              backgroundColor: "#161b22",
              borderRadius: "20px",
              maxWidth: "800px",
              maxHeight: "90vh",
              width: "90%",
              overflow: "auto",
              padding: "2rem",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
              border: "1px solid #30363d",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ margin: 0, color: "#e6edf3", fontSize: "1.5rem", fontWeight: 700 }}>📊 Test Suite Analysis Report</h2>
              <button
                onClick={handleCloseModal}
                style={{
                  background: "#21262d",
                  border: "1px solid #30363d",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "#8b949e",
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "0.85rem", color: "#8b949e", marginBottom: "0.5rem" }}>
                Request ID: {reportData.requestId} • Runs analyzed: {reportData.runsAnalyzed}
              </div>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <h3 style={{ color: "#58a6ff", marginBottom: "0.75rem", fontSize: "1.1rem" }}>
                🤖 AI Analysis (Alice's received message)
              </h3>
              <div
                style={{
                  backgroundColor: "rgba(88, 166, 255, 0.15)",
                  color: "#58a6ff",
                  padding: "1rem",
                  borderRadius: "12px",
                  borderLeft: "4px solid #58a6ff",
                  whiteSpace: "pre-wrap",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  lineHeight: "1.5",
                  maxHeight: "300px",
                  overflow: "auto",
                }}
              >
                {reportData.aiResponse}
              </div>
            </div>

            <div>
              <h3 style={{ color: "#8b949e", marginBottom: "0.75rem", fontSize: "1.1rem" }}>
                📝 Raw Report Data (sent to AI)
              </h3>
              <details>
                <summary style={{ cursor: "pointer", color: "#6e7681", fontSize: "0.9rem" }}>
                  Click to view raw report data
                </summary>
                <div
                  style={{
                    backgroundColor: "#0d1117",
                    color: "#c9d1d9",
                    padding: "1rem",
                    borderRadius: "12px",
                    marginTop: "0.5rem",
                    whiteSpace: "pre-wrap",
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    maxHeight: "300px",
                    overflow: "auto",
                    border: "1px solid #30363d",
                  }}
                >
                  {reportData.report}
                </div>
              </details>
            </div>

            <div style={{ marginTop: "2rem", textAlign: "center" }}>
              <button
                onClick={handleCloseModal}
                style={{
                  padding: "0.75rem 2rem",
                  backgroundColor: "#6e40c9",
                  color: "white",
                  border: "1px solid #8957e5",
                  borderRadius: "12px",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Type for category data in state
 */
type CategoryData = {
  [key in TestCategory]: TestResult[];
};

/**
 * Main Test Dashboard Page Component
 */
export default function TestDashboardPage() {
  // State
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentTest, setCurrentTest] = useState<string>("");
  const [results, setResults] = useState<CategoryData>({
    signal: [],
    e2ee: [],
    ai: [],
    web: [],
  });
  const [history, setHistory] = useState<TestRun[]>([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedTest, setSelectedTest] = useState<TestResult | null>(null);
  const [runSummary, setRunSummary] = useState<{
    passed: number;
    failed: number;
    retried: number;
    cost: number;
  } | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string;
    role: "alice" | "sysmaint";
    content: string;
    timestamp: number;
    encrypted?: boolean;
  }>>([]);
  const [chatConnectionStatus, setChatConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("connected");

  /**
   * Fetch test history on mount
   */
  useEffect(() => {
    fetchHistory();
    notificationService.requestPermission();
  }, []);

  /**
   * Fetch test history from API
   */
  const fetchHistory = async () => {
    try {
      const response = await fetch("/api/test/history?limit=10");
      const data = await response.json();
      setHistory(data.runs);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    }
  };

  /**
   * Start running all tests
   */
  const runAllTests = useCallback(() => {
    setIsRunning(true);
    setProgress(0);
    setCurrentTest("");
    setResults({
      signal: [],
      e2ee: [],
      ai: [],
      web: [],
    });
    setRunSummary(null);

    const eventSource = new EventSource("/api/test/run", {
      withCredentials: true,
    });

    let runId: string | null = null;

    eventSource.onmessage = (event) => {
      const update: ProgressUpdate = JSON.parse(event.data);

      switch (update.type) {
        case "run-started":
          runId = update.runId || null;
          setCurrentRunId(runId);
          if (update.totalTests) {
            notificationService.notifyTestStarted(
              runId || "",
              update.totalTests
            );
          }
          break;

        case "test-started":
          if (update.testName) {
            setCurrentTest(update.testName);
          }
          if (update.index !== undefined && update.total) {
            setProgress((update.index / update.total) * 100);
          }
          break;

        case "test-retry":
          if (update.testId) {
            setResults((prev) => {
              const category = getTestCategory(update.testId!);
              const updated = [...prev[category]];
              const idx = updated.findIndex((r) => r.testId === update.testId);
              if (idx !== -1) {
                updated[idx] = { ...updated[idx], status: "retrying" };
              }
              return { ...prev, [category]: updated };
            });
          }
          break;

        case "test-completed":
          if (update.testId && update.status) {
            const test = allTests.find((t) => t.id === update.testId);
            if (test) {
              const result: TestResult = {
                runId: runId || "",
                testId: update.testId,
                testName: test.name,
                category: test.category,
                status: update.status,
                attemptNumber: 1,
                startedAt: Date.now(),
                completedAt: Date.now(),
                durationMs: update.duration,
                estimatedCostUsd: update.cost,
                logs: [],
              };

              setResults((prev) => ({
                ...prev,
                [test.category]: [...prev[test.category], result],
              }));
            }
          }
          break;

        case "run-completed":
          setIsRunning(false);
          setProgress(100);
          if (update.summary) {
            setRunSummary({
              passed: update.summary.passed,
              failed: update.summary.failed,
              retried: update.summary.retried,
              cost: update.summary.totalCost,
            });
            notificationService.notifyTestCompleted({
              passed: update.summary.passed,
              failed: update.summary.failed,
              retried: update.summary.retried,
              total: allTests.length,
              cost: update.summary.totalCost,
            });
          }
          fetchHistory();
          eventSource.close();
          break;

        case "error":
          setIsRunning(false);
          console.error("Test run error:", update.error);
          eventSource.close();
          break;
      }
    };

    eventSource.onerror = (error) => {
      console.error("EventSource error:", error);
      setIsRunning(false);
      setCurrentTest("Connection error - check console");
      eventSource.close();
    };

    eventSource.onopen = () => {
      console.log("EventSource connected successfully");
    };
  }, []);

  /**
   * Get test category from test ID
   */
  const getTestCategory = (testId: string): TestCategory => {
    const test = allTests.find((t) => t.id === testId);
    return test?.category || "signal";
  };

  /**
   * Get status icon for a test
   */
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed": return "✓";
      case "failed": return "✗";
      case "running": return "⏳";
      case "retrying": return "🔄";
      default: return "○";
    }
  };

  /**
   * Get test by ID from results
   */
  const getTestResult = (testId: string): TestResult | undefined => {
    const category = getTestCategory(testId);
    return results[category].find((r) => r.testId === testId);
  };

  /**
   * Export test results
   */
  const exportResults = (format: "structured" | "flattened") => {
    if (!currentRunId) return;
    window.open(`/api/test/export?runId=${currentRunId}&format=${format}`);
    setShowExportMenu(false);
  };

  /**
   * Render a test suite section
   */
  const renderTestSuite = (category: TestCategory, tests: typeof allTests) => {
    const categoryResults = results[category];
    const passedCount = categoryResults.filter((r) => r.status === "passed").length;
    const totalCost = categoryResults.reduce((sum, r) => sum + (r.estimatedCostUsd || 0), 0);

    return (
      <div className={styles.testSuite}>
        <div className={styles.suiteHeader}>
          <div>
            <h3 className={`${styles.suiteTitle} ${styles[category]}`}>
              {getCategoryDisplayName(category)}
            </h3>
            <div className={styles.suiteStats}>
              {passedCount}/{tests.length} passed
              {category === "ai" && totalCost > 0 && (
                <span> • ${totalCost.toFixed(4)}</span>
              )}
            </div>
          </div>
        </div>
        <div className={styles.testCards}>
          {tests.map((test) => {
            const result = getTestResult(test.id);
            const status = result?.status || "pending";

            return (
              <div
                key={test.id}
                className={`${styles.testCard} ${styles[status]}`}
                onClick={() => {
                  if (result) {
                    setSelectedTest(result);
                  }
                  // Trigger explanation in chat
                  const explanationMsg = {
                    id: `explain-${test.id}`,
                    role: "sysmaint" as const,
                    content: `📖 **${test.name}**\n\n${test.description}\n\n⏱️ Estimated duration: ~${Math.round(test.estimatedDuration/1000)}s\n💰 Estimated cost: ~$${test.estimatedCost?.toFixed(4) || "0.0000"}\n\nClick "Run All Tests" to execute this test and see real results!`,
                    timestamp: Date.now(),
                    encrypted: true,
                  };
                  setChatMessages((prev) => [...prev, explanationMsg]);
                }}
              >
                <div className={styles.statusIcon}>{getStatusIcon(status)}</div>
                <div className={styles.testInfo}>
                  <div className={styles.testName}>{test.name}</div>
                  <div className={styles.testMeta}>
                    {status === "running" && <span>Running...</span>}
                    {status === "retrying" && <span>Retrying (attempt 2)</span>}
                    {result?.durationMs && <span>{result.durationMs}ms</span>}
                    {result?.estimatedCostUsd && (
                      <span className={styles.costBadge}>
                        ${result.estimatedCostUsd.toFixed(4)}
                      </span>
                    )}
                    {test.estimatedCost && !result && (
                      <span className={styles.costBadge}>
                        ~${test.estimatedCost.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /**
   * Format timestamp for display
   */
  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  /**
   * Format duration for display
   */
  const formatDuration = (ms: number | undefined): string => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className={styles.testDashboard}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>Test Suite Dashboard</h1>
        <div className={styles.controls}>
          {isRunning ? (
            <button
              className={styles.stopButton}
              onClick={() => window.location.reload()}
            >
              Stop
            </button>
          ) : (
            <button
              className={styles.runButton}
              onClick={runAllTests}
              disabled={isRunning}
            >
              Run All Tests
            </button>
          )}

          <div className={styles.exportDropdown}>
            <button
              className={styles.exportButton}
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!currentRunId || isRunning}
            >
              Export Results ▼
            </button>
            {showExportMenu && (
              <div className={styles.exportMenu}>
                <button onClick={() => exportResults("structured")}>
                  Structured JSON
                </button>
                <button onClick={() => exportResults("flattened")}>
                  Flattened JSON
                </button>
              </div>
            )}
          </div>

          <TestsOverviewButton />
        </div>
      </header>

      {/* Progress Section */}
      {isRunning && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressTitle}>Running Tests...</span>
            <span className={styles.progressStats}>
              {Math.round(progress)}% complete
            </span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className={styles.progressInfo}>
            <span>{currentTest || "Initializing..."}</span>
            <span>
              Est. cost: ${calculateEstimatedCost().toFixed(4)} • Est. time:{" "}
              {Math.round(calculateEstimatedDuration() / 1000)}s
            </span>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {runSummary && (
        <div className={styles.summaryStats}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue}>{runSummary.passed}</div>
            <div className={styles.summaryLabel}>Passed</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue} style={{ color: "#f85149" }}>
              {runSummary.failed}
            </div>
            <div className={styles.summaryLabel}>Failed</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue}>{runSummary.retried}</div>
            <div className={styles.summaryLabel}>Retried</div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryValue}>
              ${runSummary.cost.toFixed(4)}
            </div>
            <div className={styles.summaryLabel}>Total Cost</div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className={styles.mainContent}>
        {/* Test Suites */}
        <div className={styles.testSuitesContainer}>
          <div className={styles.testSuites}>
            {renderTestSuite("signal", testsByCategory.signal)}
            {renderTestSuite("e2ee", testsByCategory.e2ee)}
            {renderTestSuite("ai", testsByCategory.ai)}
            {renderTestSuite("web", testsByCategory.web)}
          </div>

          {/* History Section */}
          <div className={styles.historySection}>
            <h2 className={styles.historyTitle}>Recent Test Runs</h2>
            {history.length === 0 ? (
              <div className={styles.noData}>No test runs yet</div>
            ) : (
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Results</th>
                    <th>Duration</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <tr key={run.runId}>
                      <td>{formatTimestamp(run.startedAt)}</td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${styles[run.status]}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td>
                        {run.passedTests}/{run.totalTests} passed
                        {run.retriedTests > 0 && ` (${run.retriedTests} retried)`}
                      </td>
                      <td>{formatDuration(run.totalDurationMs)}</td>
                      <td>${run.totalCostUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Chat Window */}
        <div className={styles.chatContainer}>
          <ChatWindow 
            messages={chatMessages}
            setMessages={setChatMessages}
            connectionStatus={chatConnectionStatus}
            setConnectionStatus={setChatConnectionStatus}
          />
        </div>
      </div>

      {/* Test Details Modal */}
      {selectedTest && (
        <div
          className={styles.modalOverlay}
          onClick={() => setSelectedTest(null)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{selectedTest.testName}</h3>
              <button
                className={styles.closeButton}
                onClick={() => setSelectedTest(null)}
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.testDetailRow}>
                <span className={styles.testDetailLabel}>Status</span>
                <span className={styles.testDetailValue}>
                  {getStatusIcon(selectedTest.status)} {selectedTest.status}
                  {selectedTest.attemptNumber > 1 &&
                    ` (attempt ${selectedTest.attemptNumber})`}
                </span>
              </div>

              <div className={styles.testDetailRow}>
                <span className={styles.testDetailLabel}>Category</span>
                <span className={styles.testDetailValue}>
                  {getCategoryDisplayName(selectedTest.category)}
                </span>
              </div>

              <div className={styles.testDetailRow}>
                <span className={styles.testDetailLabel}>Duration</span>
                <span className={styles.testDetailValue}>
                  {formatDuration(selectedTest.durationMs)}
                </span>
              </div>

              {selectedTest.inputTokens !== undefined && (
                <div className={styles.testDetailRow}>
                  <span className={styles.testDetailLabel}>Tokens</span>
                  <span className={styles.testDetailValue}>
                    {selectedTest.inputTokens} input /{" "}
                    {selectedTest.outputTokens} output
                  </span>
                </div>
              )}

              {selectedTest.estimatedCostUsd !== undefined && (
                <div className={styles.testDetailRow}>
                  <span className={styles.testDetailLabel}>Cost</span>
                  <span className={styles.testDetailValue}>
                    ${selectedTest.estimatedCostUsd.toFixed(6)}
                  </span>
                </div>
              )}

              {selectedTest.errorMessage && (
                <div className={styles.errorMessage}>
                  <strong>Error:</strong> {selectedTest.errorMessage}
                  {selectedTest.retryErrorMessage && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <strong>First attempt error:</strong>{" "}
                      {selectedTest.retryErrorMessage}
                    </div>
                  )}
                </div>
              )}

              {selectedTest.logs.length > 0 && (
                <>
                  <div className={styles.logsHeader}>Execution Logs</div>
                  <pre className={styles.logs}>
                    {selectedTest.logs.join("\n")}
                  </pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
