import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { loggers } from './logger.js';

const logger = loggers.worker;

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

interface AudioFrame {
  id: number;
  pcmData: Buffer;
  sequence: number;
  timestamp: number;
}

interface ProcessedFrame {
  id: number;
  rtpPacket: Buffer;
}

if (!isMainThread && parentPort) {
  // Worker thread code
  let opusEncoder: any;
  let secretKey: Buffer;
  let ssrc: number;
  let mode: string;
  
  parentPort.on('message', (message) => {
    switch (message.type) {
      case 'init':
        const { ssrc: initSsrc, secretKey: initKey, mode: initMode } = message;
        ssrc = initSsrc;
        secretKey = Buffer.from(initKey);
        mode = initMode;
        
        // Initialize Opus encoder with Discord-optimized settings
        const opus = require('@discordjs/opus');
        opusEncoder = new opus.OpusEncoder(48000, 2, {
          bitrate: 128000,  // 128kbps for better quality (Discord standard)
          fec: true,        // Enable FEC for error recovery
          plp: 0.01,        // 1% expected packet loss
          application: 'voip' // Optimize for voice
        });
        
        parentPort!.postMessage({ type: 'ready' });
        break;
        
      case 'encode':
        const frame: AudioFrame = message.frame;
        try {
          // Convert array back to Buffer
          const pcmBuffer = Buffer.from(frame.pcmData);
          // Create RTP Header (12 bytes)
          const rtpHeader = Buffer.allocUnsafe(12);
          
          // Byte 0: Version (2), Padding (0), Extension (0), CC (0)
          rtpHeader[0] = 0x80;
          
          // Byte 1: Marker (0), Payload Type (120 for Opus)
          rtpHeader[1] = 120;
          
          // Bytes 2-3: Sequence Number
          rtpHeader.writeUInt16BE(frame.sequence, 2);
          
          // Bytes 4-7: Timestamp
          rtpHeader.writeUInt32BE(frame.timestamp, 4);
          
          // Bytes 8-11: SSRC
          rtpHeader.writeUInt32BE(ssrc, 8);
          
          // Encode PCM to Opus
          const opusData = opusEncoder.encode(pcmBuffer);
          
          let packet: Buffer;
          
          if (mode === 'xsalsa20_poly1305_lite') {
            // Create nonce for lite mode (4 bytes)
            const nonceBuffer = Buffer.alloc(4);
            nonceBuffer.writeUInt32BE(frame.sequence, 0);
            
            // Pad nonce to 24 bytes for xsalsa20
            const nonce = Buffer.concat([nonceBuffer, Buffer.alloc(20)]);
            
            // Encrypt the opus data
            const encrypted = nacl.secretbox(
              opusData,
              nonce,
              secretKey
            );
            
            // Combine: RTP header + encrypted audio + 4-byte nonce suffix
            packet = Buffer.concat([
              rtpHeader,
              Buffer.from(encrypted),
              nonceBuffer
            ]);
          } else {
            // No encryption, just combine
            packet = Buffer.concat([rtpHeader, opusData]);
          }
          
          const result: ProcessedFrame = {
            id: frame.id,
            rtpPacket: packet
          };
          
          parentPort!.postMessage({ type: 'encoded', frame: result });
        } catch (error) {
          parentPort!.postMessage({ 
            type: 'error', 
            id: frame.id, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
        break;
    }
  });
}

export class AudioEncodingWorker {
  private worker: Worker;
  private pendingFrames = new Map<number, (packet: Buffer) => void>();
  private frameIdCounter = 0;
  private ready = false;
  
  constructor() {
    this.worker = new Worker(__filename, {
      workerData: {}
    });
    
    this.worker.on('message', (message) => {
      switch (message.type) {
        case 'ready':
          this.ready = true;
          break;
          
        case 'encoded':
          const { frame } = message;
          const callback = this.pendingFrames.get(frame.id);
          if (callback) {
            callback(frame.rtpPacket);
            this.pendingFrames.delete(frame.id);
          }
          break;
          
        case 'error':
          const errorCallback = this.pendingFrames.get(message.id);
          if (errorCallback) {
            logger.error('AudioEncodingWorker error', { error: message.error });
            this.pendingFrames.delete(message.id);
          }
          break;
      }
    });
  }
  
  async initialize(ssrc: number, secretKey: Buffer, mode: string): Promise<void> {
    return new Promise((resolve) => {
      this.worker.postMessage({
        type: 'init',
        ssrc,
        secretKey: Array.from(secretKey),
        mode
      });
      
      const checkReady = () => {
        if (this.ready) {
          resolve();
        } else {
          setTimeout(checkReady, 10);
        }
      };
      checkReady();
    });
  }
  
  async encodeFrame(pcmData: Buffer, sequence: number, timestamp: number): Promise<Buffer> {
    return new Promise((resolve) => {
      const frameId = this.frameIdCounter++;
      
      this.pendingFrames.set(frameId, resolve);
      
      this.worker.postMessage({
        type: 'encode',
        frame: {
          id: frameId,
          pcmData: Array.from(pcmData), // Convert to array for transfer
          sequence,
          timestamp
        }
      });
    });
  }
  
  terminate(): void {
    this.worker.terminate();
  }
}