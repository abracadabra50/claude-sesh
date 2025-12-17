import { parser, formatModelName } from './parser.js';
import type { ParsedSession } from '../types/index.js';

export interface StatsCardData {
  type: 'summary' | 'languages' | 'rhythm' | 'achievement' | 'wrapped';
  title: string;
  subtitle: string;
  period: string;
  stats: Record<string, string | number>;
  extras?: Record<string, unknown>;
}

export interface SummaryCardData extends StatsCardData {
  type: 'summary';
  stats: {
    totalSessions: number;
    totalTokens: string;
    totalCost: string;
    totalHours: string;
    projectCount: number;
    filesChanged: number;
  };
}

export interface LanguageCardData extends StatsCardData {
  type: 'languages';
  stats: {
    languageCount: number;
  };
  extras: {
    languages: Array<{ name: string; percentage: number; color: string }>;
  };
}

export interface RhythmCardData extends StatsCardData {
  type: 'rhythm';
  stats: {
    peakHour: string;
    peakDay: string;
    archetype: string;
    archetypeEmoji: string;
  };
  extras: {
    hourlyActivity: number[];
    dailyActivity: number[];
  };
}

export interface AchievementCardData extends StatsCardData {
  type: 'achievement';
  stats: {
    percentile: number;
    totalSessions: number;
    totalProjects: number;
    totalTokens: string;
  };
}

export interface WrappedCardData extends StatsCardData {
  type: 'wrapped';
  stats: {
    sessions: number;
    hours: string;
    tokens: string;
    cost: string;
    projects: number;
    files: number;
    topProject: string;
    topModel: string;
    achievementTitle: string;
  };
}

class CardsService {
  private formatTokens(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(2)}M`;
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  }

  private formatHours(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    if (hours === 0) return '<1h';
    return `${hours}h`;
  }

  private getSessionsInPeriod(period: 'week' | 'month' | 'year' | 'all'): ParsedSession[] {
    const sessions = parser.getAllSessions(10000);
    const now = new Date();

    if (period === 'all') return sessions;

    const cutoff = new Date();
    if (period === 'week') cutoff.setDate(now.getDate() - 7);
    if (period === 'month') cutoff.setMonth(now.getMonth() - 1);
    if (period === 'year') cutoff.setFullYear(now.getFullYear() - 1);

    return sessions.filter(s => s.startedAt >= cutoff);
  }

  private getPeriodLabel(period: 'week' | 'month' | 'year' | 'all'): string {
    const now = new Date();
    if (period === 'week') return 'This Week';
    if (period === 'month') return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (period === 'year') return now.getFullYear().toString();
    return 'All Time';
  }

  getSummaryCard(period: 'week' | 'month' | 'year' | 'all' = 'month'): SummaryCardData {
    const sessions = this.getSessionsInPeriod(period);

    const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
    const totalDuration = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);

    const projects = new Set(sessions.map(s => s.projectName));
    const files = new Set([
      ...sessions.flatMap(s => s.filesWritten || []),
      ...sessions.flatMap(s => s.filesEdited || [])
    ]);

    return {
      type: 'summary',
      title: 'CLAUDE CODE STATS',
      subtitle: `${sessions.length} coding sessions`,
      period: this.getPeriodLabel(period),
      stats: {
        totalSessions: sessions.length,
        totalTokens: this.formatTokens(totalTokens),
        totalCost: `$${totalCost.toFixed(2)}`,
        totalHours: this.formatHours(totalDuration),
        projectCount: projects.size,
        filesChanged: files.size,
      },
    };
  }

  getLanguagesCard(period: 'week' | 'month' | 'year' | 'all' = 'month'): LanguageCardData {
    const sessions = this.getSessionsInPeriod(period);

    // Extract languages from file extensions
    const langCounts = new Map<string, number>();
    const extToLang: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.rb': 'Ruby',
      '.java': 'Java',
      '.kt': 'Kotlin',
      '.swift': 'Swift',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.php': 'PHP',
      '.vue': 'Vue',
      '.svelte': 'Svelte',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.md': 'Markdown',
      '.sql': 'SQL',
      '.sh': 'Shell',
      '.bash': 'Shell',
    };

    const langColors: Record<string, string> = {
      'TypeScript': '#3178C6',
      'JavaScript': '#F7DF1E',
      'Python': '#3776AB',
      'Rust': '#DEA584',
      'Go': '#00ADD8',
      'Ruby': '#CC342D',
      'Java': '#ED8B00',
      'Kotlin': '#7F52FF',
      'Swift': '#F05138',
      'C++': '#00599C',
      'C': '#A8B9CC',
      'C#': '#512BD4',
      'PHP': '#777BB4',
      'Vue': '#4FC08D',
      'Svelte': '#FF3E00',
      'HTML': '#E34F26',
      'CSS': '#1572B6',
      'SCSS': '#CC6699',
      'JSON': '#292929',
      'YAML': '#CB171E',
      'Markdown': '#083FA1',
      'SQL': '#4479A1',
      'Shell': '#89E051',
    };

    const allFiles = [
      ...sessions.flatMap(s => s.filesWritten || []),
      ...sessions.flatMap(s => s.filesEdited || [])
    ];

    for (const file of allFiles) {
      const ext = '.' + file.split('.').pop()?.toLowerCase();
      const lang = extToLang[ext] || 'Other';
      langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    }

    const total = Array.from(langCounts.values()).reduce((sum, n) => sum + n, 0);
    const sorted = Array.from(langCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({
        name,
        percentage: Math.round((count / total) * 100),
        color: langColors[name] || '#888888',
      }));

    return {
      type: 'languages',
      title: 'POLYGLOT DEVELOPER',
      subtitle: `${langCounts.size} languages used`,
      period: this.getPeriodLabel(period),
      stats: {
        languageCount: langCounts.size,
      },
      extras: {
        languages: sorted,
      },
    };
  }

  getRhythmCard(period: 'week' | 'month' | 'year' | 'all' = 'month'): RhythmCardData {
    const sessions = this.getSessionsInPeriod(period);

    // Calculate hourly activity (0-23)
    const hourlyActivity = new Array(24).fill(0);
    // Calculate daily activity (0-6, Sunday = 0)
    const dailyActivity = new Array(7).fill(0);

    for (const session of sessions) {
      const hour = session.startedAt.getHours();
      const day = session.startedAt.getDay();
      hourlyActivity[hour] += session.totalTokens;
      dailyActivity[day] += session.totalTokens;
    }

    // Find peak hour
    const peakHourIndex = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const peakHour = this.formatHourRange(peakHourIndex);

    // Find peak day
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDayIndex = dailyActivity.indexOf(Math.max(...dailyActivity));
    const peakDay = dayNames[peakDayIndex];

    // Determine archetype based on peak hour
    let archetype: string;
    let archetypeEmoji: string;

    if (peakHourIndex >= 5 && peakHourIndex < 9) {
      archetype = 'Early Bird';
      archetypeEmoji = '🐦';
    } else if (peakHourIndex >= 9 && peakHourIndex < 17) {
      archetype = 'Day Worker';
      archetypeEmoji = '☀️';
    } else if (peakHourIndex >= 17 && peakHourIndex < 21) {
      archetype = 'Evening Coder';
      archetypeEmoji = '🌆';
    } else {
      archetype = 'Night Owl';
      archetypeEmoji = '🦉';
    }

    return {
      type: 'rhythm',
      title: 'YOUR CODING RHYTHM',
      subtitle: `Peak productivity patterns`,
      period: this.getPeriodLabel(period),
      stats: {
        peakHour,
        peakDay,
        archetype,
        archetypeEmoji,
      },
      extras: {
        hourlyActivity,
        dailyActivity,
      },
    };
  }

  private formatHourRange(hour: number): string {
    const formatHour = (h: number) => {
      if (h === 0 || h === 12) return h === 0 ? '12am' : '12pm';
      return h < 12 ? `${h}am` : `${h - 12}pm`;
    };
    return `${formatHour(hour)} - ${formatHour((hour + 1) % 24)}`;
  }

  getAchievementCard(): AchievementCardData {
    const allSessions = parser.getAllSessions(10000);
    const totalTokens = allSessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const projects = new Set(allSessions.map(s => s.projectName));

    // Calculate percentile (placeholder - would need actual comparison data)
    // For now, use a simple heuristic based on sessions
    let percentile: number;
    if (allSessions.length >= 500) percentile = 1;
    else if (allSessions.length >= 200) percentile = 5;
    else if (allSessions.length >= 100) percentile = 10;
    else if (allSessions.length >= 50) percentile = 20;
    else if (allSessions.length >= 20) percentile = 40;
    else percentile = 60;

    return {
      type: 'achievement',
      title: `TOP ${percentile}% POWER USER`,
      subtitle: `More productive than ${100 - percentile}% of Claude Code developers`,
      period: 'All Time',
      stats: {
        percentile,
        totalSessions: allSessions.length,
        totalProjects: projects.size,
        totalTokens: this.formatTokens(totalTokens),
      },
    };
  }

  getWrappedCard(period: 'week' | 'month' | 'year' | 'all' = 'month'): WrappedCardData {
    const sessions = this.getSessionsInPeriod(period);

    const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
    const totalDuration = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);

    const projects = new Set(sessions.map(s => s.projectName));
    const files = new Set([
      ...sessions.flatMap(s => s.filesWritten || []),
      ...sessions.flatMap(s => s.filesEdited || [])
    ]);

    // Find top project by session count
    const projectCounts = new Map<string, number>();
    for (const s of sessions) {
      projectCounts.set(s.projectName, (projectCounts.get(s.projectName) || 0) + 1);
    }
    const topProject = Array.from(projectCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Find top model
    const modelCounts = new Map<string, number>();
    for (const s of sessions) {
      const model = formatModelName(s.model);
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
    const topModel = Array.from(modelCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Achievement title
    const hours = totalDuration / 3600;
    let achievementTitle: string;
    if (hours > 100) achievementTitle = 'Code Legend';
    else if (hours > 50) achievementTitle = 'AI Power User';
    else if (sessions.length > 100) achievementTitle = 'Prolific Coder';
    else if (projects.size > 10) achievementTitle = 'Project Juggler';
    else if (files.size > 500) achievementTitle = 'Refactoring Champion';
    else achievementTitle = 'Rising Star';

    return {
      type: 'wrapped',
      title: `${this.getPeriodLabel(period).toUpperCase()} WRAPPED`,
      subtitle: 'Your Claude Code journey',
      period: this.getPeriodLabel(period),
      stats: {
        sessions: sessions.length,
        hours: this.formatHours(totalDuration),
        tokens: this.formatTokens(totalTokens),
        cost: `$${totalCost.toFixed(2)}`,
        projects: projects.size,
        files: files.size,
        topProject,
        topModel,
        achievementTitle,
      },
    };
  }

  getAllCards(period: 'week' | 'month' | 'year' | 'all' = 'month'): {
    summary: SummaryCardData;
    languages: LanguageCardData;
    rhythm: RhythmCardData;
    achievement: AchievementCardData;
    wrapped: WrappedCardData;
  } {
    return {
      summary: this.getSummaryCard(period),
      languages: this.getLanguagesCard(period),
      rhythm: this.getRhythmCard(period),
      achievement: this.getAchievementCard(),
      wrapped: this.getWrappedCard(period),
    };
  }
}

export const cardsService = new CardsService();
