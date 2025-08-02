import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';
import { loggers } from './logger.js';

const logger = loggers.tts;

export class ElevenLabsService {
  private client: ElevenLabsClient;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string) {
    this.client = new ElevenLabsClient({ apiKey });
    this.voiceId = voiceId;
  }

  async generateSpeech(text: string): Promise<Buffer> {
    try {
      logger.debug('Generating speech for text', { text });
      
      // Generate audio using textToSpeech
      const audioStream = await this.client.textToSpeech.convert(this.voiceId, {
        text,
        modelId: 'eleven_monolingual_v1',
        voiceSettings: {
          stability: 0.5,
          similarityBoost: 0.5,
          style: 0.0,
          useSpeakerBoost: true
        }
      });

      // Convert ReadableStream to Buffer
      const reader = audioStream.getReader();
      const chunks: Uint8Array[] = [];
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      
      const audioBuffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
      logger.debug('Generated audio buffer', { size: audioBuffer.length });
      return audioBuffer;
    } catch (error) {
      logger.error('Error generating speech', { error });
      throw error;
    }
  }

  async streamSpeech(text: string): Promise<ReadableStream<Uint8Array>> {
    logger.debug('Streaming speech for text', { text });
    
    const audioStream = await this.client.textToSpeech.convert(this.voiceId, {
      text,
      modelId: 'eleven_monolingual_v1',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.5,
        style: 0.0,
        useSpeakerBoost: true
      }
    });

    return audioStream;
  }
}