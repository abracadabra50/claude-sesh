import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface SessionBookmark {
  sessionId: string;
  starred: boolean;
  tags: string[];
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookmarksData {
  version: number;
  bookmarks: Record<string, SessionBookmark>;
}

class BookmarksService {
  private dataDir: string;
  private filePath: string;
  private data: BookmarksData;

  constructor() {
    this.dataDir = join(homedir(), '.claude-sesh');
    this.filePath = join(this.dataDir, 'bookmarks.json');
    this.data = this.loadData();
  }

  private loadData(): BookmarksData {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    if (!existsSync(this.filePath)) {
      return { version: 1, bookmarks: {} };
    }

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(content);
      // Convert date strings back to Date objects
      for (const bookmark of Object.values(parsed.bookmarks) as SessionBookmark[]) {
        bookmark.createdAt = new Date(bookmark.createdAt);
        bookmark.updatedAt = new Date(bookmark.updatedAt);
      }
      return parsed;
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
      return { version: 1, bookmarks: {} };
    }
  }

  private saveData(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Failed to save bookmarks:', error);
    }
  }

  private getOrCreateBookmark(sessionId: string): SessionBookmark {
    if (!this.data.bookmarks[sessionId]) {
      this.data.bookmarks[sessionId] = {
        sessionId,
        starred: false,
        tags: [],
        note: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return this.data.bookmarks[sessionId];
  }

  getBookmark(sessionId: string): SessionBookmark | null {
    return this.data.bookmarks[sessionId] || null;
  }

  getAllBookmarks(): SessionBookmark[] {
    return Object.values(this.data.bookmarks);
  }

  getStarredSessions(): SessionBookmark[] {
    return Object.values(this.data.bookmarks).filter(b => b.starred);
  }

  toggleStar(sessionId: string): boolean {
    const bookmark = this.getOrCreateBookmark(sessionId);
    bookmark.starred = !bookmark.starred;
    bookmark.updatedAt = new Date();
    this.saveData();
    return bookmark.starred;
  }

  setStar(sessionId: string, starred: boolean): void {
    const bookmark = this.getOrCreateBookmark(sessionId);
    bookmark.starred = starred;
    bookmark.updatedAt = new Date();
    this.saveData();
  }

  addTag(sessionId: string, tag: string): string[] {
    const bookmark = this.getOrCreateBookmark(sessionId);
    const normalizedTag = tag.trim().toLowerCase();
    if (normalizedTag && !bookmark.tags.includes(normalizedTag)) {
      bookmark.tags.push(normalizedTag);
      bookmark.updatedAt = new Date();
      this.saveData();
    }
    return bookmark.tags;
  }

  removeTag(sessionId: string, tag: string): string[] {
    const bookmark = this.getOrCreateBookmark(sessionId);
    const normalizedTag = tag.trim().toLowerCase();
    bookmark.tags = bookmark.tags.filter(t => t !== normalizedTag);
    bookmark.updatedAt = new Date();
    this.saveData();
    return bookmark.tags;
  }

  setTags(sessionId: string, tags: string[]): string[] {
    const bookmark = this.getOrCreateBookmark(sessionId);
    bookmark.tags = tags.map(t => t.trim().toLowerCase()).filter(t => t);
    bookmark.updatedAt = new Date();
    this.saveData();
    return bookmark.tags;
  }

  setNote(sessionId: string, note: string): void {
    const bookmark = this.getOrCreateBookmark(sessionId);
    bookmark.note = note.trim();
    bookmark.updatedAt = new Date();
    this.saveData();
  }

  getNote(sessionId: string): string {
    return this.data.bookmarks[sessionId]?.note || '';
  }

  getAllTags(): string[] {
    const allTags = new Set<string>();
    for (const bookmark of Object.values(this.data.bookmarks)) {
      for (const tag of bookmark.tags) {
        allTags.add(tag);
      }
    }
    return Array.from(allTags).sort();
  }

  getSessionsByTag(tag: string): string[] {
    const normalizedTag = tag.trim().toLowerCase();
    return Object.values(this.data.bookmarks)
      .filter(b => b.tags.includes(normalizedTag))
      .map(b => b.sessionId);
  }

  deleteBookmark(sessionId: string): void {
    delete this.data.bookmarks[sessionId];
    this.saveData();
  }

  // Clean up bookmarks for sessions that no longer exist
  cleanup(existingSessionIds: Set<string>): number {
    let removed = 0;
    for (const sessionId of Object.keys(this.data.bookmarks)) {
      if (!existingSessionIds.has(sessionId)) {
        delete this.data.bookmarks[sessionId];
        removed++;
      }
    }
    if (removed > 0) {
      this.saveData();
    }
    return removed;
  }
}

export const bookmarksService = new BookmarksService();
