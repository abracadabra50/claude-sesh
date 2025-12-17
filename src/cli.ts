#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { parser, formatModelName } from './services/parser.js';
import type { ParsedSession, SessionStats } from './types/index.js';

// Claude's warm color palette
const colors = {
  beige: chalk.hex('#F5F1EB'),
  sand: chalk.hex('#E8DFD5'),
  stone: chalk.hex('#C9BFB1'),
  warmGray: chalk.hex('#9A8F82'),
  brown: chalk.hex('#6B5D4D'),
  accent: chalk.hex('#D4A574'),
  success: chalk.hex('#7FB069'),
  error: chalk.hex('#E57373'),
  info: chalk.hex('#81B1D4'),
};

const program = new Command();

program
  .name('sesh')
  .description('🗓️  Claude Session Viewer - Beautiful insights into your Claude Code sessions')
  .version('1.0.0');

// List sessions
program
  .command('list')
  .alias('ls')
  .description('List recent sessions')
  .option('-n, --limit <number>', 'Number of sessions to show', '20')
  .option('-p, --project <path>', 'Filter by project path')
  .action((options) => {
    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🗓️  Claude Sessions                  ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    const limit = parseInt(options.limit, 10);
    const sessions = options.project
      ? parser.getProjectSessions(options.project, limit)
      : parser.getAllSessions(limit);

    if (sessions.length === 0) {
      console.log(colors.warmGray('  No sessions found.'));
      return;
    }

    for (const session of sessions) {
      printSessionCard(session);
    }

    console.log();
    console.log(colors.stone(`  Showing ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`));
    console.log();
  });

// Show session details
program
  .command('show <sessionId>')
  .description('Show detailed session information')
  .action((sessionId) => {
    const session = parser.getSession(sessionId);

    if (!session) {
      console.log(colors.error(`  Session not found: ${sessionId}`));
      return;
    }

    printSessionDetails(session);
  });

// Show resume context or resume natively
program
  .command('resume [sessionId]')
  .description('Resume a session (uses Claude\'s native --resume if no context needed)')
  .option('-c, --copy', 'Copy rich context to clipboard')
  .option('-n, --native', 'Use Claude\'s native resume (claude --resume)')
  .option('-f, --fork', 'Fork the session instead of continuing it')
  .action(async (sessionId, options) => {
    const { execSync, spawn } = await import('child_process');

    // If no sessionId, show resumable sessions picker
    if (!sessionId) {
      const resumable = parser.getResumableSessions(10);

      if (resumable.length === 0) {
        console.log(colors.stone('  No resumable sessions found.'));
        return;
      }

      console.log();
      console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
      console.log(colors.accent('  │') + colors.beige('     🔄 Sessions to Resume                ') + colors.accent('│'));
      console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
      console.log();

      resumable.forEach((s, i) => {
        const timeAgo = formatTimeAgo(s.startedAt);
        console.log(colors.accent(`  ${i + 1}. `) + colors.beige(s.projectName));
        console.log(colors.stone(`     ${s.resumeReason} • ${timeAgo}`));
        console.log(colors.warmGray(`     ID: ${s.id.slice(0, 12)}...`));
        console.log();
      });

      console.log(colors.stone('  Run: sesh resume <sessionId> --native'));
      console.log();
      return;
    }

    const session = parser.getSession(sessionId);
    if (!session) {
      console.log(colors.error(`  Session not found: ${sessionId}`));
      return;
    }

    // Native resume using Claude's built-in --resume
    if (options.native) {
      console.log();
      console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
      console.log(colors.accent('  │') + colors.beige('     🔄 Native Resume                     ') + colors.accent('│'));
      console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
      console.log();
      console.log(colors.beige('  Project: ') + colors.accent(session.projectName));
      console.log(colors.beige('  Session: ') + colors.info(sessionId.slice(0, 20) + '...'));
      console.log();

      const args = ['--resume', sessionId];
      if (options.fork) args.push('--fork-session');

      console.log(colors.stone(`  Starting: claude ${args.join(' ')}`));
      console.log();

      // Change to project directory and spawn claude
      try {
        const claude = spawn('claude', args, {
          cwd: session.projectPath,
          stdio: 'inherit',
          shell: true,
        });

        claude.on('error', (err) => {
          console.log(colors.error(`  Failed to start Claude: ${err.message}`));
        });
      } catch (err) {
        console.log(colors.error(`  Error: ${err}`));
      }
      return;
    }

    // Build rich context
    const context = parser.buildResumeContext(sessionId);
    if (!context) {
      console.log(colors.error(`  Could not build resume context`));
      return;
    }

    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     📋 Resume Context                    ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();
    console.log(colors.beige(context.split('\n').map(l => '  ' + l).join('\n')));
    console.log();

    if (options.copy) {
      try {
        execSync('pbcopy', { input: context });
        console.log(colors.success('  ✓ Copied to clipboard!'));
        console.log();
      } catch {
        console.log(colors.error('  Failed to copy to clipboard'));
      }
    }

    console.log(colors.stone('  Tip: Use --native to resume with Claude\'s built-in resume'));
    console.log(colors.warmGray(`  sesh resume ${sessionId} --native`));
    console.log();
  });

// List resumable sessions
program
  .command('continue')
  .alias('c')
  .description('Show sessions you might want to continue')
  .option('-l, --limit <n>', 'Number of sessions to show', '10')
  .action((options) => {
    const limit = parseInt(options.limit, 10) || 10;
    const resumable = parser.getResumableSessions(limit);

    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🔄 Continue Where You Left Off       ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    if (resumable.length === 0) {
      console.log(colors.stone('  No sessions with pending work found.'));
      console.log();
      return;
    }

    resumable.forEach((s, i) => {
      const timeAgo = formatTimeAgo(s.startedAt);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';

      console.log(`  ${medal} ` + colors.accent(s.projectName));
      console.log(colors.beige(`     ${s.resumeReason}`));
      console.log(colors.stone(`     ${timeAgo} • ${s.messageCount} msgs • ${formatDuration(s.durationSeconds)}`));
      console.log(colors.warmGray(`     sesh resume ${s.id.slice(0, 12)} --native`));
      console.log();
    });
  });

// Start new session with resume context (legacy)
program
  .command('start <sessionId>')
  .description('Copy resume context to clipboard and show instructions')
  .action(async (sessionId) => {
    const session = parser.getSession(sessionId);
    if (!session) {
      console.log(colors.error(`  Session not found: ${sessionId}`));
      return;
    }

    const context = parser.buildResumeContext(sessionId);
    if (!context) {
      console.log(colors.error(`  Could not build resume context`));
      return;
    }

    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🚀 Starting New Session              ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    const { execSync } = await import('child_process');

    // Copy context to clipboard
    try {
      execSync('pbcopy', { input: context });
      console.log(colors.success('  ✓ Resume context copied to clipboard'));
    } catch {
      console.log(colors.error('  Failed to copy to clipboard'));
    }

    console.log();
    console.log(colors.beige('  Project: ') + colors.accent(session.projectPath));
    console.log(colors.beige('  Branch:  ') + colors.info(session.gitBranch || 'N/A'));
    console.log();
    console.log(colors.stone('  Option 1: Use native resume (recommended):'));
    console.log(colors.warmGray(`  cd ${session.projectPath} && claude --resume ${sessionId}`));
    console.log();
    console.log(colors.stone('  Option 2: Start fresh with context in clipboard:'));
    console.log(colors.warmGray(`  cd ${session.projectPath} && claude`));
    console.log();
  });

// Show stats
program
  .command('stats')
  .description('Show session statistics')
  .action(() => {
    const sessions = parser.getAllSessions(500);
    const stats = calculateStats(sessions);
    printStats(stats);
  });

// List projects
program
  .command('projects')
  .description('List all projects with sessions')
  .action(() => {
    const projects = parser.getProjects();

    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     📁 Projects with Sessions            ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    for (const project of projects) {
      const sessions = parser.getProjectSessions(project, 100);
      const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
      const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0);

      console.log(colors.beige(`  📁 ${project}`));
      console.log(colors.stone(`     ${sessions.length} sessions • ${formatTokens(totalTokens)} tokens • $${totalCost.toFixed(2)}`));
      console.log();
    }
  });

// Start web dashboard
program
  .command('web')
  .description('Start the web dashboard')
  .option('-p, --port <number>', 'Port to run on', '3847')
  .action(async (options) => {
    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🌐 Starting Web Dashboard            ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    const { startServer } = await import('./web/server.js');
    startServer(parseInt(options.port, 10));
  });

// Start MCP server
program
  .command('mcp')
  .description('Start the MCP server for Claude Code integration')
  .action(async () => {
    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🔗 Starting MCP Server               ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();
    console.log(colors.stone('  claude-sesh MCP server starting...'));
    console.log(colors.warmGray('  This exposes your session data to Claude via MCP protocol.'));
    console.log();
    console.log(colors.info('  Available tools:'));
    console.log(colors.stone('  • search_sessions    - Search across all sessions'));
    console.log(colors.stone('  • get_session        - Get detailed session info'));
    console.log(colors.stone('  • get_project_context - Get rich project context'));
    console.log(colors.stone('  • get_pending_todos  - Find incomplete tasks'));
    console.log(colors.stone('  • search_decisions   - Find past decisions'));
    console.log(colors.stone('  • search_knowledge   - Search accumulated learnings'));
    console.log(colors.stone('  • get_file_history   - Track file changes'));
    console.log(colors.stone('  • get_recent_activity - Recent coding activity'));
    console.log();
    console.log(colors.warmGray('  To add to Claude Code:'));
    console.log(colors.beige('  claude mcp add claude-sesh -- npx claude-sesh mcp'));
    console.log();

    const { startMCPServer } = await import('./mcp/server.js');
    await startMCPServer();
  });

// Enrich sessions using Claude AI
program
  .command('enrich')
  .description('Enrich sessions without summaries using Claude AI')
  .option('-n, --limit <number>', 'Number of sessions to enrich', '10')
  .option('--stats', 'Show enrichment statistics only')
  .action(async (options) => {
    const { enricher } = await import('./services/enricher.js');

    console.log();
    console.log(colors.accent('  ╭─────────────────────────────────────────╮'));
    console.log(colors.accent('  │') + colors.beige('     🧠 Session Enrichment                ') + colors.accent('│'));
    console.log(colors.accent('  ╰─────────────────────────────────────────╯'));
    console.log();

    const stats = enricher.getStats();

    if (options.stats) {
      console.log(colors.beige('  Total Sessions:    ') + colors.accent(stats.total.toString()));
      console.log(colors.beige('  Already Enriched:  ') + colors.success(stats.enriched.toString()));
      console.log(colors.beige('  Pending:           ') + colors.info(stats.pending.toString()));
      console.log(colors.beige('  API Available:     ') + (enricher.isAvailable() ? colors.success('Yes') : colors.error('No (set ANTHROPIC_API_KEY)')));
      console.log();
      return;
    }

    // Check if API key is available
    if (!enricher.isAvailable()) {
      console.log(colors.error('  ✗ ANTHROPIC_API_KEY not set'));
      console.log();
      console.log(colors.stone('  To enable enrichment, set your API key:'));
      console.log(colors.warmGray('  export ANTHROPIC_API_KEY=your-api-key'));
      console.log();
      return;
    }

    if (stats.pending === 0) {
      console.log(colors.success('  ✓ All sessions are already enriched!'));
      console.log();
      return;
    }

    const limit = parseInt(options.limit, 10);
    console.log(colors.stone(`  Enriching up to ${limit} sessions...`));
    console.log(colors.warmGray('  Using Claude Haiku for cost-effective analysis'));
    console.log();

    const result = await enricher.enrichBatch(limit, (done, total) => {
      process.stdout.write(`\r  Progress: ${done}/${total} sessions...`);
    });

    console.log();
    console.log();
    console.log(colors.success(`  ✓ Enriched: ${result.enriched}`));
    if (result.failed > 0) {
      console.log(colors.error(`  ✗ Failed:   ${result.failed}`));
    }
    console.log();
    console.log(colors.stone(`  Run 'sesh enrich --stats' to see overall progress`));
    console.log();
  });

function printSessionCard(session: ParsedSession): void {
  const date = session.startedAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const duration = formatDuration(session.durationSeconds);
  const cost = `$${session.estimatedCostUsd.toFixed(2)}`;
  const model = formatModelName(session.model);

  console.log(colors.stone('  ┌────────────────────────────────────────────────────────────┐'));

  // Header with project and date
  console.log(
    colors.stone('  │ ') +
    colors.accent(`📁 ${session.projectName.padEnd(25)}`) +
    colors.warmGray(date.padStart(28)) +
    colors.stone(' │')
  );

  // Summary
  const summary = session.summaries[session.summaries.length - 1] || 'No summary';
  const truncatedSummary = summary.length > 55 ? summary.slice(0, 52) + '...' : summary;
  console.log(
    colors.stone('  │ ') +
    colors.beige(`   ${truncatedSummary.padEnd(55)}`) +
    colors.stone(' │')
  );

  // Stats line
  console.log(
    colors.stone('  │ ') +
    colors.info(`⏱️  ${duration.padEnd(8)}`) +
    colors.success(`💬 ${session.messageCount.toString().padEnd(6)}`) +
    colors.warmGray(`🔧 ${session.toolCallCount.toString().padEnd(6)}`) +
    colors.accent(`${formatTokens(session.totalTokens).padEnd(10)}`) +
    colors.success(cost.padEnd(8)) +
    colors.stone(' │')
  );

  // Session ID (truncated)
  console.log(
    colors.stone('  │ ') +
    colors.warmGray(`   ID: ${session.id.slice(0, 8)}... • ${model}`.padEnd(55)) +
    colors.stone(' │')
  );

  console.log(colors.stone('  └────────────────────────────────────────────────────────────┘'));
  console.log();
}

function printSessionDetails(session: ParsedSession): void {
  console.log();
  console.log(colors.accent('  ╭────────────────────────────────────────────────────────────────╮'));
  console.log(colors.accent('  │') + colors.beige(`     📊 Session Details                                          `) + colors.accent('│'));
  console.log(colors.accent('  ╰────────────────────────────────────────────────────────────────╯'));
  console.log();

  // Basic info
  console.log(colors.beige('  Project:    ') + colors.accent(session.projectName));
  console.log(colors.beige('  Path:       ') + colors.stone(session.projectPath));
  console.log(colors.beige('  Session ID: ') + colors.warmGray(session.id));
  console.log(colors.beige('  Branch:     ') + colors.info(session.gitBranch || 'N/A'));
  console.log(colors.beige('  Model:      ') + colors.accent(formatModelName(session.model)));
  console.log();

  // Time info
  console.log(colors.beige('  Started:    ') + colors.stone(session.startedAt.toLocaleString()));
  console.log(colors.beige('  Ended:      ') + colors.stone(session.endedAt?.toLocaleString() || 'Active'));
  console.log(colors.beige('  Duration:   ') + colors.info(formatDuration(session.durationSeconds)));
  console.log();

  // Token usage
  console.log(colors.accent('  ─── Token Usage ───────────────────────────────────────────────'));
  console.log(colors.beige('  Input:      ') + colors.stone(formatTokens(session.inputTokens)));
  console.log(colors.beige('  Output:     ') + colors.stone(formatTokens(session.outputTokens)));
  console.log(colors.beige('  Total:      ') + colors.accent(formatTokens(session.totalTokens)));
  console.log(colors.beige('  Est. Cost:  ') + colors.success(`$${session.estimatedCostUsd.toFixed(4)}`));
  console.log();

  // Activity
  console.log(colors.accent('  ─── Activity ──────────────────────────────────────────────────'));
  console.log(colors.beige('  Messages:   ') + colors.stone(`${session.messageCount} (${session.userMessageCount} user, ${session.assistantMessageCount} assistant)`));
  console.log(colors.beige('  Tool Calls: ') + colors.stone(session.toolCallCount.toString()));
  console.log(colors.beige('  Errors:     ') + (session.errors.length > 0 ? colors.error(session.errors.length.toString()) : colors.success('0')));
  console.log();

  // Files
  if (session.filesWritten.length > 0 || session.filesEdited.length > 0) {
    console.log(colors.accent('  ─── Files Modified ────────────────────────────────────────────'));
    for (const file of [...session.filesWritten, ...session.filesEdited].slice(0, 10)) {
      console.log(colors.stone('  • ') + colors.beige(file));
    }
    if (session.filesWritten.length + session.filesEdited.length > 10) {
      console.log(colors.warmGray(`  ... and ${session.filesWritten.length + session.filesEdited.length - 10} more`));
    }
    console.log();
  }

  // Summaries
  if (session.summaries.length > 0) {
    console.log(colors.accent('  ─── Session Summaries ─────────────────────────────────────────'));
    for (const summary of session.summaries.slice(-5)) {
      console.log(colors.stone('  • ') + colors.beige(summary));
    }
    console.log();
  }

  // Tool breakdown
  const toolCounts = session.toolCalls.reduce((acc, tc) => {
    acc[tc.name] = (acc[tc.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (Object.keys(toolCounts).length > 0) {
    console.log(colors.accent('  ─── Tools Used ────────────────────────────────────────────────'));
    const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sortedTools.slice(0, 10)) {
      const bar = '█'.repeat(Math.min(20, Math.ceil(count / 2)));
      console.log(colors.stone(`  ${tool.padEnd(15)} `) + colors.info(bar) + colors.warmGray(` ${count}`));
    }
    console.log();
  }
}

function printStats(stats: SessionStats): void {
  console.log();
  console.log(colors.accent('  ╭────────────────────────────────────────────────────────────────╮'));
  console.log(colors.accent('  │') + colors.beige(`     📈 Session Statistics                                       `) + colors.accent('│'));
  console.log(colors.accent('  ╰────────────────────────────────────────────────────────────────╯'));
  console.log();

  // Overview
  console.log(colors.accent('  ─── Overview ──────────────────────────────────────────────────'));
  console.log(colors.beige('  Total Sessions:   ') + colors.accent(stats.totalSessions.toString()));
  console.log(colors.beige('  Total Tokens:     ') + colors.stone(formatTokens(stats.totalTokens)));
  console.log(colors.beige('  Total Cost:       ') + colors.success(`$${stats.totalCost.toFixed(2)}`));
  console.log(colors.beige('  Total Time:       ') + colors.info(formatDuration(stats.totalDuration)));
  console.log(colors.beige('  Avg Duration:     ') + colors.stone(formatDuration(stats.averageSessionDuration)));
  console.log();

  // Today
  console.log(colors.accent('  ─── Today ─────────────────────────────────────────────────────'));
  console.log(colors.beige('  Sessions:         ') + colors.accent(stats.sessionsToday.toString()));
  console.log(colors.beige('  Tokens:           ') + colors.stone(formatTokens(stats.tokensToday)));
  console.log();

  // Project breakdown
  if (stats.projectBreakdown.length > 0) {
    console.log(colors.accent('  ─── Top Projects ──────────────────────────────────────────────'));
    for (const proj of stats.projectBreakdown.slice(0, 5)) {
      console.log(
        colors.stone(`  ${proj.project.padEnd(30)} `) +
        colors.warmGray(`${proj.sessions} sessions`) +
        colors.stone(' • ') +
        colors.info(formatTokens(proj.tokens))
      );
    }
    console.log();
  }

  // Model breakdown
  if (stats.modelBreakdown.length > 0) {
    console.log(colors.accent('  ─── Models Used ───────────────────────────────────────────────'));
    for (const m of stats.modelBreakdown) {
      if (!m.model || m.model === 'unknown') continue;
      const shortName = formatModelName(m.model);
      console.log(
        colors.stone(`  ${shortName.padEnd(25)} `) +
        colors.warmGray(`${m.sessions} sessions`) +
        colors.stone(' • ') +
        colors.info(formatTokens(m.tokens))
      );
    }
    console.log();
  }
}

function calculateStats(sessions: ParsedSession[]): SessionStats {
  const today = new Date().toDateString();

  const projectMap = new Map<string, { sessions: number; tokens: number }>();
  const modelMap = new Map<string, { sessions: number; tokens: number }>();

  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let sessionsToday = 0;
  let tokensToday = 0;

  for (const session of sessions) {
    totalTokens += session.totalTokens;
    totalCost += session.estimatedCostUsd;
    totalDuration += session.durationSeconds;

    if (session.startedAt.toDateString() === today) {
      sessionsToday++;
      tokensToday += session.totalTokens;
    }

    // Project breakdown
    const proj = projectMap.get(session.projectName) || { sessions: 0, tokens: 0 };
    proj.sessions++;
    proj.tokens += session.totalTokens;
    projectMap.set(session.projectName, proj);

    // Model breakdown
    const model = modelMap.get(session.model) || { sessions: 0, tokens: 0 };
    model.sessions++;
    model.tokens += session.totalTokens;
    modelMap.set(session.model, model);
  }

  return {
    totalSessions: sessions.length,
    totalTokens,
    totalCost,
    totalDuration,
    averageSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
    sessionsToday,
    tokensToday,
    projectBreakdown: Array.from(projectMap.entries())
      .map(([project, data]) => ({ project, ...data }))
      .sort((a, b) => b.tokens - a.tokens),
    modelBreakdown: Array.from(modelMap.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.tokens - a.tokens),
    dailyActivity: [],
  };
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

program.parse();
