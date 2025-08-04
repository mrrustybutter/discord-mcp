import { EndBehaviorType, type VoiceConnection } from '@discordjs/voice';
import type { TextChannel } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import prism from 'prism-media';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TranscriptLogger } from '../utils/transcript-logger.js';

export class TranscriptionService {
  private activeStreams: Map<string, UserAudioStream> = new Map();
  private genAI: GoogleGenerativeAI;
  private transcriptLogger: TranscriptLogger;
  private isActive = false;

  constructor(
    private connection: VoiceConnection,
    private textChannel?: TextChannel
  ) {
    this.genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    this.transcriptLogger = new TranscriptLogger();
  }

  startTranscription() {
    if (this.isActive) {
      logger.warn('Transcription already active');
      return;
    }

    this.isActive = true;
    const receiver = this.connection.receiver;

    // Start transcript session
    this.transcriptLogger.startSession(
      this.textChannel?.id || 'voice-only',
      this.textChannel?.name || 'Voice Channel'
    );

    // Track active users
    const activeUsers = new Set<string>();

    // Listen for speaking users
    receiver.speaking.on('start', (userId) => {
      if (!this.isActive) return;
      
      logger.debug(`User ${userId} started speaking`);

      if (activeUsers.has(userId)) {
        return;
      }

      activeUsers.add(userId);

      // Subscribe to user audio
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 2000,
        },
      });

      // Create audio processor
      const userStream = new UserAudioStream(
        userId,
        audioStream,
        this.textChannel,
        this.genAI,
        this.transcriptLogger,
        () => {
          this.activeStreams.delete(userId);
          activeUsers.delete(userId);
        }
      );

      this.activeStreams.set(userId, userStream);
    });

    logger.info('Started voice transcription');
  }

  stopTranscription() {
    this.isActive = false;

    // Stop all active streams
    for (const [userId, stream] of this.activeStreams) {
      stream.destroy();
      this.activeStreams.delete(userId);
    }

    // End transcript session
    this.transcriptLogger.endSession();

    logger.info('Stopped voice transcription');
  }
}

class UserAudioStream {
  private opusDecoder: prism.opus.Decoder;
  private audioBuffer: Buffer[] = [];
  private currentUtterance: Buffer[] = [];
  private isSpeaking = false;
  private lastAudioTime = 0;
  private isProcessing = true;
  private processingInterval: NodeJS.Timeout | null = null;
  private silenceFrames = 0;
  private SILENCE_THRESHOLD = 20; // Number of silent frames before ending utterance

  constructor(
    private userId: string,
    private audioStream: any,
    private textChannel: TextChannel | undefined,
    private genAI: GoogleGenerativeAI,
    private transcriptLogger: TranscriptLogger,
    private onEnd: () => void
  ) {
    this.opusDecoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });

    this.processAudioStream();
  }

  private async processAudioStream() {
    try {
      const decoder = this.opusDecoder;
      this.audioStream.pipe(decoder);

      // Set up regular processing
      this.processingInterval = setInterval(() => {
        this.checkForSpeechEnd();
      }, 500);

      // Process audio chunks
      for await (const chunk of decoder) {
        if (!this.isProcessing) break;
        await this.processAudioChunk(chunk as Buffer);
      }

      logger.info(`Audio stream ended for user ${this.userId}`);

      // Finalize any remaining utterance
      if (this.currentUtterance.length > 0) {
        await this.transcribeUtterance();
      }

      this.destroy();
    } catch (error) {
      logger.error(`Error processing audio stream for user ${this.userId}:`, error);
      this.destroy();
    }
  }

  private async processAudioChunk(chunk: Buffer) {
    try {
      // Simple voice detection based on audio energy
      const energy = this.calculateAudioEnergy(chunk);
      const ENERGY_THRESHOLD = 500; // Adjust based on testing

      if (energy > ENERGY_THRESHOLD) {
        // Voice detected
        this.silenceFrames = 0;
        this.lastAudioTime = Date.now();

        if (!this.isSpeaking) {
          this.isSpeaking = true;
          logger.info(`Speech start detected for user ${this.userId}`);
        }

        this.currentUtterance.push(chunk);
      } else {
        // Silence detected
        if (this.isSpeaking) {
          this.silenceFrames++;
          this.currentUtterance.push(chunk); // Include silence in utterance

          if (this.silenceFrames > this.SILENCE_THRESHOLD) {
            // End of speech detected
            logger.info(`Speech end detected for user ${this.userId}`);
            this.isSpeaking = false;
            await this.transcribeUtterance();
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing audio chunk for user ${this.userId}:`, error);
    }
  }

  private calculateAudioEnergy(buffer: Buffer): number {
    let energy = 0;
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      energy += Math.abs(sample);
    }
    return energy / (buffer.length / 2);
  }

  private checkForSpeechEnd() {
    // This is now handled in processAudioChunk
  }

  private async transcribeUtterance() {
    if (this.currentUtterance.length === 0) return;

    try {
      // Combine all chunks
      const pcmBuffer = Buffer.concat(this.currentUtterance);
      const monoBuffer = this.convertToMono16k(pcmBuffer);
      const wavBuffer = this.addWavHeader(monoBuffer, 16000, 1);
      const base64Audio = wavBuffer.toString('base64');

      // Get Gemini model
      const model = this.genAI.getGenerativeModel({
        model: config.GEMINI_MODEL,
      });

      // Transcribe
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64Audio,
          },
        },
        {
          text: 'Please transcribe this audio. If no clear speech is detected, respond with "No speech detected".',
        },
      ]);

      const transcription = result.response.text();

      if (transcription && !transcription.toLowerCase().includes('no speech detected')) {
        // Send to Discord if channel available
        if (this.textChannel) {
          await this.textChannel.send(`<@${this.userId}>: ${transcription}`);
        }

        // Log to transcript
        await this.transcriptLogger.logTranscription(this.userId, transcription);
      }

      // Clear utterance buffer
      this.currentUtterance = [];
    } catch (error) {
      logger.error('Error transcribing audio:', error);
      this.currentUtterance = [];
    }
  }

  destroy() {
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.audioStream) {
      try {
        this.audioStream.destroy();
      } catch (error) {
        logger.error('Error destroying audio stream:', error);
      }
    }

    this.onEnd();
  }

  private convertToMono16k(buffer: Buffer): Buffer {
    const inputSampleRate = 48000;
    const outputSampleRate = 16000;
    const ratio = inputSampleRate / outputSampleRate;
    const inputChannels = 2;
    const bytesPerSample = 2;

    const inputSamples = buffer.length / (bytesPerSample * inputChannels);
    const outputSamples = Math.floor(inputSamples / ratio);
    const outputBuffer = Buffer.alloc(outputSamples * bytesPerSample);

    for (let i = 0; i < outputSamples; i++) {
      const inputIndex = Math.floor(i * ratio) * inputChannels * bytesPerSample;

      if (inputIndex + 3 < buffer.length) {
        const leftSample = buffer.readInt16LE(inputIndex);
        const rightSample = buffer.readInt16LE(inputIndex + 2);
        const monoSample = Math.round((leftSample + rightSample) / 2);

        outputBuffer.writeInt16LE(monoSample, i * bytesPerSample);
      }
    }

    return outputBuffer;
  }

  private addWavHeader(pcmData: Buffer, sampleRate: number, numChannels: number): Buffer {
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const dataSize = pcmData.length;
    const buffer = Buffer.alloc(44 + pcmData.length);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    pcmData.copy(buffer, 44);

    return buffer;
  }
}