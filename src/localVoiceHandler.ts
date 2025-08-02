import { VoiceConnection, VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { pipeline } from 'stream';
import { createWriteStream } from 'fs';
import prism from 'prism-media';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface VoiceSegment {
  userId: string;
  username: string;
  startTime: number;
  endTime: number;
  audioPath: string;
  transcript?: string;
}

interface VoiceRecording {
  serverId: string;
  startTime: number;
  segments: VoiceSegment[];
  activeStreams: Map<string, any>;
  outputDir: string;
  userMap: Map<string, string>; // userId -> username
}

export class LocalVoiceHandler {
  private recordings = new Map<string, VoiceRecording>();
  private whisperModelPath?: string;

  constructor(whisperModelPath?: string) {
    this.whisperModelPath = whisperModelPath || 'base.en';
  }

  async startRecording(connection: VoiceConnection, serverId: string, guildMembers: Map<string, string>): Promise<void> {
    const outputDir = path.join(__dirname, '..', 'recordings', `${serverId}_${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    const recording: VoiceRecording = {
      serverId,
      startTime: Date.now(),
      segments: [],
      activeStreams: new Map(),
      outputDir,
      userMap: new Map(guildMembers)
    };

    const receiver = connection.receiver;

    // Listen to speaking events
    receiver.speaking.on('start', (userId) => {
      const username = recording.userMap.get(userId) || 'Unknown User';
      console.error(`[Discord Voice] ${username} started speaking`);
      
      if (!recording.activeStreams.has(userId)) {
        this.setupUserStream(receiver, userId, username, recording);
      }
    });

    this.recordings.set(serverId, recording);
  }

  private setupUserStream(receiver: VoiceReceiver, userId: string, username: string, recording: VoiceRecording): void {
    const startTime = Date.now();
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000, // 1 second of silence before ending
      },
    });

    const outputPath = path.join(recording.outputDir, `${userId}_${startTime}.pcm`);
    const writeStream = createWriteStream(outputPath);

    // Decode opus to PCM
    const opusDecoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

    const segment: VoiceSegment = {
      userId,
      username,
      startTime,
      endTime: 0,
      audioPath: outputPath
    };

    pipeline(audioStream, opusDecoder, writeStream, async (err) => {
      if (err) {
        console.error(`[Voice Error] Error recording ${username}:`, err);
      } else {
        segment.endTime = Date.now();
        recording.segments.push(segment);
        console.error(`[Voice] Finished recording segment for ${username} (${(segment.endTime - segment.startTime) / 1000}s)`);
      }
      recording.activeStreams.delete(userId);
    });

    recording.activeStreams.set(userId, { audioStream, writeStream, segment });
  }

  async stopRecording(serverId: string): Promise<{ transcript: string, segments: VoiceSegment[] }> {
    const recording = this.recordings.get(serverId);
    if (!recording) throw new Error('No recording found for this server');

    // Close all active streams
    for (const [, streamData] of recording.activeStreams) {
      if (streamData.writeStream && !streamData.writeStream.destroyed) {
        streamData.writeStream.end();
        streamData.segment.endTime = Date.now();
        recording.segments.push(streamData.segment);
      }
    }

    // Wait for streams to close
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Sort segments by start time
    recording.segments.sort((a, b) => a.startTime - b.startTime);

    // Convert and transcribe each segment
    for (const segment of recording.segments) {
      const wavPath = segment.audioPath.replace('.pcm', '.wav');
      
      // Convert PCM to WAV
      await this.convertPcmToWav(segment.audioPath, wavPath);
      
      // Transcribe using local Whisper
      try {
        segment.transcript = await this.transcribeWithWhisper(wavPath);
      } catch (error) {
        console.error(`[Whisper Error] Failed to transcribe ${segment.username}:`, error);
        segment.transcript = '[Transcription failed]';
      }

      // Clean up PCM file
      await fs.unlink(segment.audioPath);
    }

    // Generate formatted transcript with usernames and timestamps
    const transcript = this.generateFormattedTranscript(recording.segments, recording.startTime);
    
    this.recordings.delete(serverId);

    return { transcript, segments: recording.segments };
  }

  private async convertPcmToWav(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',       // Input format: signed 16-bit little-endian
        '-ar', '48000',      // Sample rate: 48kHz
        '-ac', '2',          // Channels: stereo
        '-i', inputPath,     // Input file
        '-f', 'wav',         // Output format
        '-y',                // Overwrite output
        outputPath           // Output file
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
          // Read the generated transcript
          const txtPath = audioPath.replace('.wav', '.txt');
          try {
            const transcript = await fs.readFile(txtPath, 'utf-8');
            await fs.unlink(txtPath); // Clean up
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

  private generateFormattedTranscript(segments: VoiceSegment[], recordingStartTime: number): string {
    let transcript = '=== Discord Voice Transcript ===\n';
    transcript += `Recording started at: ${new Date(recordingStartTime).toISOString()}\n\n`;

    for (const segment of segments) {
      const relativeTime = Math.floor((segment.startTime - recordingStartTime) / 1000);
      const duration = Math.floor((segment.endTime - segment.startTime) / 1000);
      
      transcript += `[${this.formatTime(relativeTime)}] ${segment.username} (${duration}s):\n`;
      transcript += `${segment.transcript || '[No transcript]'}\n\n`;
    }

    transcript += `\nTotal recording duration: ${this.formatTime(Math.floor((Date.now() - recordingStartTime) / 1000))}`;
    
    return transcript;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  isRecording(serverId: string): boolean {
    return this.recordings.has(serverId);
  }

  async cleanupRecordings(serverId: string): Promise<void> {
    const recording = this.recordings.get(serverId);
    if (!recording) return;

    try {
      await fs.rm(recording.outputDir, { recursive: true, force: true });
    } catch (error) {
      console.error('[Cleanup Error]', error);
    }
  }

  // Get live transcript during recording
  getPartialTranscript(serverId: string): string | null {
    const recording = this.recordings.get(serverId);
    if (!recording) return null;

    const completedSegments = recording.segments.filter(s => s.endTime > 0);
    if (completedSegments.length === 0) return "No completed segments yet...";

    return this.generateFormattedTranscript(completedSegments, recording.startTime);
  }
}