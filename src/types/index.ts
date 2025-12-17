// Types that mirror Claude's internal session structure

export interface ClaudeMessage {
  type: 'user' | 'assistant' | 'summary' | 'file-history-snapshot';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
    model?: string;
    id?: string;
    usage?: TokenUsage;
  };
  // For summaries
  summary?: string;
  leafUuid?: string;
  // Tool results
  toolUseResult?: string;
  // Todos from the session
  todos?: TodoItem[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  name?: string; // tool name
  input?: Record<string, unknown>;
  content?: string; // tool result
  is_error?: boolean;
  tool_use_id?: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Parsed session representation
export interface ParsedSession {
  id: string;
  projectPath: string;
  projectName: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;

  // Git info
  gitBranch: string | null;

  // Token usage
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;

  // Summaries (from Claude's own summaries)
  summaries: string[];

  // Messages
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;

  // Tools
  toolCalls: ToolCall[];
  toolCallCount: number;

  // Files
  filesRead: string[];
  filesWritten: string[];
  filesEdited: string[];

  // Errors
  errors: SessionError[];

  // Model used
  model: string;
}

export interface ToolCall {
  name: string;
  timestamp: string;
  input: Record<string, unknown>;
  result?: string;
  isError: boolean;
  durationMs?: number;
}

export interface SessionError {
  timestamp: string;
  message: string;
  toolName?: string;
  context?: string;
}

// Session list item for UI
export interface SessionListItem {
  id: string;
  projectName: string;
  projectPath: string;
  startedAt: Date;
  duration: string;
  summary: string;
  totalTokens: number;
  cost: string;
  model: string;
  messageCount: number;
  toolCallCount: number;
}

// Stats
export interface SessionStats {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  averageSessionDuration: number;
  sessionsToday: number;
  tokensToday: number;
  projectBreakdown: {
    project: string;
    sessions: number;
    tokens: number;
  }[];
  modelBreakdown: {
    model: string;
    sessions: number;
    tokens: number;
  }[];
  dailyActivity: {
    date: string;
    sessions: number;
    tokens: number;
    messages: number;
  }[];
}

// Resume context for continuing a session
export interface ResumeContext {
  session: ParsedSession;
  lastSummary: string;
  recentFiles: string[];
  openTodos: TodoItem[];
  lastUserMessage: string;
  resumePrompt: string;
}

// Daily activity from Claude's stats-cache.json
export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
  // Extended fields we calculate
  tokenCount?: number;
  costUsd?: number;
}

// Stats cache file structure
export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
}

// Hourly activity map for heatmap (day of week -> hour -> count)
export interface HourlyActivityMap {
  [dayOfWeek: number]: { [hour: number]: number };
}

// Heatmap data for visualization
export interface HeatmapData {
  cells: HeatmapCell[];
  maxValue: number;
  totalDays: number;
  weekStart: Date;
  weekEnd: Date;
}

export interface HeatmapCell {
  date: string;
  dayOfWeek: number; // 0-6 (Sun-Sat)
  week: number; // Week number from start
  value: number;
  sessions?: number;
  messages?: number;
  tools?: number;
  tokens?: number;
}

// Command history entry from history.jsonl
export interface CommandHistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  pastedContents?: Record<string, unknown>;
}

// Plan file from ~/.claude/plans/
export interface PlanFile {
  name: string;
  path: string;
  content: string;
  createdAt: Date;
  modifiedAt: Date;
  size: number;
}

// Leaderboard types
export interface LeaderboardEntry {
  rank: number;
  name: string;
  value: number;
  secondaryValue?: number;
  trend?: 'up' | 'down' | 'same';
  metadata?: Record<string, unknown>;
}

export interface Leaderboard {
  type: 'projects' | 'models' | 'tools' | 'days' | 'sessions';
  title: string;
  entries: LeaderboardEntry[];
  metric: string;
  secondaryMetric?: string;
}

// Timeline types
export interface TimelineEvent {
  id: string;
  type: 'session_start' | 'session_end' | 'message' | 'tool_call' | 'error';
  timestamp: Date;
  sessionId: string;
  projectName: string;
  details?: {
    tool?: string;
    message?: string;
    tokens?: number;
    isError?: boolean;
  };
}

export interface TimelineData {
  events: TimelineEvent[];
  sessions: {
    id: string;
    projectName: string;
    startedAt: Date;
    endedAt: Date | null;
    durationSeconds: number;
    model: string;
    tokens: number;
  }[];
  dateRange: {
    start: Date;
    end: Date;
  };
}

// Enriched session (from Agent SDK analysis)
export interface EnrichedSession {
  sessionId: string;
  enrichedAt: Date;
  summary: string;
  decisions: string[];
  problems: { issue: string; solution: string }[];
  knowledge: string[];
  tags: string[];
  sentiment: 'productive' | 'challenging' | 'exploratory' | 'maintenance';
}

// Knowledge base search result
export interface KnowledgeSearchResult {
  sessionId: string;
  projectName: string;
  date: Date;
  matchType: 'summary' | 'file' | 'error' | 'tool' | 'enriched';
  snippet: string;
  relevanceScore: number;
}

// Issue tracking
export interface TrackedIssue {
  id: string;
  pattern: string;
  errorMessage: string;
  occurrences: {
    sessionId: string;
    timestamp: Date;
    context?: string;
  }[];
  firstSeen: Date;
  lastSeen: Date;
  status: 'open' | 'resolved' | 'recurring';
  resolution?: {
    sessionId: string;
    timestamp: Date;
    description?: string;
  };
}
