import WebSocket from 'ws';
import dgram from 'dgram';
import { AudioEncodingWorker } from './audioEncodingWorker.js';
import { AudioDecodingWorker } from './audioDecodingWorker.js';
import { JitterBuffer } from './jitterBuffer.js';
import { AudioBufferManager } from './audioBufferManager.js';
import { ElevenLabsSTT } from './elevenlabsStt.js';
import { spawn } from 'child_process';
import { createWriteStream, appendFileSync } from 'fs';
import { EventEmitter } from 'events';
import { loggers } from './logger.js';

const logger = loggers.voice;

interface VoiceConnectionOptions {
  endpoint: string;
  token: string;
  sessionId: string;
  userId: string;
  guildId: string;
  channelId: string;
}

export class ThreadedWebRTCVoiceHandler extends EventEmitter {
  private voiceWebsocket?: WebSocket;
  private udpSocket?: dgram.Socket;
  private address?: string;
  private port?: number;
  private ssrc?: number;
  private secretKey?: Buffer;
  private mode?: string;
  private debugLogPath = '/home/codingbutter/GitHub/rusty-butter/packages/discord-mcp/voice-debug.log';
  
  // Worker threads
  private encodingWorker?: AudioEncodingWorker;
  private decodingWorker?: AudioDecodingWorker;
  
  // Audio state
  private sequence = 0;
  private timestamp = 0;
  private speaking = false;
  private ssrcUserMap = new Map<number, string>(); // Map SSRC to Discord user IDs
  
  // Frame queue for smooth sending with jitter buffer
  private sendQueue: Buffer[] = [];
  private isSending = false;
  private jitterBuffer = new JitterBuffer(5, 15); // Target 5 frames, max 15
  
  // Speech-to-text components
  private audioBufferManager?: AudioBufferManager;
  private elevenLabsSTT?: ElevenLabsSTT;
  private transcriptionEnabled = true;
  
  private debugLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} ${message}\n`;
    try {
      appendFileSync(this.debugLogPath, logMessage);
    } catch (error) {
      logger.error('Failed to write debug log', { error });
    }
  }

  constructor() {
    super();
    this.debugLog('[ThreadedWebRTC] Initializing multi-threaded voice handler');
    logger.info('Initializing multi-threaded voice handler');
    
    // Initialize worker threads
    try {
      this.debugLog('[ThreadedWebRTC] Creating audio encoding worker...');
      logger.debug('Creating audio encoding worker');
      this.encodingWorker = new AudioEncodingWorker();
      this.debugLog('[ThreadedWebRTC] Audio encoding worker created');
      logger.debug('Audio encoding worker created');
      
      this.debugLog('[ThreadedWebRTC] Creating audio decoding worker...');
      logger.debug('Creating audio decoding worker');
      this.decodingWorker = new AudioDecodingWorker();
      this.debugLog('[ThreadedWebRTC] Audio decoding worker created');
      logger.debug('Audio decoding worker created');
    } catch (error) {
      this.debugLog(`[ThreadedWebRTC] Failed to create workers: ${error}`);
      logger.error('Failed to create workers', { error });
    }
    
    // Initialize speech-to-text components
    try {
      this.elevenLabsSTT = new ElevenLabsSTT();
      this.audioBufferManager = new AudioBufferManager(2000, 10000); // 2s timeout, 10s max
      
      // Listen for buffered audio ready for transcription
      this.audioBufferManager.on('audioReady', async (data) => {
        if (this.transcriptionEnabled && this.elevenLabsSTT) {
          try {
            logger.info('Transcribing audio', { userId: data.userId });
            const result = await this.elevenLabsSTT.transcribeAudio(data.audioBuffer, {
              timestamps: 'word',
              speakerDiarization: false
            });
            
            this.emit('transcription', {
              userId: data.userId,
              text: result.text,
              startTime: data.startTime,
              endTime: data.endTime,
              words: result.words
            });
          } catch (error) {
            logger.error('Transcription error in voice handler', { 
              error: error instanceof Error ? error.message : String(error),
              userId: data.userId,
              audioSize: data.audioBuffer.length,
              component: 'voice-handler'
            });
          }
        }
      });
      
      logger.info('Speech-to-text initialized');
    } catch (error) {
      logger.error('STT initialization failed', { error });
      this.transcriptionEnabled = false;
    }
  }

  async connect(_options: VoiceConnectionOptions, voiceWebsocket: WebSocket): Promise<void> {
    this.debugLog('[ThreadedWebRTC] Connected with existing websocket');
    logger.info('Connected with existing websocket');
    this.voiceWebsocket = voiceWebsocket;
  }
  
  async handleVoiceMessage(message: any): Promise<void> {
    switch (message.op) {
      case 2: // Ready
        this.debugLog('[ThreadedWebRTC] Voice Ready received');
        this.debugLog(`[ThreadedWebRTC] Voice data: ${JSON.stringify(message.d)}`);
        logger.info('Voice Ready received');
        const { ssrc, ip, port, modes } = message.d;
        
        this.ssrc = ssrc;
        this.address = ip;
        this.port = port;
        
        // Choose encryption mode
        this.mode = modes.includes('xsalsa20_poly1305_lite') ? 
          'xsalsa20_poly1305_lite' : 'plain';
        
        logger.debug('Using encryption mode', { mode: this.mode });
        
        // Create UDP socket
        this.udpSocket = dgram.createSocket('udp4');
        
        // Perform IP discovery
        await this.performIPDiscovery();
        
        // Set up UDP packet receiving for decoding
        this.udpSocket.on('message', async (packet) => {
          this.debugLog(`[ThreadedWebRTC] UDP packet received! Size: ${packet.length} bytes`);
          logger.debug('UDP packet received', { size: packet.length });
          if (this.decodingWorker) {
            try {
              // Extract SSRC from RTP packet (bytes 8-11)
              let packetSsrc: number | undefined;
              if (packet.length >= 12) {
                packetSsrc = packet.readUInt32BE(8);
                logger.debug('Extracted SSRC from packet', { ssrc: packetSsrc });
              }
              
              logger.debug('Sending packet to decoding worker');
              const decoded = await this.decodingWorker.decodeFrame(packet);
              logger.debug('Decoded frame', { pcmSize: decoded.pcmData.length, sequence: decoded.sequence });
              this.emit('audioReceived', decoded);
              
              // Add to transcription buffer if enabled
              if (this.transcriptionEnabled && this.audioBufferManager && decoded.pcmData.length > 0) {
                // Try to get real user ID from SSRC mapping
                let userId = `user_${decoded.sequence % 1000}`; // Fallback to fake ID
                if (packetSsrc && this.ssrcUserMap.has(packetSsrc)) {
                  userId = this.ssrcUserMap.get(packetSsrc)!;
                  logger.debug('Using real user ID from SSRC mapping', { ssrc: packetSsrc, userId });
                } else {
                  logger.debug('No SSRC mapping found, using fallback', { ssrc: packetSsrc, userId });
                }
                
                logger.debug('Adding audio chunk to buffer', { userId, ssrc: packetSsrc });
                this.audioBufferManager.addAudioChunk(userId, decoded.pcmData);
              } else {
                logger.debug('Skipping transcription', { enabled: this.transcriptionEnabled, hasBufferManager: !!this.audioBufferManager, pcmSize: decoded.pcmData.length });
              }
            } catch (error) {
              logger.error('Decode error', { error });
            }
          } else {
            logger.error('No decoding worker available!');
          }
        });
        
        break;
        
      case 4: // Session Description (encryption key)
        logger.info('Session description received');
        logger.debug('Secret key details', {
          hasSecretKey: !!message.d.secret_key,
          secretKeyType: typeof message.d.secret_key,
          secretKeyLength: message.d.secret_key?.length || 0,
          secretKeyFirstBytes: message.d.secret_key ? Array.from(message.d.secret_key.slice(0, 8)) : [],
          mode: message.d.mode || 'unknown'
        });
        this.secretKey = Buffer.from(message.d.secret_key);
        
        // Initialize workers with encryption details
        if (this.encodingWorker && this.ssrc) {
          await this.encodingWorker.initialize(this.ssrc, this.secretKey, this.mode!);
          logger.debug('Encoding worker initialized');
        }
        
        if (this.decodingWorker) {
          logger.debug('Initializing decoding worker', { mode: this.mode });
          await this.decodingWorker.initialize(this.secretKey, this.mode!);
          logger.info('Decoding worker initialized and ready for audio packets');
        } else {
          logger.error('No decoding worker available for initialization!');
        }
        
        this.emit('ready');
        break;
        
      case 6: // Heartbeat ACK
        // Handle heartbeat
        break;
        
      case 5: // Speaking
        // Handle speaking updates - map SSRC to user ID
        if (message.d && message.d.speaking !== undefined && message.d.ssrc && message.d.user_id) {
          logger.info('Speaking event received', { 
            userId: message.d.user_id, 
            ssrc: message.d.ssrc, 
            speaking: message.d.speaking 
          });
          
          // Map SSRC to user ID for transcription
          this.ssrcUserMap.set(message.d.ssrc, message.d.user_id);
          logger.debug('SSRC mapping updated', { 
            ssrc: message.d.ssrc, 
            userId: message.d.user_id,
            totalMappings: this.ssrcUserMap.size 
          });
        }
        break;
    }
  }

  private async performIPDiscovery(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.udpSocket || !this.ssrc) {
        reject(new Error('UDP socket or SSRC not initialized'));
        return;
      }
      
      // Create IP discovery packet
      const packet = Buffer.allocUnsafe(74);
      packet.writeUInt16BE(0x1, 0); // Type
      packet.writeUInt16BE(70, 2);  // Length
      packet.writeUInt32BE(this.ssrc, 4); // SSRC
      
      // Send discovery packet
      this.udpSocket.send(packet, this.port!, this.address!, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });
      
      // Wait for response
      this.udpSocket.once('message', (response) => {
        const ip = response.slice(8, response.indexOf(0, 8)).toString();
        const port = response.readUInt16BE(response.length - 2);
        
        logger.info('IP Discovery complete', { ip, port });
        
        // Send select protocol
        this.voiceWebsocket!.send(JSON.stringify({
          op: 1,
          d: {
            protocol: 'udp',
            data: {
              address: ip,
              port: port,
              mode: this.mode
            }
          }
        }));
        
        resolve();
      });
    });
  }

  async playAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.encodingWorker || !this.udpSocket) {
      throw new Error('Voice connection not ready');
    }
    
    logger.info('Starting threaded audio playback');
    
    // Convert audio to PCM if needed
    const pcmData = await this.convertToPCM(audioBuffer);
    
    // Split into frames and queue for threaded processing
    const frameSize = 960 * 2 * 2; // 20ms frames
    const frameCount = Math.ceil(pcmData.length / frameSize);
    
    logger.debug('Queuing frames for threaded processing', { frameCount });
    
    // Process frames in worker thread
    const processedFrames: Buffer[] = [];
    
    for (let i = 0; i < frameCount; i++) {
      const offset = i * frameSize;
      let frame = pcmData.slice(offset, offset + frameSize);
      
      // Pad or fade partial frames
      if (frame.length < frameSize) {
        const remaining = Buffer.alloc(frameSize - frame.length);
        frame = Buffer.concat([frame, remaining]);
      }
      
      // Send to encoding worker
      const rtpPacket = await this.encodingWorker.encodeFrame(
        frame, 
        this.sequence++, 
        this.timestamp
      );
      
      processedFrames.push(rtpPacket);
      this.timestamp += 960; // 20ms worth of samples
    }
    
    logger.debug('All frames processed by worker, starting direct transmission');
    
    // For batch audio, use direct transmission instead of jitter buffer
    this.sendQueue = processedFrames;
    this.startDirectTransmission();
  }
  
  private startDirectTransmission(): void {
    if (this.isSending || this.sendQueue.length === 0) {
      return;
    }
    
    this.isSending = true;
    this.setSpeaking(true);
    
    const startTime = process.hrtime.bigint(); // Use high-resolution timer
    let frameIndex = 0;
    const FRAME_INTERVAL_NS = BigInt(20_000_000); // 20ms in nanoseconds
    
    const sendNextFrame = () => {
      if (frameIndex >= this.sendQueue.length) {
        logger.info('Direct transmission complete');
        this.setSpeaking(false);
        this.isSending = false;
        this.sendQueue = [];
        return;
      }
      
      // Send frame directly from queue
      const packet = this.sendQueue[frameIndex];
      this.udpSocket!.send(packet, this.port!, this.address!, (err) => {
        if (err) {
          logger.error('Send error', { error: err });
        }
      });
      
      frameIndex++;
      
      // Calculate precise timing using nanoseconds
      const expectedTime = startTime + (BigInt(frameIndex) * FRAME_INTERVAL_NS);
      const currentTime = process.hrtime.bigint();
      const delayNs = expectedTime - currentTime;
      const delayMs = Math.max(1, Number(delayNs / BigInt(1_000_000))); // Convert to milliseconds
      
      setTimeout(sendNextFrame, delayMs);
    };
    
    sendNextFrame();
  }

  private async convertToPCM(audioBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',           // Input from stdin
        '-f', 's16le',            // 16-bit signed little endian
        '-ar', '48000',           // 48kHz sample rate
        '-ac', '2',               // Stereo
        '-acodec', 'pcm_s16le',   // PCM codec
        'pipe:1'                  // Output to stdout
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      ffmpeg.on('close', () => {
        resolve(Buffer.concat(chunks));
      });
      
      ffmpeg.on('error', reject);
      ffmpeg.stderr.on('data', () => {}); // Ignore stderr
      
      // Send audio data
      ffmpeg.stdin.write(audioBuffer);
      ffmpeg.stdin.end();
    });
  }

  setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    
    this.speaking = speaking;
    
    if (this.voiceWebsocket) {
      this.voiceWebsocket.send(JSON.stringify({
        op: 5,
        d: {
          speaking: speaking ? 1 : 0,
          delay: 0,
          ssrc: this.ssrc
        }
      }));
    }
  }

  setTranscriptionEnabled(enabled: boolean): void {
    this.transcriptionEnabled = enabled;
    logger.info('Transcription setting changed', { enabled });
  }

  getTranscriptionStats(): any {
    return this.audioBufferManager?.getStats() || { users: 0, totalChunks: 0 };
  }

  disconnect(): void {
    logger.info('Disconnecting and cleaning up workers');
    
    if (this.encodingWorker) {
      this.encodingWorker.terminate();
      this.encodingWorker = undefined;
    }
    
    if (this.decodingWorker) {
      this.decodingWorker.terminate();
      this.decodingWorker = undefined;
    }
    
    if (this.audioBufferManager) {
      this.audioBufferManager.cleanup();
      this.audioBufferManager = undefined;
    }
    
    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = undefined;
    }
    
    if (this.voiceWebsocket) {
      this.voiceWebsocket.close();
      this.voiceWebsocket = undefined;
    }
  }
}