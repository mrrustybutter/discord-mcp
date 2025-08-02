import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

interface EncryptedFrame {
  id: number;
  rtpPacket: Buffer;
}

interface DecodedFrame {
  id: number;
  pcmData: Buffer;
  sequence: number;
  timestamp: number;
}

// Helper function to extract clean Opus data from Discord RTP packets
function extractOpusFromRTP(opusData: Buffer): Buffer {
  if (opusData.length === 0) {
    return opusData;
  }
  
  // Handle Discord RTP header extensions (common issue)
  if (opusData.length > 4 && opusData[0] === 0xBE && opusData[1] === 0xDE) {
    const rtpHLen = opusData.readUInt16BE(2);
    let offset = 4;
    
    // Skip extension headers
    for (let i = 0; i < rtpHLen && offset < opusData.length; i++) {
      const subLen = (opusData[offset] & 0xF) + 1;
      offset += subLen * 4;
    }
    
    // Skip padding
    while (offset < opusData.length && opusData[offset] === 0) {
      offset++;
    }
    
    return opusData.slice(offset);
  }
  
  return opusData;
}

if (!isMainThread && parentPort) {
  // Worker thread code
  let opusDecoder: any;
  let secretKey: Buffer;
  let mode: string;
  
  parentPort.on('message', (message) => {
    switch (message.type) {
      case 'init':
        const { secretKey: initKey, mode: initMode } = message;
        secretKey = Buffer.from(initKey);
        mode = initMode;
        
        // Initialize Opus decoder - use node-opus for frame-by-frame decoding
        try {
          const nodeOpus = require('node-opus');
          opusDecoder = new nodeOpus.OpusDecoder(48000, 2);
          console.error('[AudioDecodingWorker] Using node-opus decoder');
        } catch (nodeOpusError) {
          // Fallback to @discordjs/opus
          try {
            const discordOpus = require('@discordjs/opus');
            opusDecoder = new discordOpus.OpusEncoder(48000, 2); // Has decode method
            console.error('[AudioDecodingWorker] Using @discordjs/opus decoder');
          } catch (discordOpusError) {
            console.error('[AudioDecodingWorker] Failed to initialize any opus decoder:', nodeOpusError, discordOpusError);
            throw new Error('No opus decoder available');
          }
        }
        
        parentPort!.postMessage({ type: 'ready' });
        break;
        
      case 'decode':
        const frame: EncryptedFrame = message.frame;
        try {
          const rtpPacket = Buffer.from(frame.rtpPacket);
          
          // Parse RTP header (12 bytes)
          if (rtpPacket.length < 12) {
            throw new Error('Invalid RTP packet: too short');
          }
          
          const sequence = rtpPacket.readUInt16BE(2);
          const timestamp = rtpPacket.readUInt32BE(4);
          
          let opusData: Buffer;
          
          if (mode === 'xsalsa20_poly1305_lite') {
            // Extract nonce from end (4 bytes)
            if (rtpPacket.length < 16) {
              throw new Error('Invalid encrypted packet: too short');
            }
            
            const nonceBuffer = rtpPacket.slice(-4);
            const encryptedData = rtpPacket.slice(12, -4);
            
            // Pad nonce to 24 bytes for xsalsa20
            const nonce = Buffer.concat([nonceBuffer, Buffer.alloc(20)]);
            
            // Decrypt the opus data
            const decrypted = nacl.secretbox.open(
              encryptedData,
              nonce,
              secretKey
            );
            
            if (!decrypted) {
              throw new Error('Failed to decrypt audio data');
            }
            
            opusData = Buffer.from(decrypted);
          } else {
            // No encryption, extract opus data directly
            opusData = rtpPacket.slice(12);
          }
          
          // Clean opus data and handle Discord RTP extensions
          const cleanOpusData = extractOpusFromRTP(opusData);
          
          // Skip empty or silence packets
          if (cleanOpusData.length === 0) {
            // Generate silence frame instead of skipping
            const result: DecodedFrame = {
              id: frame.id,
              pcmData: Buffer.alloc(960 * 2 * 2), // 20ms of silence at 48kHz stereo 16-bit
              sequence,
              timestamp
            };
            parentPort!.postMessage({ type: 'decoded', frame: result });
            return;
          }
          
          // Decode Opus to PCM with error handling
          let pcmData: Buffer;
          try {
            // Both node-opus and @discordjs/opus have decode method
            const decoded = opusDecoder.decode(cleanOpusData);
            pcmData = Buffer.from(decoded);
          } catch (decodeError) {
            console.error('[AudioDecodingWorker] Opus decode failed:', decodeError);
            // Generate silence frame for failed decodes
            pcmData = Buffer.alloc(960 * 2 * 2); // 20ms of silence at 48kHz stereo 16-bit
          }
          
          const result: DecodedFrame = {
            id: frame.id,
            pcmData,
            sequence,
            timestamp
          };
          
          parentPort!.postMessage({ type: 'decoded', frame: result });
        } catch (error) {
          console.error('[AudioDecodingWorker] Frame decode error:', error);
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

export class AudioDecodingWorker {
  private worker: Worker;
  private pendingFrames = new Map<number, (frame: DecodedFrame) => void>();
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
          
        case 'decoded':
          const { frame } = message;
          const callback = this.pendingFrames.get(frame.id);
          if (callback) {
            callback(frame);
            this.pendingFrames.delete(frame.id);
          }
          break;
          
        case 'error':
          console.error('[AudioDecodingWorker] Error:', message.error);
          const errorCallback = this.pendingFrames.get(message.id);
          if (errorCallback) {
            this.pendingFrames.delete(message.id);
          }
          break;
      }
    });
  }
  
  async initialize(secretKey: Buffer, mode: string): Promise<void> {
    return new Promise((resolve) => {
      this.worker.postMessage({
        type: 'init',
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
  
  async decodeFrame(rtpPacket: Buffer): Promise<DecodedFrame> {
    return new Promise((resolve) => {
      const frameId = this.frameIdCounter++;
      
      this.pendingFrames.set(frameId, resolve);
      
      this.worker.postMessage({
        type: 'decode',
        frame: {
          id: frameId,
          rtpPacket: Array.from(rtpPacket)
        }
      });
    });
  }
  
  terminate(): void {
    this.worker.terminate();
  }
}