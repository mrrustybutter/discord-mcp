import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { Readable } from 'stream';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class ElevenLabsService {
  private client: ElevenLabsClient;

  constructor() {
    this.client = new ElevenLabsClient({
      apiKey: config.ELEVENLABS_API_KEY,
    });
  }

  async generateSpeech(text: string, voiceId?: string): Promise<Readable> {
    try {
      logger.info(`Generating speech for text: "${text.substring(0, 50)}..."`);

      const audioStream = await this.client.textToSpeech.convert(
        voiceId || config.ELEVENLABS_VOICE_ID,
        {
          text,
          model_id: config.ELEVENLABS_MODEL_ID,
          output_format: config.ELEVENLABS_OUTPUT_FORMAT as any,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.1,
          },
        }
      );

      // Convert async iterator to Node.js readable stream
      const readable = Readable.from(audioStream);
      
      return readable;
    } catch (error) {
      logger.error('Error generating speech with ElevenLabs:', error);
      throw error;
    }
  }

  async listVoices() {
    try {
      const voices = await this.client.voices.getAll();
      return voices.voices.map((voice) => ({
        id: voice.voice_id,
        name: voice.name,
        category: voice.category,
        description: voice.description,
      }));
    } catch (error) {
      logger.error('Error listing ElevenLabs voices:', error);
      throw error;
    }
  }
}