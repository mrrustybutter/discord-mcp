import fs from 'fs/promises';
import path from 'path';
import { loggers } from './logger.js';

const logger = loggers.transcript;

interface TranscriptionEntry {
  userId: string;
  username?: string;
  text: string;
  timestamp: number;
  guildId?: string;
  channelId?: string;
}

class TranscriptStore {
  private transcriptPath: string;
  private transcriptions: TranscriptionEntry[] = [];
  private userMap: Map<string, string> = new Map(); // userId -> username

  constructor() {
    this.transcriptPath = path.join(process.cwd(), 'transcripts', `discord-${Date.now()}.json`);
  }

  async initialize(): Promise<void> {
    try {
      // Create transcripts directory if it doesn't exist
      await fs.mkdir(path.dirname(this.transcriptPath), { recursive: true });
      
      // Initialize empty transcript file
      await this.save();
      
      logger.info('Transcript store initialized', { path: this.transcriptPath });
    } catch (error) {
      logger.error('Failed to initialize transcript store', { error });
    }
  }

  async addTranscription(entry: TranscriptionEntry): Promise<void> {
    try {
      // Add username from userMap if not provided
      if (!entry.username && entry.userId) {
        entry.username = this.userMap.get(entry.userId) || `User_${entry.userId.slice(-4)}`;
      }
      
      this.transcriptions.push(entry);
      logger.info('Added transcription', { 
        userId: entry.userId, 
        username: entry.username,
        text: entry.text.substring(0, 50) + '...' 
      });
      
      // Save to file
      await this.save();
    } catch (error) {
      logger.error('Failed to add transcription', { error });
    }
  }

  setUserMapping(userId: string, username: string): void {
    this.userMap.set(userId, username);
    logger.debug('Set user mapping', { userId, username });
  }

  async save(): Promise<void> {
    try {
      const data = {
        createdAt: new Date().toISOString(),
        transcriptions: this.transcriptions,
        userMap: Object.fromEntries(this.userMap)
      };
      
      await fs.writeFile(this.transcriptPath, JSON.stringify(data, null, 2));
      logger.debug('Saved transcript file');
    } catch (error) {
      logger.error('Failed to save transcript', { error });
    }
  }

  getTranscriptions(): TranscriptionEntry[] {
    return this.transcriptions;
  }

  getLatestTranscriptions(count: number = 10): TranscriptionEntry[] {
    return this.transcriptions.slice(-count);
  }

  clear(): void {
    this.transcriptions = [];
    this.userMap.clear();
  }
}

export const transcriptStore = new TranscriptStore();
export type { TranscriptionEntry };