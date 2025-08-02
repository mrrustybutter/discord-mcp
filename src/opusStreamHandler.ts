import { EventEmitter } from 'events';
import prism from 'prism-media';
import { Writable, PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

interface OpusPacketData {
  ssrc: number;
  userId?: string;
  sequenceNumber: number;
  timestamp: number;
  opus: Buffer;
}

interface UserAudioStream {
  userId: string;
  ssrc: number;
  decoder: prism.opus.Decoder;
  pcmStream: PassThrough;
  lastPacketTime: number;
  audioChunks: Buffer[];
  silenceTimer?: NodeJS.Timeout;
}

export class OpusStreamHandler extends EventEmitter {
  private userStreams = new Map<number, UserAudioStream>();
  private silenceThreshold = 1000; // 1 second of silence before emitting audio

  constructor() {
    super();
  }

  handleOpusPacket(data: OpusPacketData): void {
    const { ssrc, userId, opus } = data;
    
    // Get or create stream for this user
    let stream = this.userStreams.get(ssrc);
    
    if (!stream) {
      // Create new decoder for this user
      const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
      });
      
      const pcmStream = new PassThrough();
      
      stream = {
        userId: userId || `unknown_${ssrc}`,
        ssrc,
        decoder,
        pcmStream,
        lastPacketTime: Date.now(),
        audioChunks: []
      };
      
      // Collect PCM data
      pcmStream.on('data', (chunk: Buffer) => {
        stream!.audioChunks.push(chunk);
      });
      
      this.userStreams.set(ssrc, stream);
      console.error(`[OpusHandler] Created new stream for SSRC ${ssrc}, user: ${stream.userId}`);
    }
    
    // Update last packet time
    stream.lastPacketTime = Date.now();
    
    // Clear existing silence timer
    if (stream.silenceTimer) {
      clearTimeout(stream.silenceTimer);
    }
    
    // Write opus packet to decoder
    try {
      stream.decoder.write(opus);
      
      // Set new silence timer
      stream.silenceTimer = setTimeout(() => {
        this.handleSilence(ssrc);
      }, this.silenceThreshold);
      
    } catch (error) {
      console.error(`[OpusHandler] Error decoding opus for SSRC ${ssrc}:`, error);
    }
  }

  private handleSilence(ssrc: number): void {
    const stream = this.userStreams.get(ssrc);
    if (!stream || stream.audioChunks.length === 0) return;
    
    // Combine all audio chunks
    const fullAudio = Buffer.concat(stream.audioChunks);
    
    if (fullAudio.length > 0) {
      const duration = fullAudio.length / (48000 * 2 * 2); // seconds
      console.error(`[OpusHandler] User ${stream.userId} finished speaking, PCM size: ${fullAudio.length} bytes (${duration.toFixed(2)}s)`);
      
      // Only process if we have enough audio (at least 0.5 seconds)
      if (duration >= 0.5) {
        // Save PCM audio for debugging
        const debugDir = path.join(__dirname, '..', 'audio-debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        const timestamp = Date.now();
        const filename = path.join(debugDir, `pcm_${stream.userId}_${timestamp}.raw`);
        fs.writeFileSync(filename, fullAudio);
        console.error(`[OpusHandler] Saved PCM audio to ${filename}, size: ${fullAudio.length} bytes`);
        
        // Emit complete audio segment for transcription
        this.emit('audioSegment', {
          userId: stream.userId,
          ssrc: stream.ssrc,
          pcmAudio: fullAudio,
          duration: duration
        });
      } else {
        console.error(`[OpusHandler] Skipping short audio segment (${duration.toFixed(2)}s)`);
      }
    }
    
    // Clear audio chunks for next segment
    stream.audioChunks = [];
  }

  cleanup(): void {
    // Clean up all streams
    for (const [ssrc, stream] of this.userStreams) {
      if (stream.silenceTimer) {
        clearTimeout(stream.silenceTimer);
      }
      stream.decoder.destroy();
      stream.pcmStream.destroy();
    }
    this.userStreams.clear();
  }
}