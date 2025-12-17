import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type {
  ClaudeMessage,
  ParsedSession,
  ToolCall,
  SessionError,
  ContentBlock,
  TodoItem,
  StatsCache,
  DailyActivity,
  HeatmapData,
  HeatmapCell,
  CommandHistoryEntry,
  PlanFile,
  Leaderboard,
  LeaderboardEntry,
  TimelineData,
} from '../types/index.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const STATS_CACHE_PATH = join(CLAUDE_DIR, 'stats-cache.json');
const HISTORY_PATH = join(CLAUDE_DIR, 'history.jsonl');
const PLANS_DIR = join(CLAUDE_DIR, 'plans');
const TODOS_DIR = join(CLAUDE_DIR, 'todos');

// Model pricing (USD per 1M tokens) - https://docs.claude.com/en/docs/about-claude/pricing
// Updated December 2025
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  // Opus 4.5 (Nov 2025) - New lower pricing
  'claude-opus-4-5-20251101': { input: 5, output: 25, cacheRead: 0.5 },
  // Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3 },
  // Sonnet 4
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3 },
  // Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1 },
  // Claude 3.5
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-3-5-sonnet-20240620': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4, cacheRead: 0.08 },
  // Claude 3
  'claude-3-opus-20240229': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-3-sonnet-20240229': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, cacheRead: 0.025 },
  // Older Opus (4.0/4.1)
  'claude-opus-4-20250514': { input: 15, output: 75, cacheRead: 1.5 },
  default: { input: 3, output: 15, cacheRead: 0.3 },
};

// Format model name for display
export function formatModelName(model: string): string {
  if (!model || model === 'unknown') return 'Unknown';

  // Extract key parts: claude-{model}-{version}-{date}
  const parts = model.split('-');
  if (parts.length < 3) return model;

  // Get model family (opus, sonnet, haiku)
  const family = parts.find(p => ['opus', 'sonnet', 'haiku'].includes(p)) || parts[1];
  // Get version (4, 4.5, 3, 3.5)
  const versionParts = parts.filter(p => /^\d/.test(p) && p.length <= 3);
  const version = versionParts.join('.');

  return `${family.charAt(0).toUpperCase() + family.slice(1)} ${version}`;
}

export class SessionParser {
  // Session cache for performance
  private sessionCache: Map<string, ParsedSession> = new Map();
  private cacheTimestamp: number = 0;
  private cacheTTL: number = 30000; // 30 seconds TTL

  // Invalidate cache if older than TTL
  private isCacheValid(): boolean {
    return Date.now() - this.cacheTimestamp < this.cacheTTL;
  }

  // Clear and rebuild cache (only parses most recent sessions for speed)
  private rebuildCache(): void {
    this.sessionCache.clear();
    const projectFolders = this.getProjectFolders();

    // Collect all files with modification times
    const allFiles: { path: string; mtime: number }[] = [];
    for (const folder of projectFolders) {
      const projectDir = join(PROJECTS_DIR, folder);
      if (!existsSync(projectDir)) continue;

      const files = readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fullPath = join(projectDir, f);
          return { path: fullPath, mtime: statSync(fullPath).mtime.getTime() };
        });
      allFiles.push(...files);
    }

    // Sort by modification time (newest first) and take top 300
    allFiles.sort((a, b) => b.mtime - a.mtime);
    const recentFiles = allFiles.slice(0, 300);

    // Parse only recent files
    for (const { path } of recentFiles) {
      const session = this.parseSessionFile(path);
      if (session) {
        this.sessionCache.set(session.id, session);
      }
    }
    this.cacheTimestamp = Date.now();
  }

  // Get all project directories (returns folder names as-is)
  getProjectFolders(): string[] {
    if (!existsSync(PROJECTS_DIR)) return [];

    return readdirSync(PROJECTS_DIR)
      .filter(f => {
        const fullPath = join(PROJECTS_DIR, f);
        return statSync(fullPath).isDirectory() && !f.startsWith('.');
      });
  }

  // Get project paths (human-readable format)
  getProjects(): string[] {
    return this.getProjectFolders()
      .map(f => f.replace(/-/g, '/'));
  }

  // Get session files for a project folder
  getSessionFiles(projectFolder: string): string[] {
    const projectDir = join(PROJECTS_DIR, projectFolder);

    if (!existsSync(projectDir)) return [];

    return readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(projectDir, f))
      .sort((a, b) => {
        // Sort by modification time, newest first
        return statSync(b).mtime.getTime() - statSync(a).mtime.getTime();
      });
  }

  // Parse a session file
  parseSessionFile(filePath: string): ParsedSession | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const messages: ClaudeMessage[] = [];
      const summaries: string[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as ClaudeMessage;
          if (parsed.type === 'summary' && parsed.summary) {
            summaries.push(parsed.summary);
          } else if (parsed.type === 'user' || parsed.type === 'assistant') {
            messages.push(parsed);
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      if (messages.length === 0) return null;

      return this.aggregateSession(filePath, messages, summaries);
    } catch {
      return null;
    }
  }

  private aggregateSession(
    filePath: string,
    messages: ClaudeMessage[],
    summaries: string[]
  ): ParsedSession {
    const sessionId = basename(filePath, '.jsonl');

    // Get timestamps
    const timestamps = messages
      .map(m => new Date(m.timestamp))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    const startedAt = timestamps[0] || new Date();
    const endedAt = timestamps[timestamps.length - 1] || null;
    const durationSeconds = endedAt
      ? Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
      : 0;

    // Get project info
    const firstMsg = messages[0];
    const projectPath = firstMsg?.cwd || 'Unknown';
    const projectName = basename(projectPath);
    const gitBranch = firstMsg?.gitBranch || null;

    // Count messages
    const userMessages = messages.filter(m => m.type === 'user');
    const assistantMessages = messages.filter(m => m.type === 'assistant');

    // Calculate tokens with proper cache breakdown
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let model = 'unknown';

    for (const msg of assistantMessages) {
      if (msg.message?.usage) {
        inputTokens += msg.message.usage.input_tokens || 0;
        cacheCreationTokens += msg.message.usage.cache_creation_input_tokens || 0;
        cacheReadTokens += msg.message.usage.cache_read_input_tokens || 0;
        outputTokens += msg.message.usage.output_tokens || 0;
      }
      if (msg.message?.model) {
        model = msg.message.model;
      }
    }

    // Total tokens for display (includes all input types)
    const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;

    // Calculate cost with proper cache pricing
    // - Regular input: base price
    // - Cache write: 1.25x base input price
    // - Cache read: 0.1x base input price (90% cheaper!)
    // - Output: base output price
    const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
    const estimatedCostUsd =
      (inputTokens * pricing.input +
       cacheCreationTokens * pricing.input * 1.25 +
       cacheReadTokens * pricing.cacheRead +
       outputTokens * pricing.output) / 1_000_000;

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    const filesRead = new Set<string>();
    const filesWritten = new Set<string>();
    const filesEdited = new Set<string>();
    const errors: SessionError[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_use' && block.name) {
          const toolCall: ToolCall = {
            name: block.name,
            timestamp: msg.timestamp,
            input: block.input || {},
            isError: false,
          };

          // Track file operations
          const filePath = (block.input as { file_path?: string })?.file_path;
          if (filePath) {
            if (block.name === 'Read') filesRead.add(filePath);
            if (block.name === 'Write') filesWritten.add(filePath);
            if (block.name === 'Edit') filesEdited.add(filePath);
          }

          // Look for the result in subsequent messages
          for (let j = i + 1; j < Math.min(i + 5, messages.length); j++) {
            const nextMsg = messages[j];
            if (nextMsg.type === 'user' && nextMsg.toolUseResult) {
              const result = typeof nextMsg.toolUseResult === 'string'
                ? nextMsg.toolUseResult
                : JSON.stringify(nextMsg.toolUseResult);
              toolCall.result = result;
              if (result.includes('Error') || result.includes('error')) {
                toolCall.isError = true;
                errors.push({
                  timestamp: nextMsg.timestamp,
                  message: result,
                  toolName: block.name,
                });
              }
              break;
            }
          }

          toolCalls.push(toolCall);
        }
      }
    }

    return {
      id: sessionId,
      projectPath,
      projectName,
      startedAt,
      endedAt,
      durationSeconds,
      gitBranch,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      summaries,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      toolCalls,
      toolCallCount: toolCalls.length,
      filesRead: Array.from(filesRead),
      filesWritten: Array.from(filesWritten),
      filesEdited: Array.from(filesEdited),
      errors,
      model,
    };
  }

  // Get all sessions across all projects
  getAllSessions(limit = 2000): ParsedSession[] {
    // Use cache if valid
    if (!this.isCacheValid() || this.sessionCache.size === 0) {
      this.rebuildCache();
    }

    // Get all sessions from cache
    const sessions = Array.from(this.sessionCache.values());

    // Sort by start time, newest first, THEN apply limit
    return sessions
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  // Get sessions for a specific project (accepts path like /Users/foo or folder like -Users-foo)
  getProjectSessions(projectPath: string, limit = 50): ParsedSession[] {
    // Convert path to folder format if needed
    const folder = projectPath.startsWith('-') ? projectPath : projectPath.replace(/\//g, '-');
    const files = this.getSessionFiles(folder);
    const sessions: ParsedSession[] = [];

    for (const file of files.slice(0, limit)) {
      const session = this.parseSessionFile(file);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  // Get a specific session by ID
  getSession(sessionId: string): ParsedSession | null {
    // Try cache first
    if (this.isCacheValid() && this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId) || null;
    }

    // Rebuild cache if invalid
    if (!this.isCacheValid() || this.sessionCache.size === 0) {
      this.rebuildCache();
      if (this.sessionCache.has(sessionId)) {
        return this.sessionCache.get(sessionId) || null;
      }
    }

    // Fall back to direct file lookup for very new sessions
    const folders = this.getProjectFolders();
    for (const folder of folders) {
      const files = this.getSessionFiles(folder);
      for (const file of files) {
        if (basename(file, '.jsonl') === sessionId) {
          const session = this.parseSessionFile(file);
          if (session) {
            this.sessionCache.set(sessionId, session);
          }
          return session;
        }
      }
    }

    return null;
  }

  // Get raw messages for a session (for resume context)
  getRawMessages(sessionId: string): ClaudeMessage[] {
    const folders = this.getProjectFolders();

    for (const folder of folders) {
      const files = this.getSessionFiles(folder);
      for (const file of files) {
        if (basename(file, '.jsonl') === sessionId) {
          const content = readFileSync(file, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);

          return lines
            .map(line => {
              try {
                return JSON.parse(line) as ClaudeMessage;
              } catch {
                return null;
              }
            })
            .filter((m): m is ClaudeMessage => m !== null);
        }
      }
    }

    return [];
  }

  // Get todos from a session
  getSessionTodos(sessionId: string): TodoItem[] {
    const messages = this.getRawMessages(sessionId);
    const todos: TodoItem[] = [];

    // Get todos from the most recent message that has them
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.todos && msg.todos.length > 0) {
        return msg.todos;
      }
    }

    return todos;
  }

  // Get sessions that are good candidates for resuming
  getResumableSessions(limit = 10): Array<ParsedSession & { resumeReason: string; resumeScore: number }> {
    const sessions = this.getAllSessions(200);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const scored = sessions.map(session => {
      let score = 0;
      let reasons: string[] = [];

      // Check for pending todos
      const todos = this.getSessionTodos(session.id);
      const pendingTodos = todos.filter(t => t.status !== 'completed');
      if (pendingTodos.length > 0) {
        score += 50 + pendingTodos.length * 10;
        reasons.push(`${pendingTodos.length} pending task${pendingTodos.length > 1 ? 's' : ''}`);
      }

      // Check for errors that might need follow-up
      if (session.errors.length > 0) {
        score += 20;
        reasons.push('Has unresolved errors');
      }

      // Recent sessions get bonus
      if (session.startedAt >= sevenDaysAgo) {
        const daysAgo = Math.floor((now.getTime() - session.startedAt.getTime()) / (24 * 60 * 60 * 1000));
        score += Math.max(0, 30 - daysAgo * 4); // More recent = higher score
        if (daysAgo === 0) reasons.push('Today');
        else if (daysAgo === 1) reasons.push('Yesterday');
        else reasons.push(`${daysAgo} days ago`);
      }

      // High activity sessions that were short might be incomplete
      const tokensPerMinute = session.durationSeconds > 0
        ? session.totalTokens / (session.durationSeconds / 60)
        : 0;
      if (tokensPerMinute > 5000 && session.durationSeconds < 600) {
        score += 15;
        reasons.push('High activity, short session');
      }

      // Sessions with summaries indicating work in progress
      const summaryText = session.summaries.join(' ').toLowerCase();
      if (summaryText.includes('in progress') || summaryText.includes('todo') ||
          summaryText.includes('next step') || summaryText.includes('continue')) {
        score += 25;
        reasons.push('Work in progress');
      }

      return {
        ...session,
        resumeScore: score,
        resumeReason: reasons.length > 0 ? reasons[0] : 'Recent session',
      };
    });

    return scored
      .filter(s => s.resumeScore > 0)
      .sort((a, b) => b.resumeScore - a.resumeScore)
      .slice(0, limit);
  }

  // Build resume context for a session (with optional enriched data)
  buildResumeContext(sessionId: string, enrichedData?: {
    summary?: string;
    keyDecisions?: string[];
    problemsSolved?: string[];
    knowledgeGained?: string[];
  }): string | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const messages = this.getRawMessages(sessionId);
    const todos = this.getSessionTodos(sessionId);

    // Get last few user messages for context
    const recentUserMessages: string[] = [];
    for (let i = messages.length - 1; i >= 0 && recentUserMessages.length < 3; i--) {
      const msg = messages[i];
      if (msg.type === 'user' && msg.message?.role === 'user') {
        const content = msg.message.content;
        if (typeof content === 'string' && content.trim()) {
          recentUserMessages.unshift(content.slice(0, 200));
        }
      }
    }

    // Build context
    let context = `# Resume Context for ${session.projectName}\n\n`;
    context += `> Resuming session from ${session.endedAt?.toLocaleString() || 'Unknown'}\n\n`;

    // Session overview
    context += `## Session Overview\n`;
    context += `- **Project:** ${session.projectPath}\n`;
    context += `- **Duration:** ${formatDuration(session.durationSeconds)}\n`;
    context += `- **Branch:** ${session.gitBranch || 'N/A'}\n`;
    context += `- **Model:** ${session.model}\n`;
    context += `- **Activity:** ${session.messageCount} messages, ${session.toolCallCount} tool calls\n\n`;

    // Use enriched summary if available, otherwise use Claude's summaries
    if (enrichedData?.summary) {
      context += `## What Was Accomplished\n`;
      context += enrichedData.summary + '\n\n';
    } else if (session.summaries.length > 0) {
      context += `## Session Summary\n`;
      context += session.summaries.slice(-2).join('\n\n') + '\n\n';
    }

    // Key decisions from enrichment
    if (enrichedData?.keyDecisions?.length) {
      context += `## Key Decisions Made\n`;
      enrichedData.keyDecisions.forEach(d => (context += `- ${d}\n`));
      context += '\n';
    }

    // Problems solved
    if (enrichedData?.problemsSolved?.length) {
      context += `## Problems Solved\n`;
      enrichedData.problemsSolved.forEach(p => (context += `- ${p}\n`));
      context += '\n';
    }

    // Knowledge gained (useful for transfer)
    if (enrichedData?.knowledgeGained?.length) {
      context += `## Knowledge Gained\n`;
      enrichedData.knowledgeGained.forEach(k => (context += `- ${k}\n`));
      context += '\n';
    }

    // Files modified
    const allFiles = [...new Set([...session.filesWritten, ...session.filesEdited])];
    if (allFiles.length > 0) {
      context += `## Files Modified\n`;
      allFiles.slice(-15).forEach(f => (context += `- ${f}\n`));
      context += '\n';
    }

    // Pending tasks (critical for resume)
    const pendingTodos = todos.filter(t => t.status !== 'completed');
    if (pendingTodos.length > 0) {
      context += `## Pending Tasks (Incomplete)\n`;
      pendingTodos.forEach(t => (context += `- [ ] ${t.content}\n`));
      context += '\n';
    }

    // Completed tasks for context
    const completedTodos = todos.filter(t => t.status === 'completed').slice(-5);
    if (completedTodos.length > 0) {
      context += `## Recently Completed\n`;
      completedTodos.forEach(t => (context += `- [x] ${t.content}\n`));
      context += '\n';
    }

    // Errors encountered (might need follow-up)
    if (session.errors.length > 0) {
      context += `## Errors Encountered\n`;
      session.errors.slice(-3).forEach(e => {
        context += `- **${e.toolName || 'Error'}:** ${e.message.slice(0, 150)}...\n`;
      });
      context += '\n';
    }

    // Recent conversation context
    if (recentUserMessages.length > 0) {
      context += `## Recent Conversation\n`;
      recentUserMessages.forEach((msg, i) => {
        context += `${i + 1}. "${msg}${msg.length >= 200 ? '...' : ''}"\n`;
      });
      context += '\n';
    }

    context += `---\n`;
    context += `*Session ID: ${sessionId}*\n`;

    return context;
  }

  // ==================== NEW METHODS FOR ENHANCED DASHBOARD ====================

  // Read Claude's stats-cache.json for activity data
  getStatsCache(): StatsCache | null {
    if (!existsSync(STATS_CACHE_PATH)) return null;

    try {
      const content = readFileSync(STATS_CACHE_PATH, 'utf-8');
      return JSON.parse(content) as StatsCache;
    } catch {
      return null;
    }
  }

  // Get daily activity from stats cache
  getDailyActivity(): DailyActivity[] {
    const stats = this.getStatsCache();
    return stats?.dailyActivity || [];
  }

  // Generate heatmap data (GitHub-style contribution graph)
  getHeatmapData(weeks = 52): HeatmapData {
    const dailyActivity = this.getDailyActivity();
    const sessions = this.getAllSessions(2000);

    // Create a map of date -> activity
    const activityMap = new Map<string, HeatmapCell>();

    // First, add data from stats cache
    for (const activity of dailyActivity) {
      activityMap.set(activity.date, {
        date: activity.date,
        dayOfWeek: new Date(activity.date).getDay(),
        week: 0, // Will be calculated later
        value: activity.messageCount,
        sessions: activity.sessionCount,
        messages: activity.messageCount,
        tools: activity.toolCallCount,
        tokens: 0,
      });
    }

    // Enrich with token data from sessions
    for (const session of sessions) {
      const dateStr = session.startedAt.toISOString().split('T')[0];
      const existing = activityMap.get(dateStr);
      if (existing) {
        existing.tokens = (existing.tokens || 0) + session.totalTokens;
      } else {
        activityMap.set(dateStr, {
          date: dateStr,
          dayOfWeek: session.startedAt.getDay(),
          week: 0,
          value: session.messageCount,
          sessions: 1,
          messages: session.messageCount,
          tools: session.toolCallCount,
          tokens: session.totalTokens,
        });
      }
    }

    // Calculate week offsets and fill in empty days
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (weeks * 7) + (7 - now.getDay()));

    const cells: HeatmapCell[] = [];
    let maxValue = 0;

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + (week * 7) + day);

        if (date > now) continue;

        const dateStr = date.toISOString().split('T')[0];
        const existing = activityMap.get(dateStr);

        const cell: HeatmapCell = existing
          ? { ...existing, week }
          : {
              date: dateStr,
              dayOfWeek: day,
              week,
              value: 0,
              sessions: 0,
              messages: 0,
              tools: 0,
              tokens: 0,
            };

        if (cell.value > maxValue) maxValue = cell.value;
        cells.push(cell);
      }
    }

    return {
      cells,
      maxValue,
      totalDays: cells.length,
      weekStart: startDate,
      weekEnd: now,
    };
  }

  // Read command history
  getCommandHistory(limit = 100): CommandHistoryEntry[] {
    if (!existsSync(HISTORY_PATH)) return [];

    try {
      const content = readFileSync(HISTORY_PATH, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      return lines
        .slice(-limit)
        .reverse()
        .map(line => {
          try {
            return JSON.parse(line) as CommandHistoryEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is CommandHistoryEntry => e !== null);
    } catch {
      return [];
    }
  }

  // Read plan files
  getPlanFiles(): PlanFile[] {
    if (!existsSync(PLANS_DIR)) return [];

    try {
      return readdirSync(PLANS_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const filePath = join(PLANS_DIR, f);
          const stats = statSync(filePath);
          return {
            name: f.replace('.md', ''),
            path: filePath,
            content: readFileSync(filePath, 'utf-8'),
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
            size: stats.size,
          };
        })
        .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    } catch {
      return [];
    }
  }

  // Generate leaderboards
  getLeaderboard(type: Leaderboard['type'], limit = 10): Leaderboard {
    const sessions = this.getAllSessions(2000);

    switch (type) {
      case 'projects': {
        const projectMap = new Map<string, { tokens: number; sessions: number; duration: number }>();
        for (const s of sessions) {
          const existing = projectMap.get(s.projectName) || { tokens: 0, sessions: 0, duration: 0 };
          existing.tokens += s.totalTokens;
          existing.sessions += 1;
          existing.duration += s.durationSeconds;
          projectMap.set(s.projectName, existing);
        }

        const entries: LeaderboardEntry[] = Array.from(projectMap.entries())
          .sort((a, b) => b[1].tokens - a[1].tokens)
          .slice(0, limit)
          .map(([name, data], i) => ({
            rank: i + 1,
            name,
            value: data.tokens,
            secondaryValue: data.sessions,
            metadata: { duration: data.duration },
          }));

        return { type: 'projects', title: 'Top Projects', entries, metric: 'tokens', secondaryMetric: 'sessions' };
      }

      case 'models': {
        const modelMap = new Map<string, { tokens: number; sessions: number }>();
        for (const s of sessions) {
          const modelName = formatModelName(s.model);
          const existing = modelMap.get(modelName) || { tokens: 0, sessions: 0 };
          existing.tokens += s.totalTokens;
          existing.sessions += 1;
          modelMap.set(modelName, existing);
        }

        const entries: LeaderboardEntry[] = Array.from(modelMap.entries())
          .sort((a, b) => b[1].sessions - a[1].sessions)
          .slice(0, limit)
          .map(([name, data], i) => ({
            rank: i + 1,
            name,
            value: data.sessions,
            secondaryValue: data.tokens,
          }));

        return { type: 'models', title: 'Model Usage', entries, metric: 'sessions', secondaryMetric: 'tokens' };
      }

      case 'tools': {
        const toolMap = new Map<string, { count: number; errors: number }>();
        for (const s of sessions) {
          for (const t of s.toolCalls) {
            const existing = toolMap.get(t.name) || { count: 0, errors: 0 };
            existing.count += 1;
            if (t.isError) existing.errors += 1;
            toolMap.set(t.name, existing);
          }
        }

        const entries: LeaderboardEntry[] = Array.from(toolMap.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, limit)
          .map(([name, data], i) => ({
            rank: i + 1,
            name,
            value: data.count,
            secondaryValue: data.errors,
            metadata: { errorRate: data.errors / data.count },
          }));

        return { type: 'tools', title: 'Most Used Tools', entries, metric: 'calls', secondaryMetric: 'errors' };
      }

      case 'days': {
        const dayMap = new Map<string, { sessions: number; tokens: number; messages: number }>();
        for (const s of sessions) {
          const dayName = s.startedAt.toLocaleDateString('en-US', { weekday: 'long' });
          const existing = dayMap.get(dayName) || { sessions: 0, tokens: 0, messages: 0 };
          existing.sessions += 1;
          existing.tokens += s.totalTokens;
          existing.messages += s.messageCount;
          dayMap.set(dayName, existing);
        }

        const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const entries: LeaderboardEntry[] = dayOrder
          .map((name, i) => {
            const data = dayMap.get(name) || { sessions: 0, tokens: 0, messages: 0 };
            return {
              rank: i + 1,
              name,
              value: data.sessions,
              secondaryValue: data.tokens,
            };
          })
          .sort((a, b) => b.value - a.value);

        return { type: 'days', title: 'Sessions by Day', entries, metric: 'sessions', secondaryMetric: 'tokens' };
      }

      case 'sessions': {
        const entries: LeaderboardEntry[] = sessions
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .slice(0, limit)
          .map((s, i) => ({
            rank: i + 1,
            name: `${s.projectName} (${s.startedAt.toLocaleDateString()})`,
            value: s.totalTokens,
            secondaryValue: s.durationSeconds,
            metadata: { id: s.id, model: s.model },
          }));

        return { type: 'sessions', title: 'Biggest Sessions', entries, metric: 'tokens', secondaryMetric: 'duration' };
      }

      default:
        return { type, title: 'Unknown', entries: [], metric: '' };
    }
  }

  // Get timeline data
  getTimelineData(days = 90): TimelineData {
    const sessions = this.getAllSessions(2000);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filteredSessions = sessions.filter(s => s.startedAt >= cutoff);

    const timelineSessions = filteredSessions.map(s => ({
      id: s.id,
      projectName: s.projectName,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      model: s.model,
      tokens: s.totalTokens,
    }));

    // For now, return sessions without detailed events (can be expanded later)
    return {
      events: [],
      sessions: timelineSessions,
      dateRange: {
        start: cutoff,
        end: new Date(),
      },
    };
  }

  // Get sessions by date
  getSessionsByDate(dateStr: string): ParsedSession[] {
    const sessions = this.getAllSessions(2000);
    return sessions.filter(s => s.startedAt.toISOString().split('T')[0] === dateStr);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export const parser = new SessionParser();
export default parser;
