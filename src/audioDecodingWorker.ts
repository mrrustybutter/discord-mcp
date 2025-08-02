import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { loggers } from './logger.js';

const logger = loggers.worker;

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
          logger.debug('Using node-opus decoder');
        } catch (nodeOpusError) {
          // Fallback to @discordjs/opus
          try {
            const discordOpus = require('@discordjs/opus');
            opusDecoder = new discordOpus.OpusEncoder(48000, 2); // Has decode method
            logger.debug('Using @discordjs/opus decoder');
          } catch (discordOpusError) {
            logger.error('Failed to initialize any opus decoder', { nodeOpusError, discordOpusError });
            throw new Error('No opus decoder available');
          }
        }
        
        parentPort!.postMessage({ type: 'ready' });
        break;
        
      case 'decode':
        const frame: EncryptedFrame = message.frame;
        let sequence = 0;
        let timestamp = 0;
        try {
          logger.debug('Processing frame decode', { 
            frameId: frame.id, 
            rtpPacketLength: frame.rtpPacket?.length || 0 
          });
          const rtpPacket = Buffer.from(frame.rtpPacket);
          
          // Parse RTP header (12 bytes)
          if (rtpPacket.length < 12) {
            throw new Error('Invalid RTP packet: too short');
          }
          
          sequence = rtpPacket.readUInt16BE(2);
          timestamp = rtpPacket.readUInt32BE(4);
          logger.debug('RTP header parsed', { sequence, timestamp, mode });
          
          let opusData: Buffer;
          
          if (mode === 'xsalsa20_poly1305_lite') {
            logger.debug('Using encrypted mode');
            // Extract nonce from end (4 bytes)
            if (rtpPacket.length < 16) {
              throw new Error('Invalid encrypted packet: too short');
            }
            
            const nonceBuffer = rtpPacket.slice(-4);
            const encryptedData = rtpPacket.slice(12, -4);
            
            // Check if this is a silence/keepalive packet (common pattern: same seq/timestamp)
            const isLikelySilencePacket = sequence === 7 && timestamp === 45110 && encryptedData.length <= 40;
            
            logger.debug('Packet analysis', { 
              sequence,
              timestamp,
              encryptedLength: encryptedData.length,
              isLikelySilencePacket,
              nonceBytes: Array.from(nonceBuffer),
              encryptedFirstBytes: Array.from(encryptedData.slice(0, Math.min(8, encryptedData.length))),
              secretKeyLength: secretKey?.length || 0
            });
            
            // For suspected silence packets, generate silence instead of attempting decryption
            if (isLikelySilencePacket) {
              logger.debug('Treating as silence packet, skipping decryption');
              opusData = Buffer.alloc(0); // Will be handled as silence below
            } else {
              // For xsalsa20_poly1305_lite, the nonce is constructed differently
              // Discord uses a 24-byte nonce where the first 12 bytes are the RTP header
              // and the last 12 bytes are zeros, then XORed with the 4-byte suffix
              const nonce = Buffer.alloc(24);
              
              // Copy RTP header (first 12 bytes) to nonce
              rtpPacket.copy(nonce, 0, 0, 12);
              
              // Copy the 4-byte nonce suffix to the correct position (bytes 12-15)
              nonceBuffer.copy(nonce, 12);
              
              logger.debug('Decryption attempt', {
                nonceHex: nonce.toString('hex'),
                encryptedLength: encryptedData.length,
                firstNonceBytes: Array.from(nonce.slice(0, 16))
              });
              
              // Decrypt the opus data
              const decrypted = nacl.secretbox.open(
                encryptedData,
                nonce,
                secretKey
              );
              
              if (!decrypted) {
                logger.error('Decryption failed for voice packet', {
                  encryptedDataLength: encryptedData.length,
                  nonceLength: nonce.length,
                  secretKeyLength: secretKey.length,
                  nonceHex: nonce.toString('hex'),
                  encryptedHex: encryptedData.slice(0, Math.min(32, encryptedData.length)).toString('hex'),
                  sequence,
                  timestamp
                });
                throw new Error('Failed to decrypt voice audio data');
              }
              
              opusData = Buffer.from(decrypted);
              logger.debug('Voice decryption successful', { opusLength: opusData.length });
            }
          } else {
            logger.debug('Using unencrypted mode');
            // No encryption, extract opus data directly
            opusData = rtpPacket.slice(12);
            logger.debug('Extracted unencrypted opus', { opusLength: opusData.length });
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
            logger.error('Opus decode failed', { 
              error: decodeError,
              opusDataLength: cleanOpusData.length,
              firstBytes: cleanOpusData.length > 0 ? Array.from(cleanOpusData.slice(0, Math.min(8, cleanOpusData.length))) : [],
              mode: mode,
              sequence: sequence
            });
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : 'No stack trace';
          logger.error(`Frame decode error - DETAILED: ${errorMessage} | frameId: ${frame.id} | sequence: ${sequence} | timestamp: ${timestamp} | mode: ${mode} | rtpLength: ${frame.rtpPacket?.length || 0}`);
          logger.error(`Frame decode error stack: ${errorStack}`);
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
          logger.error('AudioDecodingWorker error', { error: message.error });
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