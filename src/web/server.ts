import express from 'express';
import { parser, formatModelName } from '../services/parser.js';
import { enricher } from '../services/enricher.js';
import { cardsService } from '../services/cards.js';
import { bookmarksService } from '../services/bookmarks.js';
import { LeaderboardService } from '../services/leaderboard.js';
import type { ParsedSession, Leaderboard } from '../types/index.js';

const leaderboardService = new LeaderboardService(parser);

export function startServer(port = 3847): void {
  const app = express();

  // Enable JSON body parsing
  app.use(express.json());

  // Serve static dashboard
  app.get('/', (_req, res) => {
    res.send(getDashboardHTML());
  });

  // API endpoints
  app.get('/api/sessions', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const project = req.query.project as string | undefined;
    const date = req.query.date as string | undefined;
    const search = req.query.search as string | undefined;

    let sessions: ParsedSession[];
    if (date) {
      sessions = parser.getSessionsByDate(date);
    } else if (project) {
      sessions = parser.getProjectSessions(project, limit);
    } else {
      sessions = parser.getAllSessions(limit);
    }

    // Search filter (includes user tags and notes from bookmarks)
    if (search) {
      const q = search.toLowerCase();
      sessions = sessions.filter(s => {
        const bookmark = bookmarksService.getBookmark(s.id);
        const userTags = bookmark?.tags || [];
        const userNote = bookmark?.note || '';

        return s.projectName.toLowerCase().includes(q) ||
          s.summaries.some(sum => sum.toLowerCase().includes(q)) ||
          s.filesWritten.some(f => f.toLowerCase().includes(q)) ||
          s.filesEdited.some(f => f.toLowerCase().includes(q)) ||
          userTags.some(t => t.toLowerCase().includes(q)) ||
          userNote.toLowerCase().includes(q);
      });
    }

    // Return lightweight session data for list view (exclude toolCalls which can be huge)
    const formatted = sessions.map(s => {
      const enrichedData = enricher.getEnrichedData(s.id);
      const bookmark = bookmarksService.getBookmark(s.id);
      return {
        id: s.id,
        projectPath: s.projectPath,
        projectName: s.projectName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationSeconds: s.durationSeconds,
        model: s.model,
        messageCount: s.messageCount,
        toolCallCount: s.toolCallCount,
        totalTokens: s.totalTokens,
        estimatedCostUsd: s.estimatedCostUsd,
        summaries: s.summaries,
        filesWritten: s.filesWritten?.slice(0, 5),  // Limit to first 5
        filesEdited: s.filesEdited?.slice(0, 5),    // Limit to first 5
        errors: s.errors?.slice(0, 3),              // Limit to first 3
        // Formatted fields
        modelFormatted: formatModelName(s.model),
        durationFormatted: formatDuration(s.durationSeconds),
        costFormatted: `$${s.estimatedCostUsd.toFixed(2)}`,
        tokensFormatted: formatTokens(s.totalTokens),
        startedAtFormatted: s.startedAt.toLocaleString(),
        dateKey: s.startedAt.toISOString().split('T')[0],
        timeFormatted: s.startedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        enriched: enrichedData,
        // Bookmark data
        starred: bookmark?.starred || false,
        userTags: bookmark?.tags || [],
        userNote: bookmark?.note || '',
      };
    });

    res.json(formatted);
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = parser.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({
      ...session,
      modelFormatted: formatModelName(session.model),
      durationFormatted: formatDuration(session.durationSeconds),
      costFormatted: `$${session.estimatedCostUsd.toFixed(2)}`,
      tokensFormatted: formatTokens(session.totalTokens),
    });
  });

  app.get('/api/sessions/:id/resume', (req, res) => {
    const context = parser.buildResumeContext(req.params.id);
    if (!context) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ context });
  });

  app.get('/api/projects', (_req, res) => {
    const projects = parser.getProjects();
    const projectData = projects.map(p => {
      const sessions = parser.getProjectSessions(p, 100);
      return {
        path: p,
        name: p.split('/').pop(),
        sessionCount: sessions.length,
        totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
        totalCost: sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0),
        lastActive: sessions[0]?.startedAt || null,
      };
    });
    res.json(projectData);
  });

  app.get('/api/stats', (_req, res) => {
    const sessions = parser.getAllSessions(500);
    const stats = calculateStats(sessions);
    res.json(stats);
  });

  // NEW: Heatmap endpoint
  app.get('/api/heatmap', (req, res) => {
    const weeks = parseInt(req.query.weeks as string, 10) || 52;
    const heatmapData = parser.getHeatmapData(weeks);
    res.json(heatmapData);
  });

  // NEW: Timeline endpoint
  app.get('/api/timeline', (req, res) => {
    const days = parseInt(req.query.days as string, 10) || 30;
    const timelineData = parser.getTimelineData(days);
    res.json(timelineData);
  });

  // NEW: Leaderboard endpoint
  app.get('/api/leaderboard/:type', (req, res) => {
    const type = req.params.type as Leaderboard['type'];
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const leaderboard = parser.getLeaderboard(type, limit);
    res.json(leaderboard);
  });

  // NEW: Resumable sessions endpoint
  app.get('/api/resumable', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const resumable = parser.getResumableSessions(limit);
    const formatted = resumable.map(s => ({
      id: s.id,
      projectName: s.projectName,
      projectPath: s.projectPath,
      startedAt: s.startedAt,
      durationSeconds: s.durationSeconds,
      messageCount: s.messageCount,
      resumeReason: s.resumeReason,
      resumeScore: s.resumeScore,
      model: s.model,
      modelFormatted: formatModelName(s.model),
      durationFormatted: formatDuration(s.durationSeconds),
      timeAgo: formatTimeAgo(s.startedAt),
    }));
    res.json(formatted);
  });

  // NEW: Daily activity endpoint
  app.get('/api/activity', (_req, res) => {
    const dailyActivity = parser.getDailyActivity();
    res.json(dailyActivity);
  });

  // NEW: Plans endpoint
  app.get('/api/plans', (_req, res) => {
    const plans = parser.getPlanFiles();
    res.json(plans.map(p => ({
      name: p.name,
      path: p.path,
      size: p.size,
      createdAt: p.createdAt,
      modifiedAt: p.modifiedAt,
      preview: p.content.slice(0, 500),
    })));
  });

  // NEW: Enrichment endpoints
  app.get('/api/enrich/stats', (_req, res) => {
    const stats = enricher.getStats();
    res.json({
      ...stats,
      available: enricher.isAvailable()
    });
  });

  app.get('/api/enrich/:sessionId', (req, res) => {
    const enriched = enricher.getEnrichedData(req.params.sessionId);
    if (!enriched) {
      res.status(404).json({ error: 'No enriched data found' });
      return;
    }
    res.json(enriched);
  });

  app.post('/api/enrich/:sessionId', async (req, res) => {
    try {
      const enriched = await enricher.enrichSession(req.params.sessionId);
      if (!enriched) {
        res.status(400).json({ error: 'Failed to enrich session' });
        return;
      }
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: 'Enrichment failed', details: String(error) });
    }
  });

  app.get('/api/enriched', (_req, res) => {
    const all = enricher.getAllEnriched();
    res.json(all);
  });

  // Stats Cards API
  app.get('/api/cards', (req, res) => {
    const period = (req.query.period as 'week' | 'month' | 'year' | 'all') || 'month';
    const cards = cardsService.getAllCards(period);
    res.json(cards);
  });

  app.get('/api/cards/summary', (req, res) => {
    const period = (req.query.period as 'week' | 'month' | 'year' | 'all') || 'month';
    res.json(cardsService.getSummaryCard(period));
  });

  app.get('/api/cards/languages', (req, res) => {
    const period = (req.query.period as 'week' | 'month' | 'year' | 'all') || 'month';
    res.json(cardsService.getLanguagesCard(period));
  });

  app.get('/api/cards/rhythm', (req, res) => {
    const period = (req.query.period as 'week' | 'month' | 'year' | 'all') || 'month';
    res.json(cardsService.getRhythmCard(period));
  });

  app.get('/api/cards/achievement', (_req, res) => {
    res.json(cardsService.getAchievementCard());
  });

  app.get('/api/cards/wrapped', (req, res) => {
    const period = (req.query.period as 'week' | 'month' | 'year' | 'all') || 'month';
    res.json(cardsService.getWrappedCard(period));
  });

  // Bookmarks API
  app.get('/api/bookmarks', (_req, res) => {
    res.json(bookmarksService.getAllBookmarks());
  });

  app.get('/api/bookmarks/starred', (_req, res) => {
    res.json(bookmarksService.getStarredSessions());
  });

  app.get('/api/bookmarks/tags', (_req, res) => {
    res.json(bookmarksService.getAllTags());
  });

  app.get('/api/bookmarks/:sessionId', (req, res) => {
    const bookmark = bookmarksService.getBookmark(req.params.sessionId);
    res.json(bookmark || { sessionId: req.params.sessionId, starred: false, tags: [], note: '' });
  });

  app.post('/api/bookmarks/:sessionId/star', (req, res) => {
    const starred = bookmarksService.toggleStar(req.params.sessionId);
    res.json({ starred });
  });

  app.post('/api/bookmarks/:sessionId/tags', (req, res) => {
    const { tag } = req.body;
    if (!tag) {
      res.status(400).json({ error: 'Tag is required' });
      return;
    }
    const tags = bookmarksService.addTag(req.params.sessionId, tag);
    res.json({ tags });
  });

  app.delete('/api/bookmarks/:sessionId/tags/:tag', (req, res) => {
    const tags = bookmarksService.removeTag(req.params.sessionId, req.params.tag);
    res.json({ tags });
  });

  app.post('/api/bookmarks/:sessionId/note', (req, res) => {
    const { note } = req.body;
    bookmarksService.setNote(req.params.sessionId, note || '');
    res.json({ note: bookmarksService.getNote(req.params.sessionId) });
  });

  // Global Leaderboard API
  app.get('/api/global-leaderboard', (req, res) => {
    const category = (req.query.category as 'tokens' | 'sessions' | 'streak' | 'languages' | 'hours') || 'tokens';
    const leaderboard = leaderboardService.getLeaderboard(category);
    const userStats = leaderboardService.getUserStats();
    const submission = leaderboardService.getSubmission();
    const achievement = leaderboardService.getAchievementTitle();

    res.json({
      ...leaderboard,
      userStats,
      submission,
      achievement,
      percentile: leaderboardService.getPercentile(category)
    });
  });

  app.post('/api/global-leaderboard/submit', (req, res) => {
    const { displayName } = req.body;
    const submission = leaderboardService.submitStats(displayName || 'anonymous');
    res.json({ success: true, submission });
  });

  app.post('/api/global-leaderboard/remove', (_req, res) => {
    leaderboardService.removeSubmission();
    res.json({ success: true });
  });

  app.listen(port, () => {
    console.log(`  🌐 Dashboard running at http://localhost:${port}`);
    console.log();

    // Pre-warm the session cache in background
    setImmediate(() => {
      const start = Date.now();
      const sessions = parser.getAllSessions(50);
      console.log(`  ⚡ Cache warmed: ${sessions.length} sessions loaded in ${Date.now() - start}ms`);
    });
  });
}

function calculateStats(sessions: ParsedSession[]) {
  const today = new Date().toDateString();

  let totalTokens = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let sessionsToday = 0;
  let tokensToday = 0;

  const modelMap = new Map<string, { sessions: number; tokens: number }>();

  for (const session of sessions) {
    totalTokens += session.totalTokens;
    totalCost += session.estimatedCostUsd;
    totalDuration += session.durationSeconds;

    if (session.startedAt.toDateString() === today) {
      sessionsToday++;
      tokensToday += session.totalTokens;
    }

    const model = formatModelName(session.model);
    const existing = modelMap.get(model) || { sessions: 0, tokens: 0 };
    existing.sessions++;
    existing.tokens += session.totalTokens;
    modelMap.set(model, existing);
  }

  return {
    totalSessions: sessions.length,
    totalTokens,
    totalTokensFormatted: formatTokens(totalTokens),
    totalCost,
    totalCostFormatted: `$${totalCost.toFixed(2)}`,
    totalDuration,
    totalDurationFormatted: formatDuration(totalDuration),
    averageSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
    averageDurationFormatted: formatDuration(sessions.length > 0 ? totalDuration / sessions.length : 0),
    sessionsToday,
    tokensToday,
    tokensTodayFormatted: formatTokens(tokensToday),
    modelBreakdown: Array.from(modelMap.entries())
      .filter(([m]) => m && m !== 'Unknown')
      .map(([model, data]) => ({
        model,
        sessions: data.sessions,
        tokens: data.tokens,
        tokensFormatted: formatTokens(data.tokens),
      }))
      .sort((a, b) => b.tokens - a.tokens),
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
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>claude-sesh</title>
  <style>
    :root {
      --bg: #F0EEE6;
      --bg-card: #FDFCF9;
      --bg-hover: #E8E6DE;
      --text: #141413;
      --text-secondary: #57534E;
      --text-muted: #A8A29E;
      --accent: #C6613F;
      --accent-light: #D97757;
      --accent-soft: #FBE0DD;
      --border: #D6D3CB;
      --success: #059669;
      --radius: 12px;
      --radius-sm: 8px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
    }

    .app { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }

    /* Header */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }

    .logo { display: flex; align-items: center; gap: 14px; }

    .logo-mark {
      width: 42px; height: 42px;
      background: var(--text);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
      font-size: 16px;
      font-weight: 600;
      color: var(--bg);
      letter-spacing: -1px;
    }

    .logo h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.5px; }

    /* Navigation */
    nav {
      display: flex;
      gap: 4px;
      background: var(--bg-card);
      padding: 4px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }

    nav button {
      padding: 10px 20px;
      border: none;
      background: transparent;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }

    nav button:hover { background: var(--bg-hover); color: var(--text); }
    nav button.active { background: var(--accent); color: white; }

    /* Views */
    .view { display: none; }
    .view.active { display: block; }

    /* Stats Grid */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }

    @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); } }

    .stat {
      background: var(--bg-card);
      border-radius: var(--radius);
      padding: 20px;
      border: 1px solid var(--border);
    }

    .stat-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .stat-value { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; }
    .stat-sub { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
    .stat.highlight .stat-value { color: var(--accent); }
    .stat.success .stat-value { color: var(--success); }

    /* Heatmap */
    .heatmap-container {
      background: var(--bg-card);
      border-radius: var(--radius);
      padding: 24px;
      border: 1px solid var(--border);
      margin-bottom: 32px;
      overflow-x: auto;
    }

    .heatmap-container.full-width {
      padding: 32px;
    }

    .heatmap-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .heatmap {
      display: flex;
      gap: 4px;
    }

    .heatmap.large { gap: 5px; }

    .heatmap-week {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .heatmap.large .heatmap-week { gap: 5px; }

    .heatmap-cell {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      background: var(--bg-hover);
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.1s;
    }

    .heatmap.large .heatmap-cell {
      width: 18px;
      height: 18px;
      border-radius: 4px;
    }

    .heatmap-cell:hover { transform: scale(1.2); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .heatmap-cell.level-1 { background: #FBE0DD; }
    .heatmap-cell.level-2 { background: #F5A89A; }
    .heatmap-cell.level-3 { background: #D97757; }
    .heatmap-cell.level-4 { background: #C6613F; }

    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .heatmap-legend span { display: flex; align-items: center; gap: 4px; }

    .heatmap-days {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-right: 10px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .heatmap-days.large { gap: 5px; font-size: 12px; }

    .heatmap-day { height: 14px; display: flex; align-items: center; }
    .heatmap-days.large .heatmap-day { height: 18px; }

    /* Tooltip */
    .tooltip {
      position: fixed;
      background: var(--text);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      display: none;
      max-width: 250px;
    }

    .tooltip.show { display: block; }

    /* Section */
    .section { margin-bottom: 32px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
    .section-title { font-size: 18px; font-weight: 600; }
    .section-subtitle { font-size: 13px; color: var(--text-muted); }

    /* Continue Working Section */
    .continue-section { background: linear-gradient(135deg, var(--bg-card) 0%, rgba(207, 135, 77, 0.05) 100%); padding: 20px; border-radius: var(--radius-lg); border: 1px solid var(--border); }
    .continue-cards { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
    .continue-card {
      min-width: 280px;
      max-width: 320px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }
    .continue-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .continue-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .continue-card-project { font-weight: 600; font-size: 14px; color: var(--text); }
    .continue-card-badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; background: var(--accent); color: white; white-space: nowrap; }
    .continue-card-reason { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
    .continue-card-meta { font-size: 12px; color: var(--text-light); display: flex; gap: 12px; }
    .continue-card-actions { display: flex; gap: 8px; margin-top: 12px; }
    .continue-btn {
      flex: 1;
      padding: 8px 12px;
      border-radius: var(--radius);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
    }
    .continue-btn:hover { background: var(--bg-hover); }
    .continue-btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
    .continue-btn.primary:hover { background: var(--accent-dark); }

    /* Search & Filters */
    .search-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 250px;
      padding: 12px 16px;
      padding-left: 44px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 14px;
      background: var(--bg-card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23A8A29E'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'/%3E%3C/svg%3E") 14px center/20px no-repeat;
      transition: all 0.2s;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .date-picker {
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: 14px;
      background: var(--bg-card);
      cursor: pointer;
    }

    .date-picker:focus {
      outline: none;
      border-color: var(--accent);
    }

    /* Sessions Container with Day Groups */
    .sessions-container {
      display: flex;
      gap: 24px;
    }

    .date-nav {
      position: sticky;
      top: 24px;
      align-self: flex-start;
      width: 160px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .date-nav-item {
      padding: 10px 14px;
      font-size: 13px;
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .date-nav-item:hover { background: var(--bg-hover); color: var(--text); }
    .date-nav-item.active { background: var(--accent); color: white; font-weight: 600; }
    .date-nav-item .count { opacity: 0.7; font-size: 11px; margin-left: 4px; }

    .sessions-main { flex: 1; min-width: 0; }

    /* Day Group */
    .day-group { margin-bottom: 32px; }

    .day-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 10;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }

    .day-date {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .day-count {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--bg-hover);
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* Sessions */
    .sessions { display: flex; flex-direction: column; gap: 16px; }

    .session {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 0;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: all 0.2s ease;
      overflow: hidden;
      position: relative;
    }

    .session::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--accent);
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .session:hover {
      border-color: var(--accent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }

    .session:hover::before { opacity: 1; }

    .session-inner { padding: 20px; }

    .session-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 14px;
    }

    .session-avatar {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      flex-shrink: 0;
      color: white;
      text-transform: uppercase;
      background: var(--accent);
    }

    .session-avatar.model-opus { background: #7C3AED; }
    .session-avatar.model-sonnet { background: var(--accent); }
    .session-avatar.model-haiku { background: #10B981; }

    .session-main { flex: 1; min-width: 0; }

    .session-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .session-name {
      font-size: 16px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text);
    }

    .session-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .session-time {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .session-time::before { content: '🕐'; font-size: 11px; }

    .session-duration {
      font-size: 13px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .session-duration::before { content: '⏱️'; font-size: 11px; }

    .session-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .session:hover .session-actions { opacity: 1; }

    .session-action-btn {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .session-action-btn:hover {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent);
    }

    .session-badges {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
      align-items: center;
    }

    .session-model {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }

    .session-model.model-opus {
      background: #EDE9FE;
      color: #7C3AED;
    }

    .session-model.model-haiku {
      background: #D1FAE5;
      color: #059669;
    }

    .session-sentiment {
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }

    .sentiment-productive { background: #D1FAE5; color: #059669; }
    .sentiment-challenging { background: #FEE2E2; color: #DC2626; }
    .sentiment-exploratory { background: #DBEAFE; color: #2563EB; }
    .sentiment-maintenance { background: #F3F4F6; color: #6B7280; }

    /* Star/Bookmark button */
    .session-star {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      padding: 4px;
      margin: -4px;
      opacity: 0.3;
      transition: all 0.15s ease;
      line-height: 1;
    }

    .session-star:hover {
      opacity: 1;
      transform: scale(1.15);
    }

    .session-star.starred { opacity: 1; }
    .session:hover .session-star { opacity: 0.6; }
    .session:hover .session-star.starred { opacity: 1; }

    /* Summary section */
    .session-summary {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.7;
      margin-bottom: 14px;
      padding: 12px 14px;
      background: var(--bg);
      border-radius: 10px;
      border-left: 3px solid var(--border);
    }

    .session-summary.has-enriched {
      color: var(--text);
      border-left-color: var(--accent);
      background: var(--accent-soft);
    }

    /* Tags section */
    .session-tags-section {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .session-user-tag {
      background: var(--accent);
      color: white;
      padding: 4px 12px;
      border-radius: 14px;
      font-size: 11px;
      font-weight: 600;
    }

    .session-tag {
      background: var(--bg);
      color: var(--text-secondary);
      padding: 4px 12px;
      border-radius: 14px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--border);
    }

    /* Note indicator */
    .session-note-indicator {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 14px;
      padding: 8px 12px;
      background: #FFFBEB;
      border-radius: 8px;
      border: 1px solid #FDE68A;
    }

    .session-note-indicator::before { content: '📝'; }

    /* Stats grid */
    .session-stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }

    .session-stat-card {
      background: var(--bg);
      border-radius: 10px;
      padding: 12px;
      text-align: center;
    }

    .session-stat-icon {
      font-size: 18px;
      margin-bottom: 4px;
    }

    .session-stat-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
    }

    .session-stat-label {
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .session-stat-card.highlight {
      background: var(--accent-soft);
    }

    .session-stat-card.highlight .session-stat-value {
      color: var(--accent);
    }

    /* Files section */
    .session-files-section {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }

    .session-file {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: var(--bg);
      border-radius: 6px;
      font-size: 11px;
      color: var(--text-secondary);
      font-family: 'SF Mono', Monaco, monospace;
    }

    .session-file.written { border-left: 2px solid #10B981; }
    .session-file.edited { border-left: 2px solid #3B82F6; }

    .session-files-more {
      padding: 4px 10px;
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Legacy support */
    .session-footer { display: none; }
    .session-stats { display: none; }
    .session-tags { display: none; }
    .session-user-tags { display: none; }

    @media (max-width: 600px) {
      .session-stats-grid { grid-template-columns: repeat(2, 1fr); }
      .session-actions { opacity: 1; }
    }

    @media (max-width: 900px) {
      .sessions-container { flex-direction: column; }
      .date-nav { display: none; }
    }

    /* Leaderboard */
    .leaderboard-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .leaderboard-tabs button {
      padding: 8px 16px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }

    .leaderboard-tabs button:hover { border-color: var(--accent); color: var(--text); }
    .leaderboard-tabs button.active { background: var(--accent); color: white; border-color: var(--accent); }

    .leaderboard-table {
      background: var(--bg-card);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      overflow: hidden;
    }

    .leaderboard-row {
      display: grid;
      grid-template-columns: 50px 1fr 120px 100px;
      padding: 14px 20px;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }

    .leaderboard-row:last-child { border-bottom: none; }
    .leaderboard-row.header { background: var(--bg-hover); font-weight: 600; font-size: 12px; color: var(--text-muted); text-transform: uppercase; }

    .leaderboard-rank {
      font-size: 16px;
      font-weight: 600;
    }

    .rank-1 { color: #FFD700; }
    .rank-2 { color: #C0C0C0; }
    .rank-3 { color: #CD7F32; }

    .leaderboard-name { font-weight: 500; }
    .leaderboard-value { font-weight: 600; color: var(--accent); text-align: right; }
    .leaderboard-secondary { font-size: 13px; color: var(--text-muted); text-align: right; }

    /* Leaderboard Mode Toggle */
    .leaderboard-mode-toggle {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--bg);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }

    .mode-btn {
      padding: 8px 16px;
      border: none;
      background: transparent;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
    }

    .mode-btn:hover { color: var(--text); }
    .mode-btn.active { background: var(--bg-card); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .leaderboard-mode { display: none; }
    .leaderboard-mode.active { display: block; }

    /* Global Leaderboard */
    .global-user-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 24px;
    }

    .global-user-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .global-user-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .global-user-achievement {
      font-size: 32px;
    }

    .global-user-name {
      font-size: 18px;
      font-weight: 600;
    }

    .global-user-badge {
      font-size: 13px;
      color: var(--text-muted);
    }

    .global-user-actions {
      display: flex;
      gap: 8px;
    }

    .global-submit-btn {
      padding: 10px 20px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .global-submit-btn:hover { background: var(--accent-light); }

    .global-remove-btn {
      padding: 10px 16px;
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-size: 13px;
      cursor: pointer;
    }

    .global-remove-btn:hover { border-color: #dc2626; color: #dc2626; }

    .global-user-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
    }

    .global-stat {
      text-align: center;
      padding: 12px;
      background: var(--bg);
      border-radius: var(--radius-sm);
    }

    .global-stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--accent);
    }

    .global-stat-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.5px;
    }

    .global-rank-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: var(--accent-soft);
      color: var(--accent);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }

    .global-leaderboard-row {
      display: grid;
      grid-template-columns: 60px 1fr 120px 100px;
      gap: 16px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }

    .global-leaderboard-row:last-child { border-bottom: none; }
    .global-leaderboard-row.header { background: var(--bg-hover); font-weight: 600; font-size: 12px; color: var(--text-muted); text-transform: uppercase; padding: 10px 16px; }
    .global-leaderboard-row.is-user { background: var(--accent-soft); }

    .global-rank {
      font-weight: 700;
      font-size: 16px;
    }

    .global-rank.rank-1 { color: #FFD700; }
    .global-rank.rank-2 { color: #C0C0C0; }
    .global-rank.rank-3 { color: #CD7F32; }

    .global-player {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .global-player-name {
      font-weight: 500;
    }

    .global-player-badge {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--accent);
      color: white;
      border-radius: 10px;
    }

    .submit-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s;
    }

    .submit-modal.visible {
      opacity: 1;
      visibility: visible;
    }

    .submit-modal-content {
      background: var(--bg-card);
      border-radius: var(--radius);
      padding: 32px;
      max-width: 400px;
      width: 90%;
    }

    .submit-modal h3 {
      font-size: 18px;
      margin-bottom: 8px;
    }

    .submit-modal p {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 20px;
    }

    .submit-modal input {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-size: 14px;
      margin-bottom: 16px;
    }

    .submit-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    /* Timeline */
    .timeline-container {
      background: var(--bg-card);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      padding: 24px;
      overflow-x: auto;
    }

    .timeline {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 800px;
    }

    .timeline-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .timeline-project {
      width: 150px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .timeline-track {
      flex: 1;
      height: 28px;
      background: var(--bg-hover);
      border-radius: 4px;
      position: relative;
    }

    .timeline-session {
      position: absolute;
      height: 100%;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 0.2s;
      min-width: 4px;
    }

    .timeline-session:hover { opacity: 0.8; }
    .timeline-session.opus { background: #8B5A2B; }
    .timeline-session.sonnet { background: var(--accent); }
    .timeline-session.haiku { background: #A0826D; }

    .timeline-legend {
      display: flex;
      gap: 20px;
      margin-top: 16px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .timeline-legend-item { display: flex; align-items: center; gap: 6px; }

    .timeline-legend-color {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(6px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .modal-backdrop.open { display: flex; }

    .modal {
      background: var(--bg-card);
      border-radius: 16px;
      width: 100%;
      max-width: 800px;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }

    .modal-header {
      padding: 24px 28px 0;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .modal-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .modal-title-section { flex: 1; }
    .modal-title { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .modal-subtitle { font-size: 13px; color: var(--text-muted); }

    .modal-close {
      width: 36px; height: 36px;
      border: none;
      background: var(--bg-hover);
      border-radius: 10px;
      cursor: pointer;
      font-size: 20px;
      color: var(--text-secondary);
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .modal-close:hover { background: var(--border); color: var(--text); }

    .modal-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border);
      margin: 0 -28px;
      padding: 0 28px;
    }

    .modal-tab {
      padding: 14px 20px;
      border: none;
      background: transparent;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
    }

    .modal-tab:hover { color: var(--text); }

    .modal-tab.active {
      color: var(--accent);
      font-weight: 600;
    }

    .modal-tab.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
      border-radius: 1px 1px 0 0;
    }

    .modal-body { padding: 24px 28px; overflow-y: auto; flex: 1; }

    .modal-panel { display: none; }
    .modal-panel.active { display: block; }

    /* Modal Summary Panel */
    .summary-hero {
      background: linear-gradient(135deg, var(--accent-soft), #fff);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }

    .summary-text {
      font-size: 16px;
      line-height: 1.6;
      color: var(--text);
      margin-bottom: 12px;
    }

    .summary-sentiment {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    .detail-section { margin-bottom: 24px; }
    .detail-section:last-child { margin-bottom: 0; }

    .detail-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .detail-label-icon { font-size: 14px; }

    .detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 600px) { .detail-grid { grid-template-columns: repeat(2, 1fr); } }

    .detail-item {
      background: var(--bg);
      padding: 14px;
      border-radius: var(--radius-sm);
      transition: all 0.15s;
    }

    .detail-item:hover { background: var(--bg-hover); }
    .detail-item-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
    .detail-item-value { font-size: 17px; font-weight: 600; }

    /* Lists */
    .insight-list { display: flex; flex-direction: column; gap: 8px; }

    .insight-item {
      display: flex;
      gap: 10px;
      padding: 12px 14px;
      background: var(--bg);
      border-radius: var(--radius-sm);
      font-size: 13px;
      line-height: 1.5;
    }

    .insight-icon { font-size: 14px; flex-shrink: 0; margin-top: 2px; }

    .problem-item {
      background: var(--bg);
      border-radius: var(--radius-sm);
      padding: 14px;
      margin-bottom: 8px;
    }

    .problem-issue {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 6px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .problem-solution {
      font-size: 12px;
      color: var(--text-secondary);
      padding-left: 22px;
    }

    .files-list { display: flex; flex-direction: column; gap: 6px; }

    .file-item {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      color: var(--text-secondary);
      padding: 10px 14px;
      background: var(--bg);
      border-radius: 8px;
      word-break: break-all;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-item-icon { color: var(--text-muted); }

    /* Tools Panel */
    .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }

    .tool-item {
      background: var(--bg);
      padding: 12px;
      border-radius: var(--radius-sm);
      text-align: center;
    }

    .tool-name { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
    .tool-count { font-size: 18px; font-weight: 700; color: var(--accent); }

    /* Resume Panel */
    .resume-box {
      background: var(--bg);
      border-radius: var(--radius);
      padding: 20px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--text-secondary);
      line-height: 1.6;
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid var(--border);
    }

    .btn {
      padding: 12px 20px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn:hover { background: #A8522F; transform: translateY(-1px); }
    .btn-secondary { background: var(--bg-hover); color: var(--text); }
    .btn-secondary:hover { background: var(--border); }
    .btn-group { display: flex; gap: 10px; margin-top: 16px; }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--text-muted);
      gap: 10px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .spinner {
      width: 18px; height: 18px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    .empty { text-align: center; padding: 48px 20px; color: var(--text-muted); }
    .empty-icon { font-size: 40px; margin-bottom: 12px; }

    /* Command Palette */
    .cmd-palette-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(6px);
      z-index: 200;
      align-items: flex-start;
      justify-content: center;
      padding: 80px 24px 24px;
    }

    .cmd-palette-backdrop.open { display: flex; }

    .cmd-palette {
      background: var(--bg-card);
      border-radius: 16px;
      width: 100%;
      max-width: 640px;
      max-height: 70vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
    }

    .cmd-palette-input-wrapper {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .cmd-palette-icon {
      font-size: 20px;
      color: var(--text-muted);
    }

    .cmd-palette-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 16px;
      color: var(--text);
      outline: none;
    }

    .cmd-palette-input::placeholder { color: var(--text-muted); }

    .cmd-palette-shortcut {
      font-size: 12px;
      color: var(--text-muted);
      padding: 4px 8px;
      background: var(--bg);
      border-radius: 6px;
      font-family: monospace;
    }

    .cmd-palette-results {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .cmd-palette-section {
      padding: 8px 16px;
    }

    .cmd-palette-section-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 4px;
    }

    .cmd-palette-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      margin: 2px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.1s;
    }

    .cmd-palette-item:hover,
    .cmd-palette-item.selected {
      background: var(--bg-hover);
    }

    .cmd-palette-item.selected {
      background: var(--accent-soft);
    }

    .cmd-palette-item-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .cmd-palette-item.selected .cmd-palette-item-icon {
      background: var(--accent-soft);
    }

    .cmd-palette-item-content { flex: 1; min-width: 0; }
    .cmd-palette-item-title { font-size: 14px; font-weight: 500; }
    .cmd-palette-item-subtitle { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .cmd-palette-item-meta {
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .cmd-palette-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
    }

    .cmd-palette-footer kbd {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      margin: 0 2px;
    }

    .cmd-highlight {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 0 2px;
      border-radius: 2px;
    }

    /* Share Cards */
    .share-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
    }

    .share-card {
      border-radius: 20px;
      padding: 32px;
      cursor: pointer;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
      min-height: 280px;
      display: flex;
      flex-direction: column;
    }

    .share-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    }

    .share-card::after {
      content: '📥 Click to download';
      position: absolute;
      bottom: 12px;
      right: 16px;
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.2s;
      background: rgba(0,0,0,0.5);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .share-card:hover::after { opacity: 1; }

    .share-card-summary {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .share-card-languages {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .share-card-rhythm {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .share-card-achievement {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .share-card-wrapped {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .share-card-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }

    .share-card-period {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .share-card-hero {
      font-size: 48px;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 8px;
      color: var(--accent);
    }

    .share-card-hero-label {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 20px;
    }

    .share-card-stats {
      display: flex;
      gap: 20px;
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: auto;
    }

    .share-card-footer {
      margin-top: auto;
      padding-top: 16px;
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Language bars */
    .lang-bars {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 16px 0;
    }

    .lang-bar {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .lang-bar-name {
      width: 90px;
      font-size: 13px;
      font-weight: 500;
    }

    .lang-bar-track {
      flex: 1;
      height: 10px;
      background: var(--border);
      border-radius: 5px;
      overflow: hidden;
    }

    .lang-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 5px;
      transition: width 0.5s ease-out;
    }

    .lang-bar-pct {
      width: 40px;
      font-size: 12px;
      text-align: right;
      opacity: 0.9;
    }

    /* Rhythm card */
    .rhythm-archetype {
      font-size: 36px;
      margin-bottom: 4px;
    }

    .rhythm-label {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .rhythm-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: auto;
    }

    .rhythm-stat {
      background: rgba(255,255,255,0.15);
      padding: 12px;
      border-radius: 10px;
    }

    .rhythm-stat-label {
      font-size: 11px;
      opacity: 0.8;
      margin-bottom: 4px;
    }

    .rhythm-stat-value {
      font-size: 15px;
      font-weight: 600;
    }

    /* Achievement card */
    .achievement-percentile {
      font-size: 64px;
      font-weight: 800;
      line-height: 1;
    }

    .achievement-subtitle {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 24px;
    }

    /* Wrapped card grid */
    .wrapped-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin: 16px 0;
    }

    .wrapped-item {
      text-align: center;
      padding: 12px;
      background: rgba(255,255,255,0.15);
      border-radius: 10px;
    }

    .wrapped-item-value {
      font-size: 20px;
      font-weight: 700;
    }

    .wrapped-item-label {
      font-size: 10px;
      opacity: 0.8;
      text-transform: uppercase;
    }

    .wrapped-highlight {
      grid-column: span 3;
      padding: 16px;
      background: rgba(255,255,255,0.2);
      border-radius: 12px;
      text-align: center;
    }

    .wrapped-highlight-emoji {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .wrapped-highlight-title {
      font-size: 18px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="logo">
        <div class="logo-mark">c/s</div>
        <h1>claude-sesh</h1>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <nav>
          <button class="active" onclick="showView('dashboard')">Dashboard</button>
          <button onclick="showView('timeline')">Timeline</button>
          <button onclick="showView('heatmap')">Heatmap</button>
          <button onclick="showView('leaderboard')">Leaderboard</button>
          <button onclick="showView('share')">Share</button>
        </nav>
        <button onclick="openCmdPalette()" style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--border); background: var(--bg-card); border-radius: var(--radius-sm); font-size: 13px; color: var(--text-muted); cursor: pointer; transition: all 0.2s;" onmouseover="this.style.borderColor='var(--accent)'; this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)'; this.style.color='var(--text-muted)'">
          <span>🔍</span>
          <span style="color: var(--text-secondary);">Search</span>
          <kbd style="background: var(--bg); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px;">⌘K</kbd>
        </button>
      </div>
    </header>

    <!-- Dashboard View -->
    <div class="view active" id="view-dashboard">
      <div class="stats" id="stats">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>

      <div class="heatmap-container full-width" id="mini-heatmap">
        <div class="heatmap-title">
          <span>🗓️ Activity (52 weeks)</span>
          <div class="heatmap-legend">
            <span>Less</span>
            <div class="heatmap-cell"></div>
            <div class="heatmap-cell level-1"></div>
            <div class="heatmap-cell level-2"></div>
            <div class="heatmap-cell level-3"></div>
            <div class="heatmap-cell level-4"></div>
            <span>More</span>
          </div>
        </div>
        <div style="display: flex">
          <div class="heatmap-days large">
            <div class="heatmap-day">Sun</div>
            <div class="heatmap-day">Mon</div>
            <div class="heatmap-day">Tue</div>
            <div class="heatmap-day">Wed</div>
            <div class="heatmap-day">Thu</div>
            <div class="heatmap-day">Fri</div>
            <div class="heatmap-day">Sat</div>
          </div>
          <div class="heatmap large" id="heatmap-grid"></div>
        </div>
        <div id="heatmap-tooltip-area" style="margin-top: 12px; font-size: 13px; color: var(--text-muted); min-height: 20px;">Click a day to filter sessions</div>
      </div>

      <!-- Continue Working Section -->
      <div class="section continue-section" id="continue-section" style="display: none;">
        <div class="section-header">
          <h2 class="section-title">🔄 Continue Working</h2>
          <span class="section-subtitle">Sessions with pending work</span>
        </div>
        <div class="continue-cards" id="continue-cards"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Sessions</h2>
        </div>
        <div class="search-bar">
          <input type="text" class="search-input" id="search-input" placeholder="Search sessions, files, summaries..." oninput="debounceSearch()" />
          <input type="date" class="date-picker" id="date-picker" onchange="jumpToDate(this.value)" />
        </div>
        <div class="sessions-container">
          <nav class="date-nav" id="date-nav"></nav>
          <div class="sessions-main" id="sessions">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline View -->
    <div class="view" id="view-timeline">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Session Timeline (Last 90 Days)</h2>
        </div>
        <div class="timeline-container">
          <div class="timeline" id="timeline"></div>
          <div class="timeline-legend">
            <div class="timeline-legend-item">
              <div class="timeline-legend-color" style="background: #8B5A2B"></div>
              <span>Opus</span>
            </div>
            <div class="timeline-legend-item">
              <div class="timeline-legend-color" style="background: var(--accent)"></div>
              <span>Sonnet</span>
            </div>
            <div class="timeline-legend-item">
              <div class="timeline-legend-color" style="background: #A0826D"></div>
              <span>Haiku</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Heatmap View -->
    <div class="view" id="view-heatmap">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Activity Heatmap (52 Weeks)</h2>
        </div>
        <div class="heatmap-container full-width">
          <div style="display: flex">
            <div class="heatmap-days large">
              <div class="heatmap-day">Sun</div>
              <div class="heatmap-day">Mon</div>
              <div class="heatmap-day">Tue</div>
              <div class="heatmap-day">Wed</div>
              <div class="heatmap-day">Thu</div>
              <div class="heatmap-day">Fri</div>
              <div class="heatmap-day">Sat</div>
            </div>
            <div class="heatmap large" id="full-heatmap-grid"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
            <div style="font-size: 13px; color: var(--text-muted);">Click on a day to see sessions</div>
            <div class="heatmap-legend">
              <span>Less</span>
              <div class="heatmap-cell"></div>
              <div class="heatmap-cell level-1"></div>
              <div class="heatmap-cell level-2"></div>
              <div class="heatmap-cell level-3"></div>
              <div class="heatmap-cell level-4"></div>
              <span>More</span>
            </div>
          </div>
        </div>

        <div id="heatmap-sessions" style="margin-top: 24px"></div>
      </div>
    </div>

    <!-- Leaderboard View -->
    <div class="view" id="view-leaderboard">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Leaderboards</h2>
          <div class="leaderboard-mode-toggle">
            <button class="mode-btn active" onclick="setLeaderboardMode('local')">Local</button>
            <button class="mode-btn" onclick="setLeaderboardMode('global')">Global</button>
          </div>
        </div>

        <!-- Local Leaderboards -->
        <div id="local-leaderboard" class="leaderboard-mode active">
          <div class="leaderboard-tabs" id="leaderboard-tabs">
            <button class="active" onclick="loadLeaderboard('projects')">Projects</button>
            <button onclick="loadLeaderboard('models')">Models</button>
            <button onclick="loadLeaderboard('tools')">Tools</button>
            <button onclick="loadLeaderboard('days')">Days</button>
            <button onclick="loadLeaderboard('sessions')">Sessions</button>
          </div>
          <div id="leaderboard-content">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>

        <!-- Global Leaderboard -->
        <div id="global-leaderboard" class="leaderboard-mode">
          <div class="global-header">
            <div class="global-user-card" id="global-user-card">
              <!-- User stats will be populated here -->
            </div>
          </div>
          <div class="leaderboard-tabs" id="global-tabs">
            <button class="active" onclick="loadGlobalLeaderboard('tokens')">Tokens</button>
            <button onclick="loadGlobalLeaderboard('sessions')">Sessions</button>
            <button onclick="loadGlobalLeaderboard('hours')">Hours</button>
            <button onclick="loadGlobalLeaderboard('streak')">Streak</button>
            <button onclick="loadGlobalLeaderboard('languages')">Languages</button>
          </div>
          <div id="global-content">
            <div class="loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Share View -->
    <div class="view" id="view-share">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">Share Your Stats</h2>
          <div style="display: flex; gap: 8px;">
            <select id="share-period" onchange="loadShareCards()" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); font-size: 13px; cursor: pointer;">
              <option value="week">This Week</option>
              <option value="month" selected>This Month</option>
              <option value="year">This Year</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
        <p style="color: var(--text-muted); margin-bottom: 24px;">Generate shareable stats cards like Spotify Wrapped or DEX PnL cards. Click any card to download it as an image.</p>

        <div class="share-cards-grid" id="share-cards-grid">
          <div class="loading"><div class="spinner"></div> Loading cards...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tooltip -->
  <div class="tooltip" id="tooltip"></div>

  <!-- Modal -->
  <div class="modal-backdrop" id="modal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-top">
          <div class="modal-title-section">
            <h2 class="modal-title" id="modal-title">Session</h2>
            <p class="modal-subtitle" id="modal-subtitle"></p>
          </div>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-tabs" id="modal-tabs">
          <button class="modal-tab active" onclick="showModalTab('overview')">Overview</button>
          <button class="modal-tab" onclick="showModalTab('insights')">Insights</button>
          <button class="modal-tab" onclick="showModalTab('files')">Files</button>
          <button class="modal-tab" onclick="showModalTab('resume')">Resume</button>
        </div>
      </div>
      <div class="modal-body" id="modal-body"></div>
    </div>
  </div>

  <!-- Command Palette (Cmd+K) -->
  <div class="cmd-palette-backdrop" id="cmd-palette">
    <div class="cmd-palette">
      <div class="cmd-palette-input-wrapper">
        <span class="cmd-palette-icon">🔍</span>
        <input type="text" class="cmd-palette-input" id="cmd-input" placeholder="Search sessions, projects, actions..." autocomplete="off" />
        <span class="cmd-palette-shortcut">esc</span>
      </div>
      <div class="cmd-palette-results" id="cmd-results">
        <!-- Results populated by JS -->
      </div>
      <div class="cmd-palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Select</span>
        <span><kbd>esc</kbd> Close</span>
      </div>
    </div>
  </div>

  <script>
    let currentView = 'dashboard';
    let heatmapData = null;

    function showView(view) {
      currentView = view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      document.querySelector('nav button[onclick*="' + view + '"]').classList.add('active');

      if (view === 'timeline') loadTimeline();
      if (view === 'heatmap') loadFullHeatmap();
      if (view === 'leaderboard') loadLeaderboard('projects');
      if (view === 'share') loadShareCards();
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        document.getElementById('stats').innerHTML = \`
          <div class="stat highlight">
            <div class="stat-label">Sessions</div>
            <div class="stat-value">\${s.totalSessions}</div>
            <div class="stat-sub">\${s.sessionsToday} today</div>
          </div>
          <div class="stat">
            <div class="stat-label">Tokens</div>
            <div class="stat-value">\${s.totalTokensFormatted}</div>
            <div class="stat-sub">\${s.tokensTodayFormatted} today</div>
          </div>
          <div class="stat success">
            <div class="stat-label">Cost</div>
            <div class="stat-value">\${s.totalCostFormatted}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Time</div>
            <div class="stat-value">\${s.totalDurationFormatted}</div>
            <div class="stat-sub">Avg: \${s.averageDurationFormatted}</div>
          </div>
        \`;
      } catch (e) {
        document.getElementById('stats').innerHTML = '<div class="empty">Failed to load stats</div>';
      }
    }

    async function loadHeatmap(containerId = 'heatmap-grid', weeks = 52, isLarge = false) {
      try {
        const res = await fetch('/api/heatmap?weeks=' + weeks);
        heatmapData = await res.json();

        const weekMap = new Map();
        heatmapData.cells.forEach(cell => {
          if (!weekMap.has(cell.week)) weekMap.set(cell.week, []);
          weekMap.get(cell.week).push(cell);
        });

        const container = document.getElementById(containerId);
        if (isLarge) container.classList.add('large');

        let html = '';
        for (let w = 0; w < weeks; w++) {
          const days = weekMap.get(w) || [];
          html += '<div class="heatmap-week">';
          for (let d = 0; d < 7; d++) {
            const cell = days.find(c => c.dayOfWeek === d);
            const level = cell ? getLevel(cell.value, heatmapData.maxValue) : 0;
            const data = cell ? JSON.stringify(cell) : '{}';
            html += \`<div class="heatmap-cell level-\${level}" data-cell='\${data}' onmouseover="showTooltip(event, this)" onmouseout="hideTooltip()" onclick="filterByDate('\${cell?.date || ''}')">\`;
            html += '</div>';
          }
          html += '</div>';
        }

        container.innerHTML = html;
      } catch (e) {
        console.error('Failed to load heatmap', e);
      }
    }

    function getLevel(value, max) {
      if (!value || max === 0) return 0;
      const ratio = value / max;
      if (ratio < 0.25) return 1;
      if (ratio < 0.5) return 2;
      if (ratio < 0.75) return 3;
      return 4;
    }

    function showTooltip(event, el) {
      const data = JSON.parse(el.dataset.cell || '{}');
      if (!data.date) return;

      const tooltip = document.getElementById('tooltip');
      const date = new Date(data.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      tooltip.innerHTML = \`<strong>\${date}</strong><br>\${data.messages || 0} messages, \${data.sessions || 0} sessions<br>\${data.tools || 0} tool calls\`;
      tooltip.style.left = event.pageX + 10 + 'px';
      tooltip.style.top = event.pageY + 10 + 'px';
      tooltip.classList.add('show');
    }

    function hideTooltip() {
      document.getElementById('tooltip').classList.remove('show');
    }

    async function filterByDate(date) {
      if (!date) return;
      try {
        const res = await fetch('/api/sessions?date=' + date);
        const sessions = await res.json();

        if (currentView === 'heatmap') {
          const dateFormatted = new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          document.getElementById('heatmap-sessions').innerHTML = \`
            <div class="section-header"><h2 class="section-title">Sessions on \${dateFormatted}</h2></div>
            <div class="sessions">\${sessions.length ? sessions.map(renderSession).join('') : '<div class="empty">No sessions on this day</div>'}</div>
          \`;
        }
      } catch (e) {
        console.error('Failed to filter', e);
      }
    }

    async function loadFullHeatmap() {
      await loadHeatmap('full-heatmap-grid', 52, true);
    }

    let searchTimeout = null;
    let allSessions = [];

    function debounceSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = document.getElementById('search-input').value;
        loadSessions(query);
      }, 300);
    }

    function jumpToDate(dateStr) {
      if (!dateStr) return;
      const el = document.getElementById('day-' + dateStr);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.date-nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(\`.date-nav-item[data-date="\${dateStr}"]\`)?.classList.add('active');
      }
    }

    async function loadSessions(searchQuery = '') {
      try {
        const url = '/api/sessions?limit=2000' + (searchQuery ? '&search=' + encodeURIComponent(searchQuery) : '');
        const res = await fetch(url);
        const sessions = await res.json();
        allSessions = sessions;

        if (!sessions.length) {
          document.getElementById('sessions').innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>No sessions found</p></div>';
          document.getElementById('date-nav').innerHTML = '';
          return;
        }

        // Group sessions by date
        const grouped = new Map();
        sessions.forEach(s => {
          const key = s.dateKey;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(s);
        });

        // Build date navigation
        let navHtml = '';
        grouped.forEach((sess, date) => {
          const d = new Date(date);
          const label = formatDateNav(d);
          navHtml += \`<div class="date-nav-item" data-date="\${date}" onclick="jumpToDate('\${date}')">\${label}<span class="count">(\${sess.length})</span></div>\`;
        });
        document.getElementById('date-nav').innerHTML = navHtml;

        // Build sessions grouped by day
        let html = '';
        grouped.forEach((sess, date) => {
          const d = new Date(date);
          const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          html += \`<div class="day-group" id="day-\${date}">
            <div class="day-header">
              <span class="day-date">\${dateLabel}</span>
              <span class="day-count">\${sess.length} session\${sess.length > 1 ? 's' : ''}</span>
            </div>
            <div class="sessions">\${sess.map(renderSession).join('')}</div>
          </div>\`;
        });

        document.getElementById('sessions').innerHTML = html;
      } catch (e) {
        document.getElementById('sessions').innerHTML = '<div class="empty">Failed to load sessions</div>';
      }
    }

    function formatDateNav(d) {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (d.toDateString() === today.toDateString()) return 'Today';
      if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderSession(s) {
      const summary = s.enriched?.summary || s.summaries?.slice(-1)[0] || null;
      const tags = s.enriched?.tags || [];
      const userTags = s.userTags || [];
      const sentiment = s.enriched?.sentiment;
      const isStarred = s.starred || false;
      const hasNote = s.userNote && s.userNote.trim().length > 0;

      const sentimentClass = sentiment ? 'sentiment-' + sentiment : '';
      const sentimentLabel = sentiment ? sentiment.charAt(0).toUpperCase() + sentiment.slice(1) : '';

      // Model class for styling
      const modelClass = s.model?.includes('opus') ? 'model-opus' : s.model?.includes('haiku') ? 'model-haiku' : 'model-sonnet';

      // Project initials for avatar
      const initials = s.projectName.split(/[-_\\s]/).map(w => w[0]).join('').substring(0, 2).toUpperCase();

      // Files
      const filesWritten = s.filesWritten || [];
      const filesEdited = s.filesEdited || [];
      const allFiles = [...filesWritten.map(f => ({name: f, type: 'written'})), ...filesEdited.map(f => ({name: f, type: 'edited'}))];
      const showFiles = allFiles.slice(0, 4);
      const moreFiles = allFiles.length - 4;

      return \`
        <div class="session" onclick="showSession('\${s.id}')">
          <div class="session-inner">
            <div class="session-header">
              <div class="session-avatar \${modelClass}">\${initials}</div>
              <div class="session-main">
                <div class="session-title-row">
                  <span class="session-name">\${s.projectName}</span>
                  <button class="session-star \${isStarred ? 'starred' : ''}" onclick="event.stopPropagation(); toggleStar('\${s.id}', this)" title="\${isStarred ? 'Unstar' : 'Star'}">
                    \${isStarred ? '⭐' : '☆'}
                  </button>
                </div>
                <div class="session-meta">
                  <span class="session-time">\${s.timeFormatted}</span>
                  <span class="session-duration">\${s.durationFormatted}</span>
                </div>
              </div>
              <div class="session-badges">
                \${sentiment ? \`<span class="session-sentiment \${sentimentClass}">\${sentimentLabel}</span>\` : ''}
                <span class="session-model \${modelClass}">\${s.modelFormatted}</span>
              </div>
            </div>

            \${summary ? \`<div class="session-summary \${s.enriched ? 'has-enriched' : ''}">\${summary}</div>\` : ''}

            \${(userTags.length || tags.length) ? \`
              <div class="session-tags-section">
                \${userTags.map(t => \`<span class="session-user-tag">#\${t}</span>\`).join('')}
                \${tags.slice(0, 4).map(t => \`<span class="session-tag">\${t}</span>\`).join('')}
              </div>
            \` : ''}

            \${hasNote ? \`<div class="session-note-indicator">\${s.userNote.substring(0, 80)}\${s.userNote.length > 80 ? '...' : ''}</div>\` : ''}

            <div class="session-stats-grid">
              <div class="session-stat-card">
                <div class="session-stat-icon">💬</div>
                <div class="session-stat-value">\${s.messageCount}</div>
                <div class="session-stat-label">Messages</div>
              </div>
              <div class="session-stat-card">
                <div class="session-stat-icon">🔧</div>
                <div class="session-stat-value">\${s.toolCallCount}</div>
                <div class="session-stat-label">Tools</div>
              </div>
              <div class="session-stat-card highlight">
                <div class="session-stat-icon">📊</div>
                <div class="session-stat-value">\${s.tokensFormatted}</div>
                <div class="session-stat-label">Tokens</div>
              </div>
              <div class="session-stat-card">
                <div class="session-stat-icon">💰</div>
                <div class="session-stat-value">\${s.costFormatted}</div>
                <div class="session-stat-label">Cost</div>
              </div>
            </div>

            \${showFiles.length > 0 ? \`
              <div class="session-files-section">
                \${showFiles.map(f => \`<span class="session-file \${f.type}">\${f.name.split('/').pop()}</span>\`).join('')}
                \${moreFiles > 0 ? \`<span class="session-files-more">+\${moreFiles} more</span>\` : ''}
              </div>
            \` : ''}
          </div>
        </div>
      \`;
    }

    async function toggleStar(sessionId, button) {
      try {
        const res = await fetch(\`/api/bookmarks/\${sessionId}/star\`, { method: 'POST' });
        const data = await res.json();
        button.classList.toggle('starred', data.starred);
        button.innerHTML = data.starred ? '⭐' : '☆';
        button.title = data.starred ? 'Unstar session' : 'Star session';
      } catch (e) {
        console.error('Failed to toggle star:', e);
      }
    }

    async function loadTimeline() {
      try {
        const res = await fetch('/api/timeline?days=90');
        const data = await res.json();

        const projectMap = new Map();
        data.sessions.forEach(s => {
          if (!projectMap.has(s.projectName)) projectMap.set(s.projectName, []);
          projectMap.get(s.projectName).push(s);
        });

        const startDate = new Date(data.dateRange.start);
        const endDate = new Date(data.dateRange.end);
        const totalMs = endDate - startDate;

        let html = '';
        projectMap.forEach((sessions, project) => {
          html += \`<div class="timeline-row"><div class="timeline-project" title="\${project}">\${project}</div><div class="timeline-track">\`;
          sessions.forEach(s => {
            const start = new Date(s.startedAt);
            const end = s.endedAt ? new Date(s.endedAt) : start;
            const left = ((start - startDate) / totalMs) * 100;
            const width = Math.max(0.5, ((end - start) / totalMs) * 100);
            const modelClass = s.model.includes('opus') ? 'opus' : s.model.includes('haiku') ? 'haiku' : 'sonnet';
            html += \`<div class="timeline-session \${modelClass}" style="left: \${left}%; width: \${width}%;" onclick="showSession('\${s.id}')" title="\${formatTokens(s.tokens)} tokens"></div>\`;
          });
          html += '</div></div>';
        });

        document.getElementById('timeline').innerHTML = html || '<div class="empty">No sessions in timeline</div>';
      } catch (e) {
        document.getElementById('timeline').innerHTML = '<div class="empty">Failed to load timeline</div>';
      }
    }

    async function loadLeaderboard(type) {
      document.querySelectorAll('.leaderboard-tabs button').forEach(b => b.classList.remove('active'));
      document.querySelector('.leaderboard-tabs button[onclick*="' + type + '"]').classList.add('active');

      try {
        const res = await fetch('/api/leaderboard/' + type + '?limit=15');
        const data = await res.json();

        let html = '<div class="leaderboard-table">';
        html += '<div class="leaderboard-row header"><div>Rank</div><div>' + data.title + '</div><div>' + data.metric + '</div><div>' + (data.secondaryMetric || '') + '</div></div>';

        data.entries.forEach(e => {
          const rankClass = e.rank <= 3 ? 'rank-' + e.rank : '';
          const medal = e.rank === 1 ? '🥇 ' : e.rank === 2 ? '🥈 ' : e.rank === 3 ? '🥉 ' : '';
          html += \`<div class="leaderboard-row">
            <div class="leaderboard-rank \${rankClass}">\${medal}\${e.rank}</div>
            <div class="leaderboard-name">\${e.name}</div>
            <div class="leaderboard-value">\${formatValue(e.value, data.metric)}</div>
            <div class="leaderboard-secondary">\${e.secondaryValue ? formatValue(e.secondaryValue, data.secondaryMetric) : ''}</div>
          </div>\`;
        });

        html += '</div>';
        document.getElementById('leaderboard-content').innerHTML = html;
      } catch (e) {
        document.getElementById('leaderboard-content').innerHTML = '<div class="empty">Failed to load leaderboard</div>';
      }
    }

    function formatValue(v, metric) {
      if (metric === 'tokens') return formatTokens(v);
      if (metric === 'duration') return formatDuration(v);
      return v.toLocaleString();
    }

    function formatTokens(t) {
      if (t < 1000) return t.toString();
      if (t < 1000000) return (t / 1000).toFixed(1) + 'K';
      return (t / 1000000).toFixed(2) + 'M';
    }

    function formatDuration(s) {
      if (s < 60) return Math.round(s) + 's';
      if (s < 3600) return Math.floor(s / 60) + 'm';
      return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    }

    // Global Leaderboard Functions
    let currentGlobalCategory = 'tokens';

    function setLeaderboardMode(mode) {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.mode-btn[onclick*="' + mode + '"]').classList.add('active');

      document.querySelectorAll('.leaderboard-mode').forEach(m => m.classList.remove('active'));
      document.getElementById(mode + '-leaderboard').classList.add('active');

      if (mode === 'global') {
        loadGlobalLeaderboard(currentGlobalCategory);
      }
    }

    async function loadGlobalLeaderboard(category) {
      currentGlobalCategory = category;

      // Update tab active state
      document.querySelectorAll('#global-tabs button').forEach(b => b.classList.remove('active'));
      document.querySelector('#global-tabs button[onclick*="' + category + '"]').classList.add('active');

      try {
        const res = await fetch('/api/global-leaderboard?category=' + category);
        const data = await res.json();

        // Render user card
        renderGlobalUserCard(data);

        // Render leaderboard
        renderGlobalLeaderboard(data, category);
      } catch (e) {
        document.getElementById('global-content').innerHTML = '<div class="empty">Failed to load global leaderboard</div>';
      }
    }

    function renderGlobalUserCard(data) {
      const stats = data.userStats;
      const submission = data.submission;
      const achievement = data.achievement;

      const submitBtnHtml = submission
        ? '<button class="global-remove-btn" onclick="removeGlobalSubmission()">Remove from Leaderboard</button>'
        : '<button class="global-submit-btn" onclick="showSubmitModal()">Join Leaderboard</button>';

      const rankHtml = data.userRank && data.percentile
        ? '<div class="global-rank-badge">Rank #' + data.userRank + ' · Top ' + (100 - data.percentile + 1) + '%</div>'
        : '';

      const html = \`
        <div class="global-user-header">
          <div class="global-user-title">
            <div class="global-user-achievement">\${achievement.emoji}</div>
            <div>
              <div class="global-user-name">\${submission ? submission.displayName : 'Your Stats'}</div>
              <div class="global-user-badge">\${achievement.title} \${rankHtml}</div>
            </div>
          </div>
          <div class="global-user-actions">
            \${submitBtnHtml}
          </div>
        </div>
        <div class="global-user-stats">
          <div class="global-stat">
            <div class="global-stat-value">\${formatTokens(stats.totalTokens)}</div>
            <div class="global-stat-label">Tokens</div>
          </div>
          <div class="global-stat">
            <div class="global-stat-value">\${stats.totalSessions.toLocaleString()}</div>
            <div class="global-stat-label">Sessions</div>
          </div>
          <div class="global-stat">
            <div class="global-stat-value">\${stats.totalHours}h</div>
            <div class="global-stat-label">Hours</div>
          </div>
          <div class="global-stat">
            <div class="global-stat-value">\${stats.longestStreak}</div>
            <div class="global-stat-label">Best Streak</div>
          </div>
          <div class="global-stat">
            <div class="global-stat-value">\${stats.languageCount}</div>
            <div class="global-stat-label">Languages</div>
          </div>
        </div>
      \`;

      document.getElementById('global-user-card').innerHTML = html;
    }

    function renderGlobalLeaderboard(data, category) {
      const metricLabels = {
        tokens: 'Tokens',
        sessions: 'Sessions',
        hours: 'Hours',
        streak: 'Best Streak',
        languages: 'Languages'
      };

      let html = '<div class="leaderboard-table">';
      html += '<div class="global-leaderboard-row header"><div>Rank</div><div>Player</div><div>' + metricLabels[category] + '</div><div></div></div>';

      data.entries.slice(0, 20).forEach(entry => {
        const rankClass = entry.rank <= 3 ? 'rank-' + entry.rank : '';
        const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '';
        const userClass = entry.isUser ? 'is-user' : '';
        const youBadge = entry.isUser ? '<span class="global-player-badge">You</span>' : '';

        let value;
        switch(category) {
          case 'tokens': value = formatTokens(entry.stats.totalTokens); break;
          case 'sessions': value = entry.stats.totalSessions.toLocaleString(); break;
          case 'hours': value = entry.stats.totalHours + 'h'; break;
          case 'streak': value = entry.stats.longestStreak + ' days'; break;
          case 'languages': value = entry.stats.languageCount; break;
        }

        html += \`<div class="global-leaderboard-row \${userClass}">
          <div class="global-rank \${rankClass}">\${medal} \${entry.rank}</div>
          <div class="global-player">
            <span class="global-player-name">\${entry.displayName}</span>
            \${youBadge}
          </div>
          <div style="font-weight: 600; color: var(--accent);">\${value}</div>
          <div style="font-size: 13px; color: var(--text-muted);">\${entry.stats.totalSessions} sessions</div>
        </div>\`;
      });

      html += '</div>';
      document.getElementById('global-content').innerHTML = html;
    }

    function showSubmitModal() {
      const modal = document.createElement('div');
      modal.className = 'submit-modal';
      modal.id = 'submit-modal';
      modal.innerHTML = \`
        <div class="submit-modal-content">
          <h3>Join the Global Leaderboard</h3>
          <p>Share your anonymized stats with the community. No code or personal data is shared - only aggregate metrics.</p>
          <input type="text" id="submit-name" placeholder="Display name (e.g., code_ninja)" maxlength="20">
          <div class="submit-modal-actions">
            <button class="global-remove-btn" onclick="closeSubmitModal()">Cancel</button>
            <button class="global-submit-btn" onclick="submitToLeaderboard()">Submit Stats</button>
          </div>
        </div>
      \`;
      document.body.appendChild(modal);
      setTimeout(() => modal.classList.add('visible'), 10);
      document.getElementById('submit-name').focus();
    }

    function closeSubmitModal() {
      const modal = document.getElementById('submit-modal');
      if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 200);
      }
    }

    async function submitToLeaderboard() {
      const name = document.getElementById('submit-name').value.trim();
      try {
        await fetch('/api/global-leaderboard/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: name || 'anonymous' })
        });
        closeSubmitModal();
        loadGlobalLeaderboard(currentGlobalCategory);
      } catch (e) {
        alert('Failed to submit stats');
      }
    }

    async function removeGlobalSubmission() {
      if (!confirm('Remove your stats from the leaderboard?')) return;
      try {
        await fetch('/api/global-leaderboard/remove', { method: 'POST' });
        loadGlobalLeaderboard(currentGlobalCategory);
      } catch (e) {
        alert('Failed to remove stats');
      }
    }

    let currentModalSession = null;
    let currentModalResume = null;
    let currentModalEnriched = null;

    async function showSession(id) {
      document.getElementById('modal').classList.add('open');
      document.getElementById('modal-body').innerHTML = '<div class="loading"><div class="spinner"></div> Loading...</div>';

      // Reset tabs
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.modal-tab').classList.add('active');

      try {
        const [sRes, rRes, eRes] = await Promise.all([
          fetch('/api/sessions/' + id),
          fetch('/api/sessions/' + id + '/resume'),
          fetch('/api/enrich/' + id).catch(() => ({ json: () => null }))
        ]);

        currentModalSession = await sRes.json();
        currentModalResume = (await rRes.json()).context;
        currentModalEnriched = await eRes.json().catch(() => null);

        const session = currentModalSession;
        const enriched = currentModalEnriched;

        document.getElementById('modal-title').textContent = session.projectName;
        document.getElementById('modal-subtitle').textContent = new Date(session.startedAt).toLocaleString() + ' · ' + session.durationFormatted + ' · ' + session.modelFormatted;

        showModalTab('overview');
      } catch (e) {
        document.getElementById('modal-body').innerHTML = '<div class="empty">Failed to load session</div>';
      }
    }

    async function showModalTab(tab) {
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelector(\`.modal-tab[onclick*="\${tab}"]\`).classList.add('active');

      const session = currentModalSession;
      const enriched = currentModalEnriched;
      const resume = currentModalResume;

      let html = '';

      if (tab === 'overview') {
        const summary = enriched?.summary || session.summaries?.slice(-1)[0] || null;
        const sentiment = enriched?.sentiment;
        const sentimentClass = sentiment ? 'sentiment-' + sentiment : '';
        const sentimentEmoji = { productive: '✨', challenging: '🔥', exploratory: '🔍', maintenance: '🔧' }[sentiment] || '';

        html = \`
          \${summary ? \`
            <div class="summary-hero">
              <div class="summary-text">\${summary}</div>
              \${sentiment ? \`<span class="summary-sentiment \${sentimentClass}">\${sentimentEmoji} \${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}</span>\` : ''}
            </div>
          \` : ''}
          <div class="detail-section">
            <div class="detail-label"><span class="detail-label-icon">📊</span> Metrics</div>
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-item-label">Duration</div><div class="detail-item-value">\${session.durationFormatted}</div></div>
              <div class="detail-item"><div class="detail-item-label">Tokens</div><div class="detail-item-value">\${session.tokensFormatted}</div></div>
              <div class="detail-item"><div class="detail-item-label">Cost</div><div class="detail-item-value">\${session.costFormatted}</div></div>
              <div class="detail-item"><div class="detail-item-label">Messages</div><div class="detail-item-value">\${session.messageCount}</div></div>
              <div class="detail-item"><div class="detail-item-label">Tool Calls</div><div class="detail-item-value">\${session.toolCallCount}</div></div>
              <div class="detail-item"><div class="detail-item-label">Files Changed</div><div class="detail-item-value">\${(session.filesWritten?.length || 0) + (session.filesEdited?.length || 0)}</div></div>
            </div>
          </div>
          \${enriched?.tags?.length ? \`
            <div class="detail-section">
              <div class="detail-label"><span class="detail-label-icon">🏷️</span> Tags</div>
              <div class="session-tags" style="margin-bottom: 0;">
                \${enriched.tags.map(t => \`<span class="session-tag">\${t}</span>\`).join('')}
              </div>
            </div>
          \` : ''}
        \`;
      } else if (tab === 'insights') {
        const decisions = enriched?.decisions || [];
        const problems = enriched?.problems || [];
        const knowledge = enriched?.knowledge || [];

        if (!decisions.length && !problems.length && !knowledge.length) {
          html = '<div class="empty"><div class="empty-icon">💡</div><p>No enriched insights available for this session.</p><p style="font-size: 13px; margin-top: 8px;">Run <code>sesh enrich</code> to generate AI insights.</p></div>';
        } else {
          html = \`
            \${decisions.length ? \`
              <div class="detail-section">
                <div class="detail-label"><span class="detail-label-icon">🎯</span> Key Decisions</div>
                <div class="insight-list">
                  \${decisions.map(d => \`<div class="insight-item"><span class="insight-icon">→</span><span>\${d}</span></div>\`).join('')}
                </div>
              </div>
            \` : ''}
            \${problems.length ? \`
              <div class="detail-section">
                <div class="detail-label"><span class="detail-label-icon">🐛</span> Problems & Solutions</div>
                \${problems.map(p => \`
                  <div class="problem-item">
                    <div class="problem-issue"><span>⚠️</span><span>\${p.issue}</span></div>
                    <div class="problem-solution">✓ \${p.solution}</div>
                  </div>
                \`).join('')}
              </div>
            \` : ''}
            \${knowledge.length ? \`
              <div class="detail-section">
                <div class="detail-label"><span class="detail-label-icon">💡</span> Knowledge Transfer</div>
                <div class="insight-list">
                  \${knowledge.map(k => \`<div class="insight-item"><span class="insight-icon">📌</span><span>\${k}</span></div>\`).join('')}
                </div>
              </div>
            \` : ''}
          \`;
        }
      } else if (tab === 'files') {
        const written = session.filesWritten || [];
        const edited = session.filesEdited || [];
        const allFiles = [...written.map(f => ({ path: f, type: 'new' })), ...edited.map(f => ({ path: f, type: 'edit' }))];

        if (!allFiles.length) {
          html = '<div class="empty"><div class="empty-icon">📄</div><p>No files were modified in this session</p></div>';
        } else {
          html = \`
            <div class="detail-section">
              <div class="detail-label"><span class="detail-label-icon">📁</span> Files Modified (\${allFiles.length})</div>
              <div class="files-list">
                \${allFiles.map(f => \`
                  <div class="file-item">
                    <span class="file-item-icon">\${f.type === 'new' ? '✨' : '✏️'}</span>
                    <span>\${f.path}</span>
                  </div>
                \`).join('')}
              </div>
            </div>
          \`;
        }
      } else if (tab === 'resume') {
        // Fetch current bookmark data for this session
        const bookmarkData = await fetch(\`/api/bookmarks/\${currentModalSession.id}\`).then(r => r.json()).catch(() => ({ starred: false, tags: [], note: '' }));
        const isStarred = bookmarkData.starred || false;
        const userTags = bookmarkData.tags || [];
        const userNote = bookmarkData.note || '';

        html = \`
          <!-- Bookmark & Organize Section -->
          <div class="detail-section" style="background: linear-gradient(135deg, rgba(207, 135, 77, 0.08) 0%, var(--bg) 100%); padding: 20px; border-radius: var(--radius); margin-bottom: 24px;">
            <div class="detail-label" style="margin-bottom: 16px;"><span class="detail-label-icon">📌</span> Organize This Session</div>

            <!-- Star Toggle -->
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <button id="modal-star-btn" class="btn \${isStarred ? 'btn-primary' : 'btn-secondary'}" onclick="toggleModalStar()" style="display: flex; align-items: center; gap: 6px;">
                <span>\${isStarred ? '⭐' : '☆'}</span>
                <span>\${isStarred ? 'Starred' : 'Star this session'}</span>
              </button>
              <span style="font-size: 12px; color: var(--text-muted);">Starred sessions appear in Cmd+K quick access</span>
            </div>

            <!-- Tags -->
            <div style="margin-bottom: 16px;">
              <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px;">🏷️ Tags</label>
              <div id="modal-tags" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
                \${userTags.map(t => \`<span class="session-user-tag" style="display: inline-flex; align-items: center; gap: 4px;">#\${t}<button onclick="removeModalTag('\${t}')" style="background: none; border: none; cursor: pointer; padding: 0; margin-left: 4px; opacity: 0.6; font-size: 14px;">&times;</button></span>\`).join('')}
              </div>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="modal-tag-input" placeholder="Add a tag (e.g., reference, wip, archive)" style="flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; background: var(--card);" onkeydown="if(event.key==='Enter'){addModalTag();}" />
                <button class="btn btn-secondary" onclick="addModalTag()">Add</button>
              </div>
            </div>

            <!-- Notes -->
            <div>
              <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px;">📝 Notes</label>
              <textarea id="modal-note-input" placeholder="Add a personal note about this session..." style="width: 100%; min-height: 80px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; resize: vertical; font-family: inherit; background: var(--card);">\${escapeHtml(userNote)}</textarea>
              <button class="btn btn-secondary" onclick="saveModalNote()" style="margin-top: 8px;">Save Note</button>
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-label"><span class="detail-label-icon">🚀</span> Quick Resume</div>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Use Claude's native resume to continue exactly where you left off:</p>
            <div style="background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; font-family: monospace; font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
              <code style="flex: 1; color: var(--accent);">claude --resume \${currentModalSession.id}</code>
              <button class="btn" onclick="navigator.clipboard.writeText('claude --resume \${currentModalSession.id}').then(() => this.textContent = '✓ Copied!').catch(() => alert('Failed'));" style="white-space: nowrap;">📋 Copy Command</button>
            </div>
            <p style="font-size: 12px; color: var(--text-light); margin-bottom: 8px;">
              <strong>Tip:</strong> Run this command in the project directory: <code style="background: var(--bg); padding: 2px 6px; border-radius: 4px;">\${currentModalSession.projectPath || currentModalSession.projectName}</code>
            </p>
          </div>

          <div class="detail-section" style="margin-top: 24px;">
            <div class="detail-label"><span class="detail-label-icon">📋</span> Rich Context</div>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">Or copy this detailed context to start a new session with full history:</p>
            <div class="resume-box" id="resume-ctx" style="max-height: 300px; overflow-y: auto;">\${escapeHtml(resume || 'No context available')}</div>
            <div class="btn-group">
              <button class="btn" onclick="copyResume()">📋 Copy Context</button>
              <button class="btn btn-secondary" onclick="downloadResume()">💾 Download</button>
            </div>
          </div>

          <div class="detail-section" style="margin-top: 24px; padding: 16px; background: linear-gradient(135deg, rgba(207, 135, 77, 0.05) 0%, var(--bg) 100%); border-radius: var(--radius);">
            <div class="detail-label" style="margin-bottom: 8px;"><span class="detail-label-icon">💡</span> When to Use Each Method</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px;">
              <div>
                <strong style="color: var(--accent);">Native Resume (Recommended)</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px; color: var(--text-muted);">
                  <li>Continues exact conversation</li>
                  <li>Preserves full context</li>
                  <li>Best for ongoing work</li>
                </ul>
              </div>
              <div>
                <strong style="color: var(--accent);">Rich Context</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px; color: var(--text-muted);">
                  <li>Start fresh with summary</li>
                  <li>Transferable knowledge</li>
                  <li>Good for reference</li>
                </ul>
              </div>
            </div>
          </div>
        \`;
      }

      document.getElementById('modal-body').innerHTML = html;
    }

    function downloadResume() {
      const text = currentModalResume || '';
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resume-context-' + currentModalSession.id.slice(0, 8) + '.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function closeModal() { document.getElementById('modal').classList.remove('open'); }
    function copyResume() { navigator.clipboard.writeText(document.getElementById('resume-ctx').textContent).then(() => alert('Copied!')); }
    function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    // Modal bookmark functions
    async function toggleModalStar() {
      if (!currentModalSession) return;
      try {
        const res = await fetch(\`/api/bookmarks/\${currentModalSession.id}/star\`, { method: 'POST' });
        const data = await res.json();
        const btn = document.getElementById('modal-star-btn');
        if (data.starred) {
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
          btn.innerHTML = '<span>⭐</span><span>Starred</span>';
        } else {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
          btn.innerHTML = '<span>☆</span><span>Star this session</span>';
        }
        // Update the session card star if visible
        const cardStar = document.querySelector(\`.session-star[onclick*="\${currentModalSession.id}"]\`);
        if (cardStar) {
          cardStar.classList.toggle('starred', data.starred);
          cardStar.innerHTML = data.starred ? '⭐' : '☆';
        }
      } catch (e) {
        console.error('Failed to toggle star:', e);
      }
    }

    async function addModalTag() {
      if (!currentModalSession) return;
      const input = document.getElementById('modal-tag-input');
      const tag = input.value.trim().toLowerCase();
      if (!tag) return;

      try {
        const res = await fetch(\`/api/bookmarks/\${currentModalSession.id}/tags\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag })
        });
        const data = await res.json();
        input.value = '';
        // Refresh tags display
        const tagsContainer = document.getElementById('modal-tags');
        tagsContainer.innerHTML = data.tags.map(t => \`<span class="session-user-tag" style="display: inline-flex; align-items: center; gap: 4px;">#\${t}<button onclick="removeModalTag('\${t}')" style="background: none; border: none; cursor: pointer; padding: 0; margin-left: 4px; opacity: 0.6; font-size: 14px;">&times;</button></span>\`).join('');
      } catch (e) {
        console.error('Failed to add tag:', e);
      }
    }

    async function removeModalTag(tag) {
      if (!currentModalSession) return;
      try {
        const res = await fetch(\`/api/bookmarks/\${currentModalSession.id}/tags/\${encodeURIComponent(tag)}\`, { method: 'DELETE' });
        const data = await res.json();
        // Refresh tags display
        const tagsContainer = document.getElementById('modal-tags');
        tagsContainer.innerHTML = data.tags.map(t => \`<span class="session-user-tag" style="display: inline-flex; align-items: center; gap: 4px;">#\${t}<button onclick="removeModalTag('\${t}')" style="background: none; border: none; cursor: pointer; padding: 0; margin-left: 4px; opacity: 0.6; font-size: 14px;">&times;</button></span>\`).join('');
      } catch (e) {
        console.error('Failed to remove tag:', e);
      }
    }

    async function saveModalNote() {
      if (!currentModalSession) return;
      const textarea = document.getElementById('modal-note-input');
      const note = textarea.value;

      try {
        await fetch(\`/api/bookmarks/\${currentModalSession.id}/note\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note })
        });
        // Show feedback
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Saved!';
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1500);
      } catch (e) {
        console.error('Failed to save note:', e);
      }
    }

    // Load resumable sessions
    async function loadResumable() {
      try {
        const res = await fetch('/api/resumable?limit=5');
        const sessions = await res.json();

        const section = document.getElementById('continue-section');
        const container = document.getElementById('continue-cards');

        if (!sessions.length) {
          section.style.display = 'none';
          return;
        }

        section.style.display = 'block';
        container.innerHTML = sessions.map(s => \`
          <div class="continue-card" onclick="showSessionModal('\${s.id}')">
            <div class="continue-card-header">
              <span class="continue-card-project">\${s.projectName}</span>
              <span class="continue-card-badge">\${s.resumeReason}</span>
            </div>
            <div class="continue-card-meta">
              <span>📍 \${s.timeAgo}</span>
              <span>💬 \${s.messageCount} msgs</span>
              <span>⏱️ \${s.durationFormatted}</span>
            </div>
            <div class="continue-card-actions">
              <button class="continue-btn" onclick="event.stopPropagation(); copyResumeCommand('\${s.id}')">📋 Copy ID</button>
              <button class="continue-btn primary" onclick="event.stopPropagation(); showSessionModal('\${s.id}')">Resume →</button>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Failed to load resumable sessions:', err);
      }
    }

    function copyResumeCommand(sessionId) {
      const cmd = \`claude --resume \${sessionId}\`;
      navigator.clipboard.writeText(cmd).then(() => {
        alert('Copied: ' + cmd);
      });
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

    // ===== COMMAND PALETTE (Cmd+K) =====
    let cmdPaletteOpen = false;
    let cmdSelectedIndex = 0;
    let cmdResults = [];
    let recentSessions = [];

    // Actions available in the command palette
    const cmdActions = [
      { type: 'action', icon: '📊', title: 'View Dashboard', subtitle: 'Go to main dashboard', action: () => showView('dashboard') },
      { type: 'action', icon: '📈', title: 'View Timeline', subtitle: 'See sessions over time', action: () => showView('timeline') },
      { type: 'action', icon: '🗓️', title: 'View Heatmap', subtitle: 'Activity calendar', action: () => showView('heatmap') },
      { type: 'action', icon: '🏆', title: 'View Leaderboard', subtitle: 'Top projects & models', action: () => showView('leaderboard') },
      { type: 'action', icon: '📤', title: 'Generate Share Cards', subtitle: 'Create shareable stats images', action: () => showView('share') },
      { type: 'action', icon: '🔄', title: 'Resume Last Session', subtitle: 'Continue where you left off', action: () => resumeLastSession() },
      { type: 'action', icon: '🔍', title: 'Focus Search', subtitle: 'Search sessions', action: () => { document.getElementById('search-input').focus(); } },
    ];

    function openCmdPalette() {
      cmdPaletteOpen = true;
      cmdSelectedIndex = 0;
      document.getElementById('cmd-palette').classList.add('open');
      const input = document.getElementById('cmd-input');
      input.value = '';
      input.focus();
      renderCmdResults('');
    }

    function closeCmdPalette() {
      cmdPaletteOpen = false;
      document.getElementById('cmd-palette').classList.remove('open');
    }

    // Fuzzy search function
    function fuzzyMatch(text, query) {
      if (!query) return { match: true, score: 0, highlighted: text };
      const textLower = text.toLowerCase();
      const queryLower = query.toLowerCase();

      // Simple contains check with highlighting
      const index = textLower.indexOf(queryLower);
      if (index === -1) return { match: false, score: 0, highlighted: text };

      const before = text.slice(0, index);
      const match = text.slice(index, index + query.length);
      const after = text.slice(index + query.length);
      const highlighted = before + '<span class="cmd-highlight">' + match + '</span>' + after;

      // Score: earlier match = higher score
      const score = 100 - index;
      return { match: true, score, highlighted };
    }

    async function renderCmdResults(query) {
      const container = document.getElementById('cmd-results');
      cmdResults = [];

      let html = '';

      // If no query, show starred + recent + actions
      if (!query) {
        // Starred Sessions
        const starredSessions = allSessions.filter(s => s.starred);
        if (starredSessions.length > 0) {
          html += '<div class="cmd-palette-section"><div class="cmd-palette-section-label">⭐ Starred</div>';
          starredSessions.slice(0, 5).forEach((s, i) => {
            cmdResults.push({ type: 'session', data: s });
            const summary = s.enriched?.summary || s.summaries?.slice(-1)[0] || 'No summary';
            html += renderCmdItem(i, '⭐', s.projectName, summary.slice(0, 60), formatTimeAgoJS(new Date(s.startedAt)));
          });
          html += '</div>';
        }

        // Recent Sessions (last 5 viewed, excluding already shown starred)
        const recentNonStarred = allSessions.filter(s => !s.starred).slice(0, 5);
        if (recentNonStarred.length > 0) {
          html += '<div class="cmd-palette-section"><div class="cmd-palette-section-label">Recent Sessions</div>';
          recentNonStarred.forEach((s, i) => {
            const idx = cmdResults.length;
            cmdResults.push({ type: 'session', data: s });
            const summary = s.enriched?.summary || s.summaries?.slice(-1)[0] || 'No summary';
            html += renderCmdItem(idx, '📁', s.projectName, summary.slice(0, 60), formatTimeAgoJS(new Date(s.startedAt)));
          });
          html += '</div>';
        }

        // Quick Actions
        html += '<div class="cmd-palette-section"><div class="cmd-palette-section-label">Actions</div>';
        cmdActions.forEach((a, i) => {
          const idx = cmdResults.length;
          cmdResults.push({ type: 'action', data: a });
          html += renderCmdItem(idx, a.icon, a.title, a.subtitle, '');
        });
        html += '</div>';
      } else {
        // Search sessions
        const sessionMatches = [];
        allSessions.forEach(s => {
          const projectMatch = fuzzyMatch(s.projectName, query);
          const summaryText = s.enriched?.summary || s.summaries?.slice(-1)[0] || '';
          const summaryMatch = fuzzyMatch(summaryText, query);

          if (projectMatch.match || summaryMatch.match) {
            sessionMatches.push({
              session: s,
              projectMatch,
              summaryMatch,
              score: Math.max(projectMatch.score, summaryMatch.score)
            });
          }
        });

        sessionMatches.sort((a, b) => b.score - a.score);

        // Search actions
        const actionMatches = [];
        cmdActions.forEach(a => {
          const titleMatch = fuzzyMatch(a.title, query);
          if (titleMatch.match) {
            actionMatches.push({ action: a, titleMatch, score: titleMatch.score });
          }
        });

        actionMatches.sort((a, b) => b.score - a.score);

        // Render matches
        if (sessionMatches.length > 0) {
          html += '<div class="cmd-palette-section"><div class="cmd-palette-section-label">Sessions</div>';
          sessionMatches.slice(0, 8).forEach((m, i) => {
            cmdResults.push({ type: 'session', data: m.session });
            const title = m.projectMatch.match ? m.projectMatch.highlighted : m.session.projectName;
            const summary = m.summaryMatch.match ? m.summaryMatch.highlighted : (m.session.enriched?.summary || m.session.summaries?.slice(-1)[0] || 'No summary');
            html += renderCmdItem(i, '📁', title, summary.slice(0, 60), formatTimeAgoJS(new Date(m.session.startedAt)));
          });
          html += '</div>';
        }

        if (actionMatches.length > 0) {
          html += '<div class="cmd-palette-section"><div class="cmd-palette-section-label">Actions</div>';
          actionMatches.forEach((m, i) => {
            const idx = cmdResults.length;
            cmdResults.push({ type: 'action', data: m.action });
            html += renderCmdItem(idx, m.action.icon, m.titleMatch.highlighted, m.action.subtitle, '');
          });
          html += '</div>';
        }

        if (sessionMatches.length === 0 && actionMatches.length === 0) {
          html = '<div class="empty" style="padding: 24px;"><div class="empty-icon">🔍</div><p>No results for "' + escapeHtml(query) + '"</p></div>';
        }
      }

      container.innerHTML = html;
      cmdSelectedIndex = Math.min(cmdSelectedIndex, cmdResults.length - 1);
      if (cmdSelectedIndex < 0) cmdSelectedIndex = 0;
      updateCmdSelection();
    }

    function renderCmdItem(idx, icon, title, subtitle, meta) {
      return \`
        <div class="cmd-palette-item" data-idx="\${idx}" onclick="selectCmdItem(\${idx})" onmouseover="cmdSelectedIndex = \${idx}; updateCmdSelection();">
          <div class="cmd-palette-item-icon">\${icon}</div>
          <div class="cmd-palette-item-content">
            <div class="cmd-palette-item-title">\${title}</div>
            <div class="cmd-palette-item-subtitle">\${subtitle}</div>
          </div>
          \${meta ? \`<div class="cmd-palette-item-meta">\${meta}</div>\` : ''}
        </div>
      \`;
    }

    function updateCmdSelection() {
      document.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
        el.classList.toggle('selected', i === cmdSelectedIndex);
      });
      // Scroll selected into view
      const selected = document.querySelector('.cmd-palette-item.selected');
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    function selectCmdItem(idx) {
      const item = cmdResults[idx];
      if (!item) return;

      closeCmdPalette();

      if (item.type === 'session') {
        showSession(item.data.id);
      } else if (item.type === 'action') {
        item.data.action();
      }
    }

    async function resumeLastSession() {
      if (allSessions.length > 0) {
        const lastSession = allSessions[0];
        const cmd = 'claude --resume ' + lastSession.id;
        await navigator.clipboard.writeText(cmd);
        alert('Copied to clipboard:\\n' + cmd + '\\n\\nRun this in: ' + lastSession.projectPath);
      }
    }

    function formatTimeAgoJS(date) {
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHours < 24) return diffHours + 'h ago';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return diffDays + ' days ago';
      return date.toLocaleDateString();
    }

    // Command palette keyboard handling
    document.addEventListener('keydown', e => {
      // Open with Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (cmdPaletteOpen) {
          closeCmdPalette();
        } else {
          openCmdPalette();
        }
        return;
      }

      // Handle navigation when palette is open
      if (cmdPaletteOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeCmdPalette();
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          cmdSelectedIndex = Math.min(cmdSelectedIndex + 1, cmdResults.length - 1);
          updateCmdSelection();
          return;
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          cmdSelectedIndex = Math.max(cmdSelectedIndex - 1, 0);
          updateCmdSelection();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          selectCmdItem(cmdSelectedIndex);
          return;
        }
      }
    });

    // Input handling for command palette
    document.getElementById('cmd-input').addEventListener('input', e => {
      const query = e.target.value.trim();
      cmdSelectedIndex = 0;
      renderCmdResults(query);
    });

    // Close when clicking outside
    document.getElementById('cmd-palette').addEventListener('click', e => {
      if (e.target.id === 'cmd-palette') closeCmdPalette();
    });
    // ===== END COMMAND PALETTE =====

    // ===== SHARE CARDS =====
    let shareCardsData = null;

    async function loadShareCards() {
      const period = document.getElementById('share-period')?.value || 'month';
      const container = document.getElementById('share-cards-grid');
      if (!container) return;

      container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading cards...</div>';

      try {
        const res = await fetch('/api/cards?period=' + period);
        shareCardsData = await res.json();
        renderShareCards(shareCardsData);
      } catch (e) {
        container.innerHTML = '<div class="empty">Failed to load cards</div>';
      }
    }

    function renderShareCards(data) {
      const container = document.getElementById('share-cards-grid');
      if (!container || !data) return;

      const { summary, languages, rhythm, achievement, wrapped } = data;

      container.innerHTML = \`
        <!-- Summary Card -->
        <div class="share-card share-card-summary" onclick="downloadCard('summary')">
          <div class="share-card-title">\${summary.title}</div>
          <div class="share-card-period">\${summary.period}</div>
          <div class="share-card-hero">\${summary.stats.totalTokens}</div>
          <div class="share-card-hero-label">tokens generated</div>
          <div class="share-card-stats">
            <span>\${summary.stats.totalSessions} sessions</span>
            <span>\${summary.stats.totalHours} coded</span>
            <span>\${summary.stats.projectCount} projects</span>
          </div>
          <div class="share-card-footer">claude-sesh.dev</div>
        </div>

        <!-- Languages Card -->
        <div class="share-card share-card-languages" onclick="downloadCard('languages')">
          <div class="share-card-title">\${languages.title}</div>
          <div class="share-card-period">\${languages.period}</div>
          <div class="lang-bars">
            \${languages.extras.languages.slice(0, 5).map(l => \`
              <div class="lang-bar">
                <span class="lang-bar-name">\${l.name}</span>
                <div class="lang-bar-track">
                  <div class="lang-bar-fill" style="width: \${l.percentage}%"></div>
                </div>
                <span class="lang-bar-pct">\${l.percentage}%</span>
              </div>
            \`).join('')}
          </div>
          <div class="share-card-footer">\${languages.stats.languageCount} languages this period</div>
        </div>

        <!-- Rhythm Card -->
        <div class="share-card share-card-rhythm" onclick="downloadCard('rhythm')">
          <div class="share-card-title">\${rhythm.title}</div>
          <div class="share-card-period">\${rhythm.period}</div>
          <div class="rhythm-archetype">\${rhythm.stats.archetypeEmoji}</div>
          <div class="rhythm-label">\${rhythm.stats.archetype}</div>
          <div class="rhythm-stats">
            <div class="rhythm-stat">
              <div class="rhythm-stat-label">Peak Time</div>
              <div class="rhythm-stat-value">\${rhythm.stats.peakHour}</div>
            </div>
            <div class="rhythm-stat">
              <div class="rhythm-stat-label">Most Active</div>
              <div class="rhythm-stat-value">\${rhythm.stats.peakDay}</div>
            </div>
          </div>
        </div>

        <!-- Achievement Card -->
        <div class="share-card share-card-achievement" onclick="downloadCard('achievement')">
          <div class="share-card-title">\${achievement.title}</div>
          <div class="achievement-percentile">TOP \${achievement.stats.percentile}%</div>
          <div class="achievement-subtitle">\${achievement.subtitle}</div>
          <div class="share-card-stats">
            <span>\${achievement.stats.totalSessions} sessions</span>
            <span>\${achievement.stats.totalProjects} projects</span>
            <span>\${achievement.stats.totalTokens} tokens</span>
          </div>
        </div>

        <!-- Wrapped Card -->
        <div class="share-card share-card-wrapped" onclick="downloadCard('wrapped')" style="grid-column: span 2;">
          <div class="share-card-title">\${wrapped.title}</div>
          <div class="share-card-period">\${wrapped.subtitle}</div>
          <div class="wrapped-grid">
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.sessions}</div>
              <div class="wrapped-item-label">Sessions</div>
            </div>
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.hours}</div>
              <div class="wrapped-item-label">Hours</div>
            </div>
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.tokens}</div>
              <div class="wrapped-item-label">Tokens</div>
            </div>
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.cost}</div>
              <div class="wrapped-item-label">Cost</div>
            </div>
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.projects}</div>
              <div class="wrapped-item-label">Projects</div>
            </div>
            <div class="wrapped-item">
              <div class="wrapped-item-value">\${wrapped.stats.files}</div>
              <div class="wrapped-item-label">Files</div>
            </div>
            <div class="wrapped-highlight">
              <div class="wrapped-highlight-emoji">🏆</div>
              <div class="wrapped-highlight-title">\${wrapped.stats.achievementTitle}</div>
            </div>
          </div>
          <div class="share-card-footer">Top Project: \${wrapped.stats.topProject} · Model: \${wrapped.stats.topModel}</div>
        </div>
      \`;
    }

    async function downloadCard(cardType) {
      // Use html2canvas approach - render the card to canvas and download
      const card = document.querySelector('.share-card-' + cardType);
      if (!card) return;

      try {
        // Create a canvas from the card element
        const canvas = await htmlToCanvas(card);
        const link = document.createElement('a');
        link.download = 'claude-stats-' + cardType + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch (e) {
        console.error('Failed to download card:', e);
        alert('Failed to download card. Try right-clicking and saving as image.');
      }
    }

    // Simple html2canvas implementation
    async function htmlToCanvas(element) {
      const canvas = document.createElement('canvas');
      const rect = element.getBoundingClientRect();
      const scale = 2; // For retina quality

      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;

      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Get computed styles
      const styles = window.getComputedStyle(element);

      // Draw background
      const bgImage = styles.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        // Parse gradient
        const gradient = parseGradient(ctx, bgImage, rect.width, rect.height);
        if (gradient) {
          ctx.fillStyle = gradient;
          roundRect(ctx, 0, 0, rect.width, rect.height, 20);
          ctx.fill();
        }
      }

      // Draw text content
      ctx.fillStyle = 'white';
      ctx.textBaseline = 'top';

      // Recursively draw text elements
      await drawElements(ctx, element, 0, 0);

      return canvas;
    }

    function parseGradient(ctx, bgImage, width, height) {
      // Extract colors from gradient string
      const match = bgImage.match(/linear-gradient\\(([^)]+)\\)/);
      if (!match) return null;

      const parts = match[1].split(',');
      const angle = parts[0].includes('deg') ? parseFloat(parts[0]) : 135;

      // Convert angle to coordinates
      const rad = (angle - 90) * Math.PI / 180;
      const x1 = width / 2 - Math.cos(rad) * width / 2;
      const y1 = height / 2 - Math.sin(rad) * height / 2;
      const x2 = width / 2 + Math.cos(rad) * width / 2;
      const y2 = height / 2 + Math.sin(rad) * height / 2;

      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);

      // Extract colors
      const colorMatches = bgImage.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgb\\([^)]+\\)/g);
      if (colorMatches) {
        colorMatches.forEach((color, i) => {
          gradient.addColorStop(i / (colorMatches.length - 1), color);
        });
      }

      return gradient;
    }

    function roundRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    async function drawElements(ctx, element, offsetX, offsetY) {
      const rect = element.getBoundingClientRect();
      const parentRect = element.closest('.share-card').getBoundingClientRect();
      const x = rect.left - parentRect.left + offsetX;
      const y = rect.top - parentRect.top + offsetY;

      const styles = window.getComputedStyle(element);

      // Draw background for nested elements
      const bg = styles.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        ctx.fillStyle = bg;
        const radius = parseFloat(styles.borderRadius) || 0;
        if (radius > 0) {
          roundRect(ctx, x, y, rect.width, rect.height, radius);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, rect.width, rect.height);
        }
      }

      // Draw text
      if (element.childNodes.length === 1 && element.childNodes[0].nodeType === 3) {
        const text = element.textContent;
        const fontSize = parseFloat(styles.fontSize);
        const fontWeight = styles.fontWeight;
        const fontFamily = styles.fontFamily;

        ctx.font = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
        ctx.fillStyle = styles.color;
        ctx.fillText(text, x, y + (parseFloat(styles.paddingTop) || 0));
      }

      // Draw bar fills
      if (element.classList.contains('lang-bar-fill')) {
        ctx.fillStyle = 'white';
        ctx.fillRect(x, y, rect.width, rect.height);
      }

      // Recursively draw children
      for (const child of element.children) {
        await drawElements(ctx, child, offsetX, offsetY);
      }
    }
    // ===== END SHARE CARDS =====

    // Init
    loadStats();
    loadHeatmap('heatmap-grid', 52, true); // Use large heatmap on dashboard
    loadResumable();
    loadSessions();
  </script>
</body>
</html>`;
}

export default startServer;
