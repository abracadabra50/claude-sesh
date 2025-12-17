import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { parser } from './parser.js';
import type { EnrichedSession, ParsedSession, ClaudeMessage, ContentBlock } from '../types/index.js';

const ENRICHED_DIR = path.join(process.env.HOME || '', '.claude-sesh', 'enriched');

// Ensure enriched directory exists
if (!fs.existsSync(ENRICHED_DIR)) {
  fs.mkdirSync(ENRICHED_DIR, { recursive: true });
}

export class SessionEnricher {
  private client: Anthropic | null = null;

  constructor() {
    // Only initialize if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic();
    }
  }

  /**
   * Check if enrichment is available (API key set)
   */
  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /**
   * Get sessions that need enrichment (no summaries)
   */
  getSessionsNeedingEnrichment(limit = 50): ParsedSession[] {
    const sessions = parser.getAllSessions(500);
    return sessions
      .filter(s => !s.summaries || s.summaries.length === 0)
      .filter(s => !this.isEnriched(s.id))
      .slice(0, limit);
  }

  /**
   * Check if a session is already enriched
   */
  isEnriched(sessionId: string): boolean {
    const enrichedPath = path.join(ENRICHED_DIR, `${sessionId}.json`);
    return fs.existsSync(enrichedPath);
  }

  /**
   * Get enriched data for a session
   */
  getEnrichedData(sessionId: string): EnrichedSession | null {
    const enrichedPath = path.join(ENRICHED_DIR, `${sessionId}.json`);
    if (!fs.existsSync(enrichedPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Enrich a single session using Claude
   */
  async enrichSession(sessionId: string): Promise<EnrichedSession | null> {
    // Check if API is available
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY not set. Run: export ANTHROPIC_API_KEY=your-key');
    }

    // Check if already enriched
    const existing = this.getEnrichedData(sessionId);
    if (existing) return existing;

    // Get session data
    const session = parser.getSession(sessionId);
    if (!session) return null;

    // Get raw messages for analysis
    const messages = parser.getRawMessages(sessionId);
    if (!messages || messages.length === 0) return null;

    // Prepare context for Claude
    const context = this.prepareContext(session, messages);

    try {
      const response = await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Analyze this Claude Code session and provide a structured summary. Be concise.

PROJECT: ${session.projectName}
DURATION: ${Math.round(session.durationSeconds / 60)} minutes
FILES MODIFIED: ${[...session.filesWritten, ...session.filesEdited].slice(0, 10).join(', ')}
TOOL CALLS: ${session.toolCallCount}
ERRORS: ${session.errors.length}

SESSION CONTEXT:
${context}

Respond in this exact JSON format:
{
  "summary": "One sentence describing what was accomplished",
  "decisions": ["Key decision 1", "Key decision 2"],
  "problems": [{"issue": "Problem description", "solution": "How it was solved"}],
  "knowledge": ["Insight 1 for future sessions", "Insight 2"],
  "tags": ["tag1", "tag2", "tag3"],
  "sentiment": "productive|challenging|exploratory|maintenance"
}

Only include items that are clearly evident from the session. Keep arrays short (2-4 items max).`
          }
        ]
      });

      // Parse response
      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') return null;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);

      const enriched: EnrichedSession = {
        sessionId,
        enrichedAt: new Date(),
        summary: parsed.summary || 'Session analyzed',
        decisions: parsed.decisions || [],
        problems: parsed.problems || [],
        knowledge: parsed.knowledge || [],
        tags: parsed.tags || [],
        sentiment: parsed.sentiment || 'productive'
      };

      // Save to disk
      fs.writeFileSync(
        path.join(ENRICHED_DIR, `${sessionId}.json`),
        JSON.stringify(enriched, null, 2)
      );

      return enriched;
    } catch (error) {
      console.error(`Failed to enrich session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Enrich multiple sessions
   */
  async enrichBatch(limit = 10, onProgress?: (done: number, total: number) => void): Promise<{
    enriched: number;
    failed: number;
    skipped: number;
  }> {
    const sessions = this.getSessionsNeedingEnrichment(limit);
    let enriched = 0;
    let failed = 0;
    const skipped = 0;

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      onProgress?.(i + 1, sessions.length);

      try {
        const result = await this.enrichSession(session.id);
        if (result) {
          enriched++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }

      // Rate limit: wait 500ms between calls
      if (i < sessions.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return { enriched, failed, skipped };
  }

  /**
   * Get all enriched sessions
   */
  getAllEnriched(): EnrichedSession[] {
    if (!fs.existsSync(ENRICHED_DIR)) return [];

    const files = fs.readdirSync(ENRICHED_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ENRICHED_DIR, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean) as EnrichedSession[];
  }

  /**
   * Get enrichment stats
   */
  getStats(): { total: number; enriched: number; pending: number } {
    const allSessions = parser.getAllSessions(500);
    const sessionsWithoutSummary = allSessions.filter(s => !s.summaries || s.summaries.length === 0);
    const enrichedCount = this.getAllEnriched().length;

    return {
      total: allSessions.length,
      enriched: enrichedCount,
      pending: sessionsWithoutSummary.length - enrichedCount
    };
  }

  /**
   * Prepare context from messages for Claude analysis
   */
  private prepareContext(session: ParsedSession, messages: ClaudeMessage[]): string {
    const contextParts: string[] = [];

    // Get user messages and assistant summaries
    for (const msg of messages.slice(-30)) {
      if (msg.type === 'summary' && msg.summary) {
        contextParts.push(`[SUMMARY] ${msg.summary}`);
      } else if (msg.type === 'user' && msg.message?.content) {
        const content = typeof msg.message.content === 'string'
          ? msg.message.content
          : this.extractTextFromBlocks(msg.message.content);
        if (content.length > 10) {
          contextParts.push(`[USER] ${content.slice(0, 500)}`);
        }
      } else if (msg.type === 'assistant' && msg.message?.content) {
        const content = typeof msg.message.content === 'string'
          ? msg.message.content
          : this.extractTextFromBlocks(msg.message.content);
        if (content.length > 10) {
          contextParts.push(`[ASSISTANT] ${content.slice(0, 300)}`);
        }
      }
    }

    // Add error context
    if (session.errors.length > 0) {
      contextParts.push(`[ERRORS] ${session.errors.slice(0, 3).map(e => e.message).join('; ')}`);
    }

    return contextParts.slice(-15).join('\n\n');
  }

  private extractTextFromBlocks(blocks: ContentBlock[]): string {
    return blocks
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join(' ')
      .slice(0, 500);
  }
}

export const enricher = new SessionEnricher();
