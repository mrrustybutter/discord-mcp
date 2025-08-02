import { VoiceConnection, VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { pipeline } from 'stream';
import prism from 'prism-media';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TranscriptMessage {
  userId: string;
  username: string;
  timestamp: number;
  text: string;
}

interface TranscriptData {
  server: {
    id: string;
    name?: string;
  };
  channel: {
    id: string;
    name?: string;
  };
  startTime: string;
  endTime?: string;
  users: {
    [userId: string]: {
      id: string;
      username: string;
    };
  };
  messages: TranscriptMessage[];
}

interface ActiveTranscript {
  serverId: string;
  serverName?: string;
  channelId: string;
  channelName?: string;
  startTime: number;
  transcriptPath: string;
  messages: TranscriptMessage[];
  maxMessages: number;
  activeStreams: Map<string, any>;
  userMap: Map<string, string>;
}

export class RealtimeTranscriptHandler {
  private transcripts = new Map<string, ActiveTranscript>();
  private whisperModelPath?: string;
  private maxMessages: number;

  constructor(whisperModelPath?: string, maxMessages: number = 100) {
    this.whisperModelPath = whisperModelPath || 'base.en';
    this.maxMessages = maxMessages;
  }

  async startTranscription(
    connection: VoiceConnection | null, 
    serverId: string, 
    channelId: string,
    guildMembers: Map<string, string>,
    serverName?: string,
    channelName?: string
  ): Promise<string> {
    // Create transcript file
    const transcriptDir = path.join(__dirname, '..', 'transcripts');
    await fs.mkdir(transcriptDir, { recursive: true });
    
    // Use channel ID as filename
    const transcriptPath = path.join(transcriptDir, `${channelId}.json`);
    
    // Initialize transcript data
    const transcriptData: TranscriptData = {
      server: {
        id: serverId,
        name: serverName
      },
      channel: {
        id: channelId,
        name: channelName
      },
      startTime: new Date().toISOString(),
      users: {},
      messages: []
    };
    
    // Add known users
    for (const [userId, username] of guildMembers) {
      transcriptData.users[userId] = { id: userId, username };
    }
    
    // Write initial JSON
    await fs.writeFile(transcriptPath, JSON.stringify(transcriptData, null, 2));

    const transcript: ActiveTranscript = {
      serverId,
      serverName,
      channelId,
      channelName,
      startTime: Date.now(),
      transcriptPath,
      messages: [],
      maxMessages: this.maxMessages,
      activeStreams: new Map(),
      userMap: new Map(guildMembers)
    };

    // Only set up receiver if we have a connection
    if (connection && connection.receiver) {
      const receiver = connection.receiver;

      // Listen to speaking events
      receiver.speaking.on('start', (userId) => {
        const username = transcript.userMap.get(userId) || 'Unknown User';
        console.error(`[Transcript] ${username} started speaking`);
        
        if (!transcript.activeStreams.has(userId)) {
          this.setupUserStream(receiver, userId, username, transcript);
        }
      });
    }

    this.transcripts.set(serverId, transcript);
    console.error(`[Transcript] Started transcription for server ${serverId}, file: ${transcriptPath}`);
    
    return transcriptPath;
  }

  private setupUserStream(receiver: VoiceReceiver, userId: string, username: string, transcript: ActiveTranscript): void {
    const startTime = Date.now();
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000, // 1 second of silence
      },
    });

    // Create temporary audio file
    const audioPath = path.join(path.dirname(transcript.transcriptPath), `temp_${userId}_${startTime}.pcm`);
    const writeStream = createWriteStream(audioPath);

    // Decode opus to PCM
    const opusDecoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

    pipeline(audioStream, opusDecoder, writeStream, async (err) => {
      if (err) {
        console.error(`[Transcript Error] Error recording ${username}:`, err);
      } else {
        // Convert and transcribe
        try {
          const wavPath = audioPath.replace('.pcm', '.wav');
          await this.convertPcmToWav(audioPath, wavPath);
          
          const text = await this.transcribeWithWhisper(wavPath);
          
          // Add to transcript
          await this.addTranscriptMessage(transcript, {
            userId,
            username,
            timestamp: startTime,
            text: text.trim()
          });
          
          // Clean up temp files
          await fs.unlink(audioPath).catch(() => {});
          await fs.unlink(wavPath).catch(() => {});
          
        } catch (error) {
          console.error(`[Transcript Error] Failed to process audio for ${username}:`, error);
        }
      }
      
      transcript.activeStreams.delete(userId);
    });

    transcript.activeStreams.set(userId, { audioStream, writeStream });
  }

  async addTranscriptMessage(transcript: ActiveTranscript, message: TranscriptMessage): Promise<void> {
    // Add to memory
    transcript.messages.push(message);
    
    // Trim if over limit
    if (transcript.messages.length > transcript.maxMessages) {
      transcript.messages = transcript.messages.slice(-transcript.maxMessages);
    }
    
    try {
      // Read current JSON
      const jsonContent = await fs.readFile(transcript.transcriptPath, 'utf-8');
      const transcriptData: TranscriptData = JSON.parse(jsonContent);
      
      // Add message
      transcriptData.messages.push(message);
      
      // Update user if not in users list
      if (!transcriptData.users[message.userId]) {
        transcriptData.users[message.userId] = {
          id: message.userId,
          username: message.username
        };
      }
      
      // Write back to file
      await fs.writeFile(transcript.transcriptPath, JSON.stringify(transcriptData, null, 2));
      
      console.error(`[Transcript] Added message from ${message.username}: ${message.text}`);
    } catch (error) {
      console.error('[Transcript Error] Failed to update transcript file:', error);
    }
  }

  private async convertPcmToWav(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', inputPath,
        '-f', 'wav',
        '-y',
        outputPath
      ]);

      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });
  }

  private async transcribeWithWhisper(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const whisper = spawn('whisper', [
        audioPath,
        '--model', this.whisperModelPath || 'base.en',
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', path.dirname(audioPath),
        '--verbose', 'False'
      ]);

      let stderr = '';
      whisper.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      whisper.on('error', reject);
      whisper.on('close', async (code) => {
        if (code === 0) {
          const txtPath = audioPath.replace('.wav', '.txt');
          try {
            const transcript = await fs.readFile(txtPath, 'utf-8');
            await fs.unlink(txtPath);
            resolve(transcript.trim());
          } catch (error) {
            reject(new Error('Failed to read transcript file'));
          }
        } else {
          reject(new Error(`Whisper exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  async getAndClearTranscript(serverId: string): Promise<string | null> {
    const transcript = this.transcripts.get(serverId);
    if (!transcript) return null;

    try {
      // Read current transcript JSON
      const jsonContent = await fs.readFile(transcript.transcriptPath, 'utf-8');
      const transcriptData: TranscriptData = JSON.parse(jsonContent);
      
      // Add end time
      transcriptData.endTime = new Date().toISOString();
      
      // Clear the transcript - reset to initial state
      const clearedData: TranscriptData = {
        server: transcriptData.server,
        channel: transcriptData.channel,
        startTime: new Date().toISOString(),
        users: transcriptData.users, // Keep users list
        messages: []
      };
      
      await fs.writeFile(transcript.transcriptPath, JSON.stringify(clearedData, null, 2));
      
      // Clear messages in memory
      transcript.messages = [];
      transcript.startTime = Date.now();
      
      // Return the complete transcript as JSON
      return JSON.stringify(transcriptData, null, 2);
    } catch (error) {
      console.error('[Transcript Error] Failed to read/clear transcript:', error);
      return null;
    }
  }

  async stopTranscription(serverId: string): Promise<void> {
    const transcript = this.transcripts.get(serverId);
    if (!transcript) return;

    // Close all active streams
    for (const [, streamData] of transcript.activeStreams) {
      if (streamData.writeStream && !streamData.writeStream.destroyed) {
        streamData.writeStream.end();
      }
    }

    try {
      // Update JSON with end time
      const jsonContent = await fs.readFile(transcript.transcriptPath, 'utf-8');
      const transcriptData: TranscriptData = JSON.parse(jsonContent);
      transcriptData.endTime = new Date().toISOString();
      await fs.writeFile(transcript.transcriptPath, JSON.stringify(transcriptData, null, 2));
    } catch (error) {
      console.error('[Transcript Error] Failed to update end time:', error);
    }
    
    this.transcripts.delete(serverId);
    console.error(`[Transcript] Stopped transcription for server ${serverId}`);
  }

  isTranscribing(serverId: string): boolean {
    return this.transcripts.has(serverId);
  }

  getTranscriptPath(serverId: string): string | null {
    const transcript = this.transcripts.get(serverId);
    return transcript ? transcript.transcriptPath : null;
  }

  // Get recent messages from memory without clearing
  getRecentMessages(serverId: string, limit: number = 10): TranscriptMessage[] {
    const transcript = this.transcripts.get(serverId);
    if (!transcript) return [];
    
    return transcript.messages.slice(-limit);
  }
  
  // Get the active transcript for a server
  getTranscript(serverId: string): ActiveTranscript | undefined {
    return this.transcripts.get(serverId);
  }
}