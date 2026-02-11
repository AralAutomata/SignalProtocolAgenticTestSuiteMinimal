/**
 * ============================================================================
 * TEST OVERVIEW MESSENGER
 * ============================================================================
 *
 * Send test analysis reports to Alice via Signal Protocol E2EE.
 *
 * @module apps/sysmaint-web/lib/test-suite/messenger
 * ============================================================================
 */

import { sendPromptToSysmaint } from "../signal";

/**
 * Send test overview report to Alice via E2EE Signal message
 */
export async function sendReportToAlice(report: string): Promise<void> {
  // We send the report as a chat prompt to SysMaint
  // The agent will receive it and can process/reply
  // But actually, we want Alice to RECEIVE this, not send it TO SysMaint
  
  // Since the web app IS Alice's interface, we need to:
  // 1. Encrypt the report using Alice's Signal keys
  // 2. Send it to Alice's own address (appears as message from herself)
  // 3. Or create a special system message
  
  // For now, we'll send it as a "system" message by:
  // Using the existing sendPromptToSysmaint but with a special flag
  // that tells the agent to echo it back as a system message
  
  const systemPrompt = `[SYSTEM TEST REPORT]\n\n${report}\n\n[End of automated test report]`;
  
  // Send to SysMaint agent with special prefix
  // The agent can be configured to recognize [SYSTEM] messages
  await sendPromptToSysmaint(systemPrompt);
}
