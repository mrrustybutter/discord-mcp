import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { logger } from './logger.js';

interface TranscriptEntry {
  timestamp: string;
  userId: string;
  username?: string;
  transcription: string;
}

export class TranscriptLogger {
  private currentSession: TranscriptEntry[] = [];
  private sessionStartTime: Date | null = null;
  private channelId: string | null = null;
  private channelName: string | null = null;
  private userMapping: Map<string, string> = new Map();

  async startSession(channelId: string, channelName: string) {
    this.currentSession = [];
    this.sessionStartTime = new Date();
    this.channelId = channelId;
    this.channelName = channelName;
    this.userMapping.clear();
    
    logger.info(`Started transcript session for channel ${channelName} (${channelId})`);
  }

  async logTranscription(userId: string, transcription: string, username?: string) {
    if (!this.sessionStartTime || !config.ENABLE_TRANSCRIPT_LOGGING) {
      return;
    }

    // Update user mapping if we have a username
    if (username && !this.userMapping.has(userId)) {
      this.userMapping.set(userId, username);
    }

    const entry: TranscriptEntry = {
      timestamp: new Date().toISOString(),
      userId,
      username: username || this.userMapping.get(userId),
      transcription,
    };

    this.currentSession.push(entry);
    
    logger.debug(`Logged transcription from ${username || userId}: ${transcription.substring(0, 50)}...`);
  }

  async endSession() {
    if (!this.sessionStartTime || this.currentSession.length === 0) {
      logger.info('No transcripts to save');
      return;
    }

    if (!config.ENABLE_TRANSCRIPT_LOGGING) {
      logger.info('Transcript logging disabled');
      return;
    }

    try {
      // Ensure transcript directory exists
      await mkdir(config.TRANSCRIPT_DIR, { recursive: true });

      // Generate filename
      const timestamp = this.sessionStartTime.toISOString().replace(/[:.]/g, '-');
      const filename = `transcript-${this.channelId}-${timestamp}.json`;
      const filepath = join(config.TRANSCRIPT_DIR, filename);

      // Create transcript data
      const transcriptData = {
        session: {
          startTime: this.sessionStartTime.toISOString(),
          endTime: new Date().toISOString(),
          channelId: this.channelId,
          channelName: this.channelName,
          messageCount: this.currentSession.length,
        },
        userMapping: Object.fromEntries(this.userMapping),
        messages: this.currentSession,
      };

      // Write to file
      await writeFile(filepath, JSON.stringify(transcriptData, null, 2));
      
      logger.info(`Saved transcript to ${filename} (${this.currentSession.length} messages)`);
    } catch (error) {
      logger.error('Error saving transcript:', error);
    }

    // Reset session
    this.currentSession = [];
    this.sessionStartTime = null;
    this.channelId = null;
    this.channelName = null;
    this.userMapping.clear();
  }
}