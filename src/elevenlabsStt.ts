import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export class ElevenLabsSTT {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is required');
    }
  }

  async transcribeAudio(audioBuffer: Buffer, options: {
    language?: string;
    speakerDiarization?: boolean;
    timestamps?: 'word' | 'character';
    webhook?: string;
  } = {}): Promise<{
    text: string;
    speakers?: Array<{
      speaker: string;
      text: string;
      start_time?: number;
      end_time?: number;
    }>;
    words?: Array<{
      text: string;
      start_time: number;
      end_time: number;
    }>;
  }> {
    try {
      console.error('[ElevenLabs STT] Starting transcription...');
      
      // Convert PCM audio buffer to WAV format for API
      const wavBuffer = await this.convertPCMToWAV(audioBuffer);
      
      console.error('[ElevenLabs STT] Converted to WAV format, size:', wavBuffer.length);
      
      // Prepare form data
      const formData = new FormData();
      
      // Create a blob from the WAV buffer
      const audioBlob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
      formData.append('audio', audioBlob, 'audio.wav');
      
      // Add optional parameters
      if (options.language) {
        formData.append('language', options.language);
      }
      
      if (options.speakerDiarization) {
        formData.append('speaker_diarization', 'true');
      }
      
      if (options.timestamps) {
        formData.append('timestamps', options.timestamps);
      }
      
      if (options.webhook) {
        formData.append('webhook', options.webhook);
      }

      // Make API request
      const response = await fetch(`${this.baseUrl}/v1/speech-to-text`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ElevenLabs STT] API Error:', response.status, errorText);
        throw new Error(`ElevenLabs STT API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.error('[ElevenLabs STT] Transcription completed successfully');
      
      return result;
    } catch (error) {
      console.error('[ElevenLabs STT] Error:', error);
      throw error;
    }
  }

  private async convertPCMToWAV(pcmBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      
      // Use ffmpeg to convert PCM to WAV
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',           // Input format: 16-bit signed little endian
        '-ar', '48000',          // Sample rate: 48kHz (Discord standard)
        '-ac', '2',              // Channels: stereo
        '-i', 'pipe:0',          // Input from stdin
        '-f', 'wav',             // Output format: WAV
        '-acodec', 'pcm_s16le',  // Audio codec: PCM 16-bit
        'pipe:1'                 // Output to stdout
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg exited with code ${code}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      
      ffmpeg.on('error', reject);
      ffmpeg.stderr.on('data', () => {}); // Ignore stderr
      
      // Send PCM data to ffmpeg
      ffmpeg.stdin.write(pcmBuffer);
      ffmpeg.stdin.end();
    });
  }

  // Method for real-time transcription buffering
  async transcribeBufferedAudio(audioBuffers: Buffer[], minDurationMs: number = 1000): Promise<string | null> {
    // Combine buffers
    const combinedBuffer = Buffer.concat(audioBuffers);
    
    // Check if we have enough audio (rough estimation)
    const sampleRate = 48000;
    const channels = 2;
    const bytesPerSample = 2;
    const estimatedDurationMs = (combinedBuffer.length / (sampleRate * channels * bytesPerSample)) * 1000;
    
    if (estimatedDurationMs < minDurationMs) {
      return null; // Not enough audio yet
    }
    
    try {
      const result = await this.transcribeAudio(combinedBuffer, {
        timestamps: 'word',
        speakerDiarization: false
      });
      
      return result.text;
    } catch (error) {
      console.error('[ElevenLabs STT] Buffer transcription error:', error);
      return null;
    }
  }
}