import { createRequire } from 'module';
import nacl from 'tweetnacl';

const require = createRequire(import.meta.url);

export class EncryptedAudioEncoder {
  private opusEncoder: any;
  private sequence = 0;
  private timestamp = 0;
  private ssrc: number;
  private secretKey: Buffer;
  private mode: string;

  constructor(ssrc: number, secretKey: Buffer, mode: string) {
    this.ssrc = ssrc;
    this.secretKey = secretKey;
    this.mode = mode;
    
    // Use @discordjs/opus with proper configuration for Discord
    const opus = require('@discordjs/opus');
    this.opusEncoder = new opus.OpusEncoder(48000, 2, {
      // Lower quality for smoother streaming
      bitrate: 64000,   // 64kbps for smaller packets
      fec: false,       // Disable FEC to reduce overhead
      plp: 0.0          // No expected packet loss for cleaner stream
    });
  }

  createAudioPacket(pcmData: Buffer): Buffer {
    // RTP Header (12 bytes)
    const rtpHeader = Buffer.allocUnsafe(12);
    
    // Byte 0: Version (2), Padding (0), Extension (0), CC (0)
    rtpHeader[0] = 0x80;
    
    // Byte 1: Marker (0), Payload Type (120 for Opus)
    rtpHeader[1] = 120;
    
    // Bytes 2-3: Sequence Number
    rtpHeader.writeUInt16BE(this.sequence, 2);
    
    // Bytes 4-7: Timestamp
    rtpHeader.writeUInt32BE(this.timestamp, 4);
    
    // Bytes 8-11: SSRC
    rtpHeader.writeUInt32BE(this.ssrc, 8);
    
    // Encode PCM to Opus (20ms frame = 960 samples * 2 channels * 2 bytes = 3840 bytes)
    // Let the encoder determine the optimal frame size based on the input
    const opusData = this.opusEncoder.encode(pcmData);
    
    // Create packet
    let packet: Buffer;
    
    if (this.mode === 'xsalsa20_poly1305_lite') {
      // Create nonce for lite mode (4 bytes)
      const nonceBuffer = Buffer.alloc(4);
      nonceBuffer.writeUInt32BE(this.sequence, 0);
      
      // Pad nonce to 24 bytes for xsalsa20
      const nonce = Buffer.concat([nonceBuffer, Buffer.alloc(20)]);
      
      // Encrypt the opus data
      const encrypted = nacl.secretbox(
        opusData,
        nonce,
        this.secretKey
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
    
    // Update counters
    this.sequence = (this.sequence + 1) & 0xFFFF;
    this.timestamp += 960; // 48000Hz / 50fps = 960 samples per frame
    
    return packet;
  }

  reset(): void {
    this.sequence = 0;
    this.timestamp = 0;
  }
}