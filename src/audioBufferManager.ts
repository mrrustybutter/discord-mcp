import { EventEmitter } from 'events';

interface AudioChunk {
  pcmData: Buffer;
  timestamp: number;
  userId?: string;
}

export class AudioBufferManager extends EventEmitter {
  private buffers = new Map<string, AudioChunk[]>();
  private bufferTimeoutMs: number;
  private maxBufferSizeMs: number;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(bufferTimeoutMs = 2000, maxBufferSizeMs = 10000) {
    super();
    this.bufferTimeoutMs = bufferTimeoutMs;
    this.maxBufferSizeMs = maxBufferSizeMs;
  }

  addAudioChunk(userId: string, pcmData: Buffer): void {
    const chunk: AudioChunk = {
      pcmData,
      timestamp: Date.now(),
      userId
    };

    // Initialize buffer for this user if needed
    if (!this.buffers.has(userId)) {
      this.buffers.set(userId, []);
    }

    const userBuffer = this.buffers.get(userId)!;
    userBuffer.push(chunk);

    // Clear existing timer
    const existingTimer = this.timers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer to flush buffer after silence
    const timer = setTimeout(() => {
      this.flushBuffer(userId);
    }, this.bufferTimeoutMs);
    this.timers.set(userId, timer);

    // Check if buffer is getting too large
    const totalDuration = this.estimateBufferDuration(userBuffer);
    if (totalDuration > this.maxBufferSizeMs) {
      console.warn(`[AudioBufferManager] Buffer for ${userId} exceeded max size, flushing`);
      this.flushBuffer(userId);
    }

    console.error(`[AudioBufferManager] Added chunk for ${userId}, buffer size: ${userBuffer.length} chunks`);
  }

  private flushBuffer(userId: string): void {
    const userBuffer = this.buffers.get(userId);
    if (!userBuffer || userBuffer.length === 0) {
      return;
    }

    console.error(`[AudioBufferManager] Flushing buffer for ${userId} with ${userBuffer.length} chunks`);

    // Combine all PCM data
    const combinedBuffer = Buffer.concat(userBuffer.map(chunk => chunk.pcmData));
    
    // Emit for transcription
    this.emit('audioReady', {
      userId,
      audioBuffer: combinedBuffer,
      startTime: userBuffer[0].timestamp,
      endTime: userBuffer[userBuffer.length - 1].timestamp,
      chunkCount: userBuffer.length
    });

    // Clear the buffer
    this.buffers.set(userId, []);
    
    // Clear timer
    const timer = this.timers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(userId);
    }
  }

  private estimateBufferDuration(chunks: AudioChunk[]): number {
    if (chunks.length === 0) return 0;
    
    // Rough estimation based on PCM data size
    // 48kHz, 2 channels, 16-bit = 192,000 bytes per second
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.pcmData.length, 0);
    const bytesPerSecond = 48000 * 2 * 2; // 192,000
    return (totalBytes / bytesPerSecond) * 1000; // ms
  }

  forceFlushAll(): void {
    console.error('[AudioBufferManager] Force flushing all buffers');
    for (const userId of this.buffers.keys()) {
      this.flushBuffer(userId);
    }
  }

  getStats(): { users: number; totalChunks: number } {
    let totalChunks = 0;
    for (const buffer of this.buffers.values()) {
      totalChunks += buffer.length;
    }
    
    return {
      users: this.buffers.size,
      totalChunks
    };
  }

  cleanup(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.buffers.clear();
  }
}