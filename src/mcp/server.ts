import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SessionParser } from '../services/parser.js';
import { enricher } from '../services/enricher.js';

const parser = new SessionParser();

// Create MCP server
const server = new Server(
  {
    name: 'claude-sesh',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const tools = [
  {
    name: 'search_sessions',
    description: 'Search across all Claude Code sessions by query text. Searches summaries, file names, project names, and enriched data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_session',
    description: 'Get detailed information about a specific session by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to retrieve',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'get_project_context',
    description: 'Get rich context for a project including recent sessions, decisions, todos, and accumulated knowledge',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Project path or name to get context for',
        },
        limit: {
          type: 'number',
          description: 'Number of recent sessions to include (default: 10)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'get_pending_todos',
    description: 'Get all pending/incomplete todos across sessions, optionally filtered by project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Filter by project name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max sessions to check (default: 50)',
        },
      },
    },
  },
  {
    name: 'search_decisions',
    description: 'Search through past decisions made in sessions. Useful for "why did we choose X?" questions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query for decisions',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search through accumulated knowledge from past sessions. Useful for finding solutions to similar problems.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query for knowledge',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_file_history',
    description: 'Get the history of changes to a specific file across sessions',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Full or partial file path to search for',
        },
        limit: {
          type: 'number',
          description: 'Max sessions to return (default: 20)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'get_recent_activity',
    description: 'Get a summary of recent coding activity across all projects',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
        },
      },
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_sessions': {
        const query = (args?.query as string) || '';
        const project = args?.project as string | undefined;
        const limit = (args?.limit as number) || 10;

        const results = searchSessions(query, project, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_session': {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          return {
            content: [{ type: 'text', text: 'Error: sessionId is required' }],
            isError: true,
          };
        }

        const session = parser.getSession(sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: `Session not found: ${sessionId}` }],
            isError: true,
          };
        }

        const enriched = enricher.getEnrichedData(sessionId);
        const todos = parser.getSessionTodos(sessionId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...session,
              startedAt: session.startedAt.toISOString(),
              endedAt: session.endedAt?.toISOString(),
              enriched,
              todos,
            }, null, 2),
          }],
        };
      }

      case 'get_project_context': {
        const projectPath = args?.projectPath as string;
        const limit = (args?.limit as number) || 10;

        if (!projectPath) {
          return {
            content: [{ type: 'text', text: 'Error: projectPath is required' }],
            isError: true,
          };
        }

        const context = getProjectContext(projectPath, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(context, null, 2) }],
        };
      }

      case 'get_pending_todos': {
        const project = args?.project as string | undefined;
        const limit = (args?.limit as number) || 50;

        const todos = getPendingTodos(project, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(todos, null, 2) }],
        };
      }

      case 'search_decisions': {
        const query = (args?.query as string) || '';
        const project = args?.project as string | undefined;
        const limit = (args?.limit as number) || 20;

        const decisions = searchDecisions(query, project, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(decisions, null, 2) }],
        };
      }

      case 'search_knowledge': {
        const query = (args?.query as string) || '';
        const project = args?.project as string | undefined;
        const limit = (args?.limit as number) || 20;

        const knowledge = searchKnowledge(query, project, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(knowledge, null, 2) }],
        };
      }

      case 'get_file_history': {
        const filePath = args?.filePath as string;
        const limit = (args?.limit as number) || 20;

        if (!filePath) {
          return {
            content: [{ type: 'text', text: 'Error: filePath is required' }],
            isError: true,
          };
        }

        const history = getFileHistory(filePath, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(history, null, 2) }],
        };
      }

      case 'get_recent_activity': {
        const days = (args?.days as number) || 7;

        const activity = getRecentActivity(days);
        return {
          content: [{ type: 'text', text: JSON.stringify(activity, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
});

// ==================== Tool Implementation Functions ====================

function searchSessions(query: string, project?: string, limit = 10) {
  const sessions = parser.getAllSessions(500);
  const queryLower = query.toLowerCase();

  const results = sessions
    .filter(s => {
      // Project filter
      if (project && !s.projectName.toLowerCase().includes(project.toLowerCase())) {
        return false;
      }

      // Text search across multiple fields (metadata)
      const searchableText = [
        s.projectName,
        s.projectPath,
        ...s.summaries,
        ...s.filesRead,
        ...s.filesWritten,
        ...s.filesEdited,
        s.gitBranch || '',
      ].join(' ').toLowerCase();

      if (searchableText.includes(queryLower)) {
        return true;
      }

      // Also search enriched data
      const enriched = enricher.getEnrichedData(s.id);
      if (enriched) {
        const enrichedText = [
          enriched.summary || '',
          ...(enriched.decisions || []),
          ...(enriched.problems || []),
          ...(enriched.knowledge || []),
          ...(enriched.tags || []),
        ].join(' ').toLowerCase();

        if (enrichedText.includes(queryLower)) {
          return true;
        }
      }

      // Search raw message content (user messages only for speed)
      const messages = parser.getRawMessages(s.id);
      for (const msg of messages) {
        if (msg.type === 'user' && msg.message?.content) {
          const content = typeof msg.message.content === 'string'
            ? msg.message.content
            : JSON.stringify(msg.message.content);
          if (content.toLowerCase().includes(queryLower)) {
            return true;
          }
        }
      }

      return false;
    })
    .slice(0, limit)
    .map(s => {
      const enriched = enricher.getEnrichedData(s.id);
      return {
        id: s.id,
        project: s.projectName,
        date: s.startedAt.toISOString(),
        summary: enriched?.summary || s.summaries[0] || 'No summary',
        tokens: s.totalTokens,
        duration: formatDuration(s.durationSeconds),
        model: s.model,
      };
    });

  return {
    query,
    resultCount: results.length,
    results,
  };
}

function getProjectContext(projectPath: string, limit = 10) {
  // Normalize project path for matching
  const normalizedPath = projectPath.toLowerCase().replace(/\//g, '-').replace(/^-/, '');

  const sessions = parser.getAllSessions(200)
    .filter(s => {
      const sessionPath = s.projectPath.toLowerCase().replace(/\//g, '-');
      return sessionPath.includes(normalizedPath) || s.projectName.toLowerCase().includes(projectPath.toLowerCase());
    })
    .slice(0, limit);

  if (sessions.length === 0) {
    return {
      found: false,
      message: `No sessions found for project: ${projectPath}`,
    };
  }

  // Aggregate data from sessions
  const allDecisions: string[] = [];
  const allKnowledge: string[] = [];
  const allProblems: string[] = [];
  const pendingTodos: Array<{ content: string; sessionId: string; date: string }> = [];

  for (const session of sessions) {
    const enriched = enricher.getEnrichedData(session.id);
    if (enriched) {
      allDecisions.push(...(enriched.decisions || []));
      allKnowledge.push(...(enriched.knowledge || []));
      // Map problem objects to readable strings
      const problemStrings = (enriched.problems || []).map(p => `${p.issue}: ${p.solution}`);
      allProblems.push(...problemStrings);
    }

    const todos = parser.getSessionTodos(session.id);
    const pending = todos.filter(t => t.status !== 'completed');
    for (const todo of pending) {
      pendingTodos.push({
        content: todo.content,
        sessionId: session.id,
        date: session.startedAt.toISOString(),
      });
    }
  }

  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);

  return {
    found: true,
    project: sessions[0].projectPath,
    sessionCount: sessions.length,
    totalTokens,
    totalDuration: formatDuration(totalDuration),
    recentSessions: sessions.slice(0, 5).map(s => ({
      id: s.id,
      date: s.startedAt.toISOString(),
      summary: enricher.getEnrichedData(s.id)?.summary || s.summaries[0] || 'No summary',
      tokens: s.totalTokens,
    })),
    keyDecisions: [...new Set(allDecisions)].slice(0, 10),
    accumulatedKnowledge: [...new Set(allKnowledge)].slice(0, 10),
    problemsSolved: [...new Set(allProblems)].slice(0, 10),
    pendingTodos: pendingTodos.slice(0, 10),
  };
}

function getPendingTodos(project?: string, limit = 50) {
  const sessions = parser.getAllSessions(limit);
  const pendingTodos: Array<{
    content: string;
    sessionId: string;
    project: string;
    date: string;
  }> = [];

  for (const session of sessions) {
    // Project filter
    if (project && !session.projectName.toLowerCase().includes(project.toLowerCase())) {
      continue;
    }

    const todos = parser.getSessionTodos(session.id);
    const pending = todos.filter(t => t.status !== 'completed');

    for (const todo of pending) {
      pendingTodos.push({
        content: todo.content,
        sessionId: session.id,
        project: session.projectName,
        date: session.startedAt.toISOString(),
      });
    }
  }

  return {
    count: pendingTodos.length,
    todos: pendingTodos,
  };
}

function searchDecisions(query: string, project?: string, limit = 20) {
  const sessions = parser.getAllSessions(200);
  const queryLower = query.toLowerCase();

  const matchingDecisions: Array<{
    decision: string;
    sessionId: string;
    project: string;
    date: string;
    context?: string;
  }> = [];

  for (const session of sessions) {
    // Project filter
    if (project && !session.projectName.toLowerCase().includes(project.toLowerCase())) {
      continue;
    }

    const enriched = enricher.getEnrichedData(session.id);
    if (!enriched?.decisions) continue;

    for (const decision of enriched.decisions) {
      if (decision.toLowerCase().includes(queryLower)) {
        matchingDecisions.push({
          decision,
          sessionId: session.id,
          project: session.projectName,
          date: session.startedAt.toISOString(),
          context: enriched.summary,
        });
      }
    }

    if (matchingDecisions.length >= limit) break;
  }

  return {
    query,
    count: matchingDecisions.length,
    decisions: matchingDecisions.slice(0, limit),
  };
}

function searchKnowledge(query: string, project?: string, limit = 20) {
  const sessions = parser.getAllSessions(200);
  const queryLower = query.toLowerCase();

  const matchingKnowledge: Array<{
    knowledge: string;
    sessionId: string;
    project: string;
    date: string;
    relatedProblems?: string[];
  }> = [];

  for (const session of sessions) {
    // Project filter
    if (project && !session.projectName.toLowerCase().includes(project.toLowerCase())) {
      continue;
    }

    const enriched = enricher.getEnrichedData(session.id);
    if (!enriched?.knowledge) continue;

    for (const item of enriched.knowledge) {
      if (item.toLowerCase().includes(queryLower)) {
        matchingKnowledge.push({
          knowledge: item,
          sessionId: session.id,
          project: session.projectName,
          date: session.startedAt.toISOString(),
          relatedProblems: (enriched.problems || []).map(p => `${p.issue}: ${p.solution}`),
        });
      }
    }

    if (matchingKnowledge.length >= limit) break;
  }

  return {
    query,
    count: matchingKnowledge.length,
    knowledge: matchingKnowledge.slice(0, limit),
  };
}

function getFileHistory(filePath: string, limit = 20) {
  const sessions = parser.getAllSessions(500);
  const filePathLower = filePath.toLowerCase();

  const history: Array<{
    sessionId: string;
    project: string;
    date: string;
    action: 'read' | 'written' | 'edited';
    summary?: string;
  }> = [];

  for (const session of sessions) {
    const actions: Array<{ file: string; action: 'read' | 'written' | 'edited' }> = [
      ...session.filesRead.map(f => ({ file: f, action: 'read' as const })),
      ...session.filesWritten.map(f => ({ file: f, action: 'written' as const })),
      ...session.filesEdited.map(f => ({ file: f, action: 'edited' as const })),
    ];

    for (const { file, action } of actions) {
      if (file.toLowerCase().includes(filePathLower)) {
        history.push({
          sessionId: session.id,
          project: session.projectName,
          date: session.startedAt.toISOString(),
          action,
          summary: enricher.getEnrichedData(session.id)?.summary || session.summaries[0],
        });
      }
    }

    if (history.length >= limit) break;
  }

  // Sort by date, most recent first
  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    file: filePath,
    touchCount: history.length,
    history: history.slice(0, limit),
  };
}

function getRecentActivity(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const sessions = parser.getAllSessions(500)
    .filter(s => s.startedAt >= cutoff);

  // Aggregate by project
  const projectStats = new Map<string, {
    sessions: number;
    tokens: number;
    duration: number;
    lastActive: Date;
  }>();

  for (const session of sessions) {
    const stats = projectStats.get(session.projectName) || {
      sessions: 0,
      tokens: 0,
      duration: 0,
      lastActive: new Date(0),
    };

    stats.sessions++;
    stats.tokens += session.totalTokens;
    stats.duration += session.durationSeconds;
    if (session.startedAt > stats.lastActive) {
      stats.lastActive = session.startedAt;
    }

    projectStats.set(session.projectName, stats);
  }

  // Sort projects by last active
  const projects = Array.from(projectStats.entries())
    .sort((a, b) => b[1].lastActive.getTime() - a[1].lastActive.getTime())
    .map(([name, stats]) => ({
      name,
      sessions: stats.sessions,
      tokens: stats.tokens,
      duration: formatDuration(stats.duration),
      lastActive: stats.lastActive.toISOString(),
    }));

  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);

  return {
    period: `Last ${days} days`,
    totalSessions: sessions.length,
    totalTokens,
    totalDuration: formatDuration(totalDuration),
    activeProjects: projects.length,
    projects: projects.slice(0, 10),
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Start the server
export async function startMCPServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('claude-sesh MCP server running');
}

// Run if executed directly
startMCPServer().catch(console.error);
