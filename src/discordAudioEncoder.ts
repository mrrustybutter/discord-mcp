import { Transform } from 'stream';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export class DiscordAudioEncoder {
  private opusEncoder: any;
  private sequence = 0;
  private timestamp = 0;
  private ssrc: number;

  constructor(ssrc: number) {
    this.ssrc = ssrc;
    
    // Use @discordjs/opus with Discord-optimized settings
    const opus = require('@discordjs/opus');
    this.opusEncoder = new opus.OpusEncoder(48000, 2, {
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
    this.sequence = (this.sequence + 1) & 0xFFFF;
    
    // Bytes 4-7: Timestamp
    rtpHeader.writeUInt32BE(this.timestamp, 4);
    this.timestamp += 960; // 48000Hz / 50fps = 960 samples per frame
    
    // Bytes 8-11: SSRC
    rtpHeader.writeUInt32BE(this.ssrc, 8);
    
    // Encode PCM to Opus (let encoder handle frame size automatically)
    const opusData = this.opusEncoder.encode(pcmData);
    
    // Combine RTP header and Opus data
    return Buffer.concat([rtpHeader, opusData]);
  }

  createSilencePacket(): Buffer {
    // Create 20ms of silence (960 samples * 2 channels * 2 bytes per sample)
    const silencePCM = Buffer.alloc(960 * 2 * 2);
    return this.createAudioPacket(silencePCM);
  }

  reset(): void {
    this.sequence = 0;
    this.timestamp = 0;
  }
}