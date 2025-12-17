import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SessionParser } from './parser.js';

const CLAUDE_SESH_DIR = join(homedir(), '.claude-sesh');
const LEADERBOARD_FILE = join(CLAUDE_SESH_DIR, 'leaderboard.json');

export interface LeaderboardSubmission {
  anonymousId: string;
  displayName: string;
  submittedAt: string;
  stats: {
    totalSessions: number;
    totalTokens: number;
    totalHours: number;
    languageCount: number;
    longestStreak: number;
    mostActiveHour: number; // 0-23
    avgSessionLength: number; // minutes
  };
}

export interface LeaderboardData {
  userSubmission: LeaderboardSubmission | null;
  lastUpdated: string;
}

// Simulated global leaderboard data (realistic distribution)
// This would come from a real API in production
const SIMULATED_GLOBAL_ENTRIES: Omit<LeaderboardSubmission, 'submittedAt'>[] = [
  { anonymousId: 'legend_01', displayName: 'code_architect', stats: { totalSessions: 2847, totalTokens: 45200000, totalHours: 892, languageCount: 12, longestStreak: 147, mostActiveHour: 22, avgSessionLength: 18.8 }},
  { anonymousId: 'legend_02', displayName: 'midnight_hacker', stats: { totalSessions: 2156, totalTokens: 38400000, totalHours: 723, languageCount: 9, longestStreak: 98, mostActiveHour: 2, avgSessionLength: 20.1 }},
  { anonymousId: 'legend_03', displayName: 'rust_wizard', stats: { totalSessions: 1893, totalTokens: 31200000, totalHours: 612, languageCount: 7, longestStreak: 82, mostActiveHour: 14, avgSessionLength: 19.4 }},
  { anonymousId: 'pro_01', displayName: 'typescript_ninja', stats: { totalSessions: 1654, totalTokens: 24800000, totalHours: 498, languageCount: 8, longestStreak: 67, mostActiveHour: 10, avgSessionLength: 18.1 }},
  { anonymousId: 'pro_02', displayName: 'early_bird_dev', stats: { totalSessions: 1423, totalTokens: 21500000, totalHours: 445, languageCount: 6, longestStreak: 54, mostActiveHour: 6, avgSessionLength: 18.8 }},
  { anonymousId: 'pro_03', displayName: 'fullstack_flow', stats: { totalSessions: 1298, totalTokens: 18900000, totalHours: 389, languageCount: 11, longestStreak: 45, mostActiveHour: 15, avgSessionLength: 18.0 }},
  { anonymousId: 'mid_01', displayName: 'python_pathfinder', stats: { totalSessions: 987, totalTokens: 14200000, totalHours: 312, languageCount: 5, longestStreak: 38, mostActiveHour: 21, avgSessionLength: 19.0 }},
  { anonymousId: 'mid_02', displayName: 'go_getter', stats: { totalSessions: 876, totalTokens: 12800000, totalHours: 278, languageCount: 4, longestStreak: 31, mostActiveHour: 11, avgSessionLength: 19.0 }},
  { anonymousId: 'mid_03', displayName: 'react_rider', stats: { totalSessions: 765, totalTokens: 11200000, totalHours: 245, languageCount: 6, longestStreak: 28, mostActiveHour: 16, avgSessionLength: 19.2 }},
  { anonymousId: 'mid_04', displayName: 'docker_daemon', stats: { totalSessions: 654, totalTokens: 9800000, totalHours: 198, languageCount: 5, longestStreak: 24, mostActiveHour: 23, avgSessionLength: 18.2 }},
  { anonymousId: 'reg_01', displayName: 'swift_coder', stats: { totalSessions: 543, totalTokens: 7900000, totalHours: 167, languageCount: 4, longestStreak: 21, mostActiveHour: 9, avgSessionLength: 18.4 }},
  { anonymousId: 'reg_02', displayName: 'java_journeyer', stats: { totalSessions: 432, totalTokens: 6400000, totalHours: 134, languageCount: 3, longestStreak: 18, mostActiveHour: 14, avgSessionLength: 18.6 }},
  { anonymousId: 'reg_03', displayName: 'css_crafter', stats: { totalSessions: 387, totalTokens: 5200000, totalHours: 112, languageCount: 5, longestStreak: 15, mostActiveHour: 20, avgSessionLength: 17.4 }},
  { anonymousId: 'reg_04', displayName: 'node_navigator', stats: { totalSessions: 298, totalTokens: 4100000, totalHours: 89, languageCount: 4, longestStreak: 12, mostActiveHour: 22, avgSessionLength: 17.9 }},
  { anonymousId: 'reg_05', displayName: 'vue_voyager', stats: { totalSessions: 234, totalTokens: 3200000, totalHours: 67, languageCount: 3, longestStreak: 10, mostActiveHour: 19, avgSessionLength: 17.2 }},
  { anonymousId: 'new_01', displayName: 'elixir_explorer', stats: { totalSessions: 187, totalTokens: 2400000, totalHours: 52, languageCount: 2, longestStreak: 8, mostActiveHour: 21, avgSessionLength: 16.7 }},
  { anonymousId: 'new_02', displayName: 'scala_seeker', stats: { totalSessions: 145, totalTokens: 1800000, totalHours: 41, languageCount: 3, longestStreak: 7, mostActiveHour: 15, avgSessionLength: 17.0 }},
  { anonymousId: 'new_03', displayName: 'kotlin_knight', stats: { totalSessions: 98, totalTokens: 1200000, totalHours: 28, languageCount: 2, longestStreak: 5, mostActiveHour: 10, avgSessionLength: 17.1 }},
  { anonymousId: 'new_04', displayName: 'php_pioneer', stats: { totalSessions: 67, totalTokens: 780000, totalHours: 18, languageCount: 2, longestStreak: 4, mostActiveHour: 13, avgSessionLength: 16.1 }},
  { anonymousId: 'new_05', displayName: 'ruby_rookie', stats: { totalSessions: 34, totalTokens: 420000, totalHours: 9, languageCount: 1, longestStreak: 3, mostActiveHour: 20, avgSessionLength: 15.9 }},
];

export class LeaderboardService {
  private data: LeaderboardData;
  private parser: SessionParser;

  constructor(parser: SessionParser) {
    this.parser = parser;
    this.data = this.loadData();
  }

  private loadData(): LeaderboardData {
    if (!existsSync(CLAUDE_SESH_DIR)) {
      mkdirSync(CLAUDE_SESH_DIR, { recursive: true });
    }

    if (existsSync(LEADERBOARD_FILE)) {
      try {
        return JSON.parse(readFileSync(LEADERBOARD_FILE, 'utf-8'));
      } catch {
        return { userSubmission: null, lastUpdated: new Date().toISOString() };
      }
    }

    return { userSubmission: null, lastUpdated: new Date().toISOString() };
  }

  private saveData(): void {
    writeFileSync(LEADERBOARD_FILE, JSON.stringify(this.data, null, 2));
  }

  private generateAnonymousId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'user_';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  // Calculate user's current stats from sessions
  getUserStats(): LeaderboardSubmission['stats'] {
    const sessions = this.parser.getAllSessions(10000);

    // Count languages from file extensions
    const languages = new Set<string>();
    const hourCounts = new Array(24).fill(0);

    let totalMinutes = 0;

    for (const session of sessions) {
      // Track session hours
      const hour = session.startedAt.getHours();
      hourCounts[hour]++;

      totalMinutes += session.durationSeconds / 60;

      // Extract languages from files
      const allFiles = [...session.filesWritten, ...session.filesEdited, ...session.filesRead];
      for (const file of allFiles) {
        const ext = file.split('.').pop()?.toLowerCase();
        if (ext) {
          const langMap: Record<string, string> = {
            'ts': 'TypeScript', 'tsx': 'TypeScript', 'js': 'JavaScript', 'jsx': 'JavaScript',
            'py': 'Python', 'rs': 'Rust', 'go': 'Go', 'java': 'Java', 'kt': 'Kotlin',
            'swift': 'Swift', 'rb': 'Ruby', 'php': 'PHP', 'cs': 'C#', 'cpp': 'C++',
            'c': 'C', 'scala': 'Scala', 'ex': 'Elixir', 'exs': 'Elixir', 'vue': 'Vue',
            'svelte': 'Svelte', 'html': 'HTML', 'css': 'CSS', 'scss': 'SCSS', 'sql': 'SQL',
            'sh': 'Shell', 'bash': 'Shell', 'zsh': 'Shell', 'md': 'Markdown', 'json': 'JSON',
            'yaml': 'YAML', 'yml': 'YAML', 'toml': 'TOML', 'xml': 'XML'
          };
          if (langMap[ext]) {
            languages.add(langMap[ext]);
          }
        }
      }
    }

    // Find most active hour
    const mostActiveHour = hourCounts.indexOf(Math.max(...hourCounts));

    // Calculate streak (consecutive days with sessions)
    const sessionDays = new Set(sessions.map(s => s.startedAt.toISOString().split('T')[0]));
    const sortedDays = Array.from(sessionDays).sort().reverse();

    let longestStreak = 0;
    let currentStreak = 0;
    let prevDate: Date | null = null;

    for (const dayStr of sortedDays) {
      const date = new Date(dayStr);
      if (prevDate) {
        const diffDays = (prevDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
          currentStreak++;
        } else {
          longestStreak = Math.max(longestStreak, currentStreak);
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }
      prevDate = date;
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);

    return {
      totalSessions: sessions.length,
      totalTokens,
      totalHours: Math.round(totalMinutes / 60),
      languageCount: languages.size,
      longestStreak,
      mostActiveHour,
      avgSessionLength: sessions.length > 0 ? Math.round(totalMinutes / sessions.length * 10) / 10 : 0
    };
  }

  // Submit user stats to leaderboard
  submitStats(displayName: string): LeaderboardSubmission {
    const stats = this.getUserStats();

    const submission: LeaderboardSubmission = {
      anonymousId: this.data.userSubmission?.anonymousId || this.generateAnonymousId(),
      displayName: displayName.trim() || 'anonymous',
      submittedAt: new Date().toISOString(),
      stats
    };

    this.data.userSubmission = submission;
    this.data.lastUpdated = new Date().toISOString();
    this.saveData();

    return submission;
  }

  // Remove user from leaderboard
  removeSubmission(): void {
    this.data.userSubmission = null;
    this.data.lastUpdated = new Date().toISOString();
    this.saveData();
  }

  // Get user's submission status
  getSubmission(): LeaderboardSubmission | null {
    return this.data.userSubmission;
  }

  // Get full leaderboard with user's position
  getLeaderboard(category: 'tokens' | 'sessions' | 'streak' | 'languages' | 'hours' = 'tokens'): {
    entries: (LeaderboardSubmission & { rank: number; isUser: boolean })[];
    userRank: number | null;
    totalParticipants: number;
  } {
    // Combine simulated entries with user submission
    const allEntries: LeaderboardSubmission[] = SIMULATED_GLOBAL_ENTRIES.map(e => ({
      ...e,
      submittedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
    }));

    if (this.data.userSubmission) {
      allEntries.push(this.data.userSubmission);
    }

    // Sort by category
    const sortFn = (a: LeaderboardSubmission, b: LeaderboardSubmission) => {
      switch (category) {
        case 'tokens': return b.stats.totalTokens - a.stats.totalTokens;
        case 'sessions': return b.stats.totalSessions - a.stats.totalSessions;
        case 'streak': return b.stats.longestStreak - a.stats.longestStreak;
        case 'languages': return b.stats.languageCount - a.stats.languageCount;
        case 'hours': return b.stats.totalHours - a.stats.totalHours;
        default: return 0;
      }
    };

    allEntries.sort(sortFn);

    const entries = allEntries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      isUser: entry.anonymousId === this.data.userSubmission?.anonymousId
    }));

    const userEntry = entries.find(e => e.isUser);

    return {
      entries,
      userRank: userEntry?.rank || null,
      totalParticipants: entries.length
    };
  }

  // Get user's percentile ranking
  getPercentile(category: 'tokens' | 'sessions' | 'streak' | 'languages' | 'hours' = 'tokens'): number | null {
    const { userRank, totalParticipants } = this.getLeaderboard(category);
    if (!userRank) return null;
    return Math.round((1 - (userRank - 1) / totalParticipants) * 100);
  }

  // Get achievement title based on stats
  getAchievementTitle(): { title: string; emoji: string } {
    const stats = this.getUserStats();

    // Determine primary achievement
    if (stats.longestStreak >= 100) return { title: 'Streak Legend', emoji: '🔥' };
    if (stats.totalTokens >= 30000000) return { title: 'Token Titan', emoji: '👑' };
    if (stats.languageCount >= 10) return { title: 'Polyglot Master', emoji: '🌍' };
    if (stats.totalSessions >= 1000) return { title: 'Session Sovereign', emoji: '⚡' };
    if (stats.mostActiveHour >= 22 || stats.mostActiveHour <= 4) return { title: 'Night Owl', emoji: '🦉' };
    if (stats.mostActiveHour >= 5 && stats.mostActiveHour <= 8) return { title: 'Early Bird', emoji: '🐦' };
    if (stats.totalHours >= 500) return { title: 'Code Marathon', emoji: '🏃' };
    if (stats.longestStreak >= 30) return { title: 'Consistency King', emoji: '📅' };
    if (stats.totalTokens >= 10000000) return { title: 'Power User', emoji: '💪' };
    if (stats.totalSessions >= 500) return { title: 'Dedicated Dev', emoji: '🎯' };
    if (stats.languageCount >= 5) return { title: 'Multi-Linguist', emoji: '🗣️' };
    if (stats.totalSessions >= 100) return { title: 'Rising Star', emoji: '⭐' };

    return { title: 'Explorer', emoji: '🚀' };
  }
}
