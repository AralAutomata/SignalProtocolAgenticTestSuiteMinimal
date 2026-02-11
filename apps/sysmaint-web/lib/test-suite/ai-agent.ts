/**
 * ============================================================================
 * AI AGENT TESTS
 * ============================================================================
 *
 * Tests 9-13: AI Agent capabilities with real OpenAI API
 * Uses LangChain with gpt-4o-mini model
 * Tests tool selection, context awareness, and multi-tool orchestration
 *
 * Tests:
 * 9. AI Tool Selection
 * 10. Historical Data Query
 * 11. Anomaly Detection Query
 * 12. Conversation Context
 * 13. Multi-Tool Reasoning
 *
 * @module apps/sysmaint-web/lib/test-suite/ai-agent
 * ============================================================================
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { TestDefinition } from "../../types/test";

/**
 * OpenAI API key from environment
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = "gpt-4o-mini";

/**
 * Mock tools for testing AI tool calling
 */
const mockTools = [
  new DynamicStructuredTool({
    name: "get_current_status",
    description: "Get the current system status including CPU, memory, and disk usage",
    schema: z.object({}),
    func: async () =>
      JSON.stringify({ cpu: 45, memory: 60, disk: 75, timestamp: Date.now() }),
  }),
  new DynamicStructuredTool({
    name: "get_recent_status_history",
    description:
      "Get historical system metrics for a time period in minutes. Use this for trends and analysis.",
    schema: z.object({ minutes: z.number().describe("Number of minutes to look back") }),
    func: async ({ minutes }) =>
      JSON.stringify({
        period: `${minutes} minutes`,
        dataPoints: Math.floor(minutes / 5),
        averageCpu: 42,
      }),
  }),
  new DynamicStructuredTool({
    name: "get_anomaly_summary",
    description: "Get a summary of any detected anomalies or issues in the system",
    schema: z.object({}),
    func: async () =>
      JSON.stringify({
        anomalies: [],
        lastCheck: Date.now(),
        status: "healthy",
      }),
  }),
];

/**
 * System prompt for the AI agent
 */
const systemPrompt = `You are a system maintenance AI assistant. You help users understand their system status and diagnose issues.

When asked about system status or metrics, use the available tools to fetch real data.
Be concise and direct in your responses.

Available tools:
- get_current_status: Get current system metrics (CPU, memory, disk)
- get_recent_status_history: Get historical data for trend analysis
- get_anomaly_summary: Check for system issues and anomalies`;

/**
 * Calculate API cost based on token usage
 * gpt-4o-mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output tokens
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 0.15;
  const outputCost = (outputTokens / 1_000_000) * 0.6;
  return inputCost + outputCost;
}

export const aiTests: TestDefinition[] = [
  // Test 9: Tool Selection
  {
    id: "ai-tool-selection",
    name: "AI Tool Selection",
    category: "ai",
    description: "Verify AI selects correct tool for status queries",
    estimatedDuration: 1200,
    estimatedCost: 0.0003,
    fn: async (context) => {
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      context.log("Initializing ChatOpenAI with gpt-4o-mini");
      const model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL_NAME,
        temperature: 0.1,
      }).bindTools(mockTools);

      context.log("Sending query: 'What's the current status?'");
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage("What's the current status?"),
      ]);

      context.log("Response received");
      context.log(`Tool calls: ${JSON.stringify(response.tool_calls)}`);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        throw new Error("No tool calls made");
      }

      const toolCall = response.tool_calls[0];
      context.log(`Tool selected: ${toolCall.name}`);

      if (toolCall.name !== "get_current_status") {
        throw new Error(
          `Expected 'get_current_status', got '${toolCall.name}'`
        );
      }

      const tokens = {
        input: response.usage_metadata?.input_tokens || 0,
        output: response.usage_metadata?.output_tokens || 0,
      };

      const cost = calculateCost(tokens.input, tokens.output);
      context.log(`Tokens - Input: ${tokens.input}, Output: ${tokens.output}`);
      context.log(`Estimated cost: $${cost.toFixed(6)}`);
      context.log("✅ Correct tool selected");

      return {
        selectedTool: toolCall.name,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        estimatedCostUsd: cost,
      };
    },
  },

  // Test 10: Historical Analysis
  {
    id: "ai-history",
    name: "Historical Data Query",
    category: "ai",
    description: "Verify AI queries historical data with correct parameters",
    estimatedDuration: 1500,
    estimatedCost: 0.0004,
    fn: async (context) => {
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      context.log("Initializing ChatOpenAI");
      const model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL_NAME,
        temperature: 0.1,
      }).bindTools(mockTools);

      context.log("Sending query: 'Show me CPU trends from the last hour'");
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage("Show me CPU trends from the last hour"),
      ]);

      context.log(`Tool calls: ${JSON.stringify(response.tool_calls)}`);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        throw new Error("No tool calls made");
      }

      const toolCall = response.tool_calls[0];
      context.log(
        `Tool: ${toolCall.name}, Args: ${JSON.stringify(toolCall.args)}`
      );

      if (toolCall.name !== "get_recent_status_history") {
        throw new Error(
          `Expected 'get_recent_status_history', got '${toolCall.name}'`
        );
      }

      if (toolCall.args.minutes !== 60) {
        throw new Error(
          `Expected minutes=60, got ${toolCall.args.minutes}`
        );
      }

      const tokens = {
        input: response.usage_metadata?.input_tokens || 0,
        output: response.usage_metadata?.output_tokens || 0,
      };

      const cost = calculateCost(tokens.input, tokens.output);
      context.log("✅ Historical query handled correctly");

      return {
        selectedTool: toolCall.name,
        parameters: toolCall.args,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        estimatedCostUsd: cost,
      };
    },
  },

  // Test 11: Anomaly Detection
  {
    id: "ai-anomaly",
    name: "Anomaly Detection Query",
    category: "ai",
    description: "Verify AI checks for problems when asked",
    estimatedDuration: 900,
    estimatedCost: 0.0002,
    fn: async (context) => {
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      context.log("Initializing ChatOpenAI");
      const model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL_NAME,
        temperature: 0.1,
      }).bindTools(mockTools);

      context.log("Sending query: 'Are there any problems?'");
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage("Are there any problems?"),
      ]);

      context.log(`Tool calls: ${JSON.stringify(response.tool_calls)}`);

      if (!response.tool_calls || response.tool_calls.length === 0) {
        throw new Error("No tool calls made");
      }

      const toolCall = response.tool_calls[0];
      context.log(`Tool selected: ${toolCall.name}`);

      if (toolCall.name !== "get_anomaly_summary") {
        throw new Error(
          `Expected 'get_anomaly_summary', got '${toolCall.name}'`
        );
      }

      const tokens = {
        input: response.usage_metadata?.input_tokens || 0,
        output: response.usage_metadata?.output_tokens || 0,
      };

      const cost = calculateCost(tokens.input, tokens.output);
      context.log("✅ Anomaly detection query handled correctly");

      return {
        selectedTool: toolCall.name,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        estimatedCostUsd: cost,
      };
    },
  },

  // Test 12: Context Awareness
  {
    id: "ai-context",
    name: "Conversation Context",
    category: "ai",
    description: "Verify AI maintains context across messages",
    estimatedDuration: 1100,
    estimatedCost: 0.0003,
    fn: async (context) => {
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      context.log("Initializing ChatOpenAI");
      const model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL_NAME,
        temperature: 0.1,
      });

      context.log("Message 1: Establishing context about CPU");
      const response1 = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage("The CPU is running at 85%"),
      ]);

      context.log(`Response 1: ${response1.content}`);

      context.log("Message 2: Reference to previous context");
      const response2 = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage("The CPU is running at 85%"),
        new AIMessage(response1.content.toString()),
        new HumanMessage("Is it still high?"),
      ]);

      context.log(`Response 2: ${response2.content}`);

      const responseText = response2.content.toString().toLowerCase();
      if (!responseText.includes("cpu") && !responseText.includes("85")) {
        throw new Error(
          "AI did not maintain context - no reference to CPU or 85%"
        );
      }

      const tokens = {
        input:
          (response1.usage_metadata?.input_tokens || 0) +
          (response2.usage_metadata?.input_tokens || 0),
        output:
          (response1.usage_metadata?.output_tokens || 0) +
          (response2.usage_metadata?.output_tokens || 0),
      };

      const cost = calculateCost(tokens.input, tokens.output);
      context.log("✅ Context maintained across messages");

      return {
        responseMaintainsContext: true,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        estimatedCostUsd: cost,
      };
    },
  },

  // Test 13: Multi-Tool Orchestration
  {
    id: "ai-multi-tool",
    name: "Multi-Tool Reasoning",
    category: "ai",
    description: "Verify AI can use multiple tools for complex queries",
    estimatedDuration: 2300,
    estimatedCost: 0.0005,
    fn: async (context) => {
      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
      }

      context.log("Initializing ChatOpenAI with tools");
      const model = new ChatOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL_NAME,
        temperature: 0.1,
      }).bindTools(mockTools);

      context.log("Sending complex query requiring multiple tools");
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(
          "Compare current status with last hour and tell me if anything looks wrong"
        ),
      ]);

      context.log(`Tool calls: ${JSON.stringify(response.tool_calls)}`);

      if (!response.tool_calls || response.tool_calls.length < 2) {
        throw new Error(
          `Expected at least 2 tool calls, got ${response.tool_calls?.length || 0}`
        );
      }

      context.log(`Total tool calls: ${response.tool_calls.length}`);
      response.tool_calls.forEach((call, i) => {
        context.log(`  Tool ${i + 1}: ${call.name}`);
      });

      const tokens = {
        input: response.usage_metadata?.input_tokens || 0,
        output: response.usage_metadata?.output_tokens || 0,
      };

      const cost = calculateCost(tokens.input, tokens.output);
      context.log("✅ Multi-tool orchestration working");

      return {
        toolCallsCount: response.tool_calls.length,
        toolsUsed: response.tool_calls.map((t) => t.name),
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        estimatedCostUsd: cost,
      };
    },
  },
];
