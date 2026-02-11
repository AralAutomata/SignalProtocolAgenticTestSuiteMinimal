/**
 * ============================================================================
 * Next.js Root Layout Component
 * ============================================================================
 * 
 * PURPOSE:
 * Root layout component for the SysMaint Dashboard Next.js application.
 * Provides the global page structure including:
 * - HTML document wrapper with language attribute
 * - Global CSS import (globals.css with design system styles)
 * - Site-wide navigation header (topbar)
 * - Main content container
 * - SEO metadata configuration
 * 
 * ARCHITECTURE:
 * - Next.js App Router Root Layout pattern
 * - Server Component (no "use client" directive)
 * - Wraps all pages in the application
 * - Provides consistent navigation and branding
 * 
 * NAVIGATION STRUCTURE:
 * The topbar provides access to three main application areas:
 * 
 * 1. Dashboard (/)
 *    - System status overview with real-time metrics
 *    - Shows telemetry from diag-probe via Signal Protocol
 *    - Displays CPU, memory, relay stats, and LLM usage
 * 
 * 2. Alice Chat (/chat)
 *    - Direct messaging interface with SysMaint AI agent
 *    - Uses Signal Protocol for end-to-end encryption
 *    - Interactive chat with quick prompts
 * 
 * 3. Demo (/demo)
 *    - 3-panel E2EE demonstration
 *    - Alice ↔ Bob direct messaging demo
 *    - SysMaint AI integration demo
 *    - Shows Signal Protocol in action
 * 
 * STYLING:
 * - Uses globals.css for all styling (no CSS-in-JS)
 * - CSS classes: .topbar, .brand, .container
 * - Responsive design handled in global styles
 * - Clean, minimal UI focused on system monitoring
 * 
 * METADATA:
 * - Title: "SysMaint Dashboard"
 * - Description: Explains the Signal-encrypted nature of the application
 * - Used for SEO and browser tab titles
 * 
 * CHILDREN RENDERING:
 * The children prop represents the page content specific to each route:
 * - / renders DashboardPage
 * - /chat renders ChatPage
 * - /demo renders DemoPage
 * 
 * This follows the Next.js App Router convention where layout.tsx
 * provides the wrapper and page.tsx provides the route-specific content.
 * 
 * TYPE SAFETY:
 * Uses ReactNode type for children to accept any valid React child:
 * - JSX elements
 * - Strings
 * - Numbers
 * - Arrays of the above
 * - null/undefined
 * 
 * @module apps/sysmaint-web/app/layout
 * @see {@link ./page.tsx} Dashboard page content
 * @see {@link ./chat/page.tsx} Chat page content
 * @see {@link ./demo/page.tsx} Demo page content
 * @see {@link ./globals.css} Global stylesheet
 * ============================================================================
 */

import "./globals.css";
import type { ReactNode } from "react";

/**
 * Next.js metadata configuration.
 * 
 * These values are used for:
 * - <title> tag in HTML <head>
 * - <meta name="description"> tag
 * - SEO optimization
 * - Social media sharing previews
 * 
 * The description emphasizes the Signal Protocol encryption aspect,
 * which is a key differentiator of this application.
 */
export const metadata = {
  /** Page title shown in browser tab and search results */
  title: "SysMaint Dashboard",
  
  /** Page description for SEO and social sharing */
  description: "Signal-encrypted SysMaint operations console"
};

/**
 * Root Layout Component
 * 
 * Wraps all pages with consistent HTML structure, global styles,
 * and navigation. This component renders on the server and
 * provides the foundation for all route-specific content.
 * 
 * @param props - Component properties
 * @param props.children - The page-specific content to render
 * @returns JSX.Element - The complete page structure
 * 
 * @example
 * // This layout wraps all pages:
 * // URL: / -> children = <DashboardPage />
 * // URL: /chat -> children = <ChatPage />
 * // URL: /demo -> children = <DemoPage />
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /**
     * HTML document wrapper.
     * lang="en" is important for:
     * - Accessibility (screen readers)
     * - Search engine optimization
     * - Browser language detection
     */
    <html lang="en">
      {/**
       * Body element containing:
       * 1. Top navigation header
       * 2. Main content area (from children)
       */}
      <body>
        {/**
         * Site-wide navigation header.
         * Provides consistent navigation across all pages.
         * Uses semantic HTML5 <header> element.
         */}
        <header className="topbar">
          {/**
           * Brand/logo display.
           * Simple text-based branding ("SysMaint")
           */}
          <div className="brand">SysMaint</div>
          
          {/**
           * Navigation links.
           * Uses semantic <nav> element with anchor tags.
           * Links are relative (href="/") for client-side navigation.
           */}
          <nav>
            <a href="/">Dashboard</a>
            <a href="/chat">Alice Chat</a>
            <a href="/demo">Demo</a>
            <a href="/test">Tests</a>
          </nav>
        </header>
        
        {/**
         * Main content container.
         * Wraps the page-specific content passed as children.
         * Uses semantic <main> element for accessibility.
         * The .container class provides consistent padding and max-width.
         */}
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
