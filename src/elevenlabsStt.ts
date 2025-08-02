import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loggers } from './logger.js';
import FormData from 'form-data';

const logger = loggers.stt;

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
      logger.debug('Starting transcription');
      
      // Convert PCM audio buffer to WAV format for API
      const wavBuffer = await this.convertPCMToWAV(audioBuffer);
      
      logger.debug('Converted to WAV format', { size: wavBuffer.length });
      
      // Prepare form data
      const formData = new FormData();
      
      // Append the WAV buffer directly - API expects 'file' field
      formData.append('file', wavBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });
      
      // Add required model_id parameter
      formData.append('model_id', 'scribe_v1');
      
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

      // Debug: Log the form data headers
      const formHeaders = formData.getHeaders();
      logger.debug('FormData headers', { headers: formHeaders });
      
      // Make API request
      const response = await fetch(`${this.baseUrl}/v1/speech-to-text`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          ...formHeaders
        },
        body: formData as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('API Error', { 
          status: response.status, 
          statusText: response.statusText,
          headers: response.headers,
          error: errorText,
          apiKey: this.apiKey.substring(0, 10) + '...',
          audioSize: wavBuffer.length,
          endpoint: `${this.baseUrl}/v1/speech-to-text`
        });
        throw new Error(`ElevenLabs STT API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      logger.debug('Transcription completed successfully');
      
      return result;
    } catch (error) {
      logger.error('Transcription error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        component: 'stt'
      });
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
      logger.error('Buffer transcription error', { error });
      return null;
    }
  }
}