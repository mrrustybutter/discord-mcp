import { EventEmitter } from 'events';
import dgram from 'dgram';
import { createRequire } from 'module';
import crypto from 'crypto';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);

interface VoiceConnectionOptions {
  endpoint: string;
  token: string;
  sessionId: string;
  userId: string;
  guildId: string;
  channelId: string;
}

export class SimpleVoiceHandler extends EventEmitter {
  private ws?: WebSocket;
  private udpSocket?: dgram.Socket;
  private heartbeatInterval?: NodeJS.Timeout;
  private ssrc?: number;
  private address?: string;
  private port?: number;
  private mode?: string;
  private secretKey?: Buffer;
  private sequence = 0;
  private timestamp = 0;
  private opusEncoder: any;
  private isReady = false;

  constructor() {
    super();
    
    // Initialize Opus encoder
    const opus = require('@discordjs/opus');
    this.opusEncoder = new opus.OpusEncoder(48000, 2);
  }

  async connect(_options: VoiceConnectionOptions, ws: WebSocket): Promise<void> {
    this.ws = ws;
    
    // Wait for voice ready
    this.once('ready', async (data: any) => {
      this.ssrc = data.ssrc;
      this.address = data.ip;
      this.port = data.port;
      
      console.error('[SimpleVoice] Ready - SSRC:', this.ssrc, 'Address:', this.address, 'Port:', this.port);
      
      // Create UDP socket
      this.udpSocket = dgram.createSocket('udp4');
      
      // Listen for incoming audio packets
      this.udpSocket.on('message', (msg) => {
        // Check if this is an IP discovery response
        if (msg.length >= 74 && msg.readUInt16BE(0) === 1) {
          return;
        }
        // This is an audio packet - process it
        this.handleIncomingAudio(msg);
      });
      
      // IP discovery immediately like the working WebRTCVoiceHandler
      await this.performIPDiscovery();
    });
  }

  private async performIPDiscovery(): Promise<void> {
    if (!this.udpSocket || !this.ssrc || !this.address || !this.port) return;
    
    // Create IP discovery packet
    const packet = Buffer.alloc(74);
    packet.writeUInt16BE(1, 0); // Type: IP discovery
    packet.writeUInt16BE(70, 2); // Length
    packet.writeUInt32BE(this.ssrc, 4); // SSRC
    
    // Send IP discovery
    this.udpSocket.send(packet, this.port, this.address, (err) => {
      if (err) console.error('[SimpleVoice] IP discovery send error:', err);
    });
    
    // Wait for response
    this.udpSocket.once('message', (msg) => {
      const ip = msg.slice(8, msg.indexOf(0, 8)).toString();
      const port = msg.readUInt16LE(msg.length - 2);
      
      console.error('[SimpleVoice] Discovered IP:', ip, 'Port:', port);
      
      // Select protocol - browser uses WebRTC first, then falls back to UDP
      // For simplicity, we'll go straight to UDP
      this.sendVoiceMessage({
        op: 1, // Select protocol
        d: {
          protocol: 'udp',
          data: {
            address: ip,
            port: port,
            mode: 'xsalsa20_poly1305_lite'
          }
        }
      });
      
      console.error('[SimpleVoice] Protocol selection sent - UDP with xsalsa20_poly1305_lite');
      console.error('[SimpleVoice] Waiting for session description (op: 4) with secret key...');
    });
  }

  handleVoiceMessage(message: any): void {
    console.error('[SimpleVoice] Message:', { op: message.op, seq: message.seq });
    
    switch (message.op) {
      case 1: // WebRTC protocol selection
        console.error('[SimpleVoice] WebRTC protocol message received:', message.d);
        // This contains SDP data from Discord's WebRTC server
        if (message.d && message.d.data) {
          console.error('[SimpleVoice] Received SDP data from Discord');
          // For now, acknowledge receipt - full WebRTC implementation would process SDP
          this.handleWebRTCProtocol(message.d);
        }
        break;
        
      case 2: // Ready
        this.emit('ready', message.d);
        break;
        
      case 4: // Session description
        console.error('[SimpleVoice] Session description received:', message.d);
        // Extract secret key
        this.mode = message.d.mode;
        this.secretKey = Buffer.from(message.d.secret_key);
        console.error('[SimpleVoice] Protocol selected:', this.mode, 'got secret key length:', this.secretKey.length);
        this.isReady = true;
        this.emit('connected');
        break;
        
      case 5: // Speaking
        console.error('[SimpleVoice] Speaking event:', message.d);
        this.emit('speaking', message.d);
        break;
        
      case 6: // Heartbeat ACK
        console.error('[SimpleVoice] Heartbeat ACK received');
        break;
        
      case 8: // Hello
        this.startHeartbeat(message.d.heartbeat_interval);
        // Don't send identify here - it's handled by the parent
        break;
        
      case 11: // Client info request
        console.error('[SimpleVoice] Client info request received:', message.d);
        // Browser logs show this triggers WebRTC exchange - let's see if we need to respond
        console.error('[SimpleVoice] Client info request contains user_ids:', message.d.user_ids);
        break;
        
      case 12: // Audio/Video SSRC configuration
        console.error('[SimpleVoice] SSRC configuration received:', message.d);
        if (message.d.audio_ssrc) {
          console.error('[SimpleVoice] Audio SSRC assigned:', message.d.audio_ssrc);
        }
        break;
        
      case 15: // Media sink wants
        console.error('[SimpleVoice] Media sink wants received:', message.d);
        // Respond that we want to receive audio from all users
        this.sendVoiceMessage({
          op: 16,
          d: {
            any: 100 // Receive from up to 100 users
          }
        });
        break;
        
      case 16: // Media sink wants response/version info
        console.error('[SimpleVoice] Media sink wants response received:', message.d);
        // If this contains version info, acknowledge it
        if (message.d && typeof message.d === 'object' && !Array.isArray(message.d)) {
          console.error('[SimpleVoice] Version info received:', message.d);
        }
        break;
        
      case 18: // Client flags
        console.error('[SimpleVoice] Client flags received:', message.d);
        break;
        
      case 20: // Platform info
        console.error('[SimpleVoice] Platform info received:', message.d);
        break;
        
      default:
        console.error('[SimpleVoice] Unknown voice op:', message.op, message.d);
    }
  }

  async playAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.isReady || !this.udpSocket || !this.secretKey) {
      throw new Error('Not connected to voice channel');
    }
    
    console.error('[SimpleVoice] Playing audio, size:', audioBuffer.length);
    
    // Set speaking
    this.setSpeaking(true);
    
    // Convert WAV to PCM frames and send
    // For simplicity, assuming input is already PCM
    const frameSize = 960 * 2 * 2; // 960 samples * 2 channels * 2 bytes
    let offset = 44; // Skip WAV header
    
    const sendFrame = () => {
      if (offset >= audioBuffer.length) {
        console.error('[SimpleVoice] Audio complete');
        this.setSpeaking(false);
        return;
      }
      
      // Get frame
      const frame = audioBuffer.slice(offset, offset + frameSize);
      offset += frameSize;
      
      // Pad if needed
      const paddedFrame = frame.length < frameSize 
        ? Buffer.concat([frame, Buffer.alloc(frameSize - frame.length)])
        : frame;
      
      // Encode to Opus
      const opusData = this.opusEncoder.encode(paddedFrame, 960);
      
      // Create RTP packet
      const rtpHeader = Buffer.allocUnsafe(12);
      rtpHeader[0] = 0x80;
      rtpHeader[1] = 120; // Opus payload type
      rtpHeader.writeUInt16BE(this.sequence, 2);
      rtpHeader.writeUInt32BE(this.timestamp, 4);
      rtpHeader.writeUInt32BE(this.ssrc!, 8);
      
      // Encrypt
      const packet = this.encryptPacket(Buffer.concat([rtpHeader, opusData]));
      
      // Send
      this.udpSocket!.send(packet, this.port!, this.address!, (err) => {
        if (err) console.error('[SimpleVoice] Send error:', err);
      });
      
      // Update counters
      this.sequence = (this.sequence + 1) & 0xFFFF;
      this.timestamp += 960;
      
      // Next frame
      setTimeout(sendFrame, 20);
    };
    
    sendFrame();
  }

  private encryptPacket(packet: Buffer): Buffer {
    if (!this.secretKey || this.mode !== 'xsalsa20_poly1305_lite') {
      return packet; // No encryption
    }
    
    // For xsalsa20_poly1305_lite mode
    const nonce = Buffer.alloc(4);
    nonce.writeUInt32BE(this.sequence, 0);
    
    // Simplified - would need proper nacl encryption here
    // For now, return packet with nonce appended
    return Buffer.concat([packet, nonce]);
  }

  private async handleWebRTCProtocol(data: any): Promise<void> {
    console.error('[SimpleVoice] Processing WebRTC protocol data');
    
    // Log the SDP and codec information
    if (data.sdp) {
      console.error('[SimpleVoice] SDP received (length):', data.sdp.length);
    }
    if (data.codecs) {
      console.error('[SimpleVoice] Available codecs:', data.codecs.map((c: any) => c.name));
    }
    
    // Browser would do WebRTC negotiation here, but for simplicity we'll fall back to UDP
    // Now that we have the WebRTC offer, let's do IP discovery and select UDP
    console.error('[SimpleVoice] WebRTC protocol received, falling back to UDP...');
    
    if (this.udpSocket && this.ssrc && this.address && this.port) {
      await this.performIPDiscovery();
    }
  }

  private startHeartbeat(interval: number): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendVoiceMessage({
        op: 3, // Heartbeat
        d: Date.now()
      });
    }, interval);
  }

  private generateConnectionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private sendVoiceMessage(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  setSpeaking(speaking: boolean): void {
    this.sendVoiceMessage({
      op: 5,
      d: {
        speaking: speaking ? 1 : 0,
        delay: 0,
        ssrc: this.ssrc
      }
    });
  }

  private handleIncomingAudio(packet: Buffer): void {
    try {
      // Basic RTP header parsing
      if (packet.length < 12) return; // Too small for RTP header
      
      const version = (packet[0] & 0b11000000) >> 6;
      if (version !== 2) return; // Not RTP v2
      
      // Extract SSRC (bytes 8-11)
      const ssrc = packet.readUInt32BE(8);
      
      // Extract sequence number (bytes 2-3)  
      const sequenceNumber = packet.readUInt16BE(2);
      
      // Extract timestamp (bytes 4-7)
      const timestamp = packet.readUInt32BE(4);
      
      // Skip RTP header (12 bytes minimum)
      const headerLength = 12;
      const encryptedPayload = packet.slice(headerLength);
      
      if (encryptedPayload.length === 0) return;
      
      console.error(`[SimpleVoice] Received audio packet from SSRC ${ssrc}, seq: ${sequenceNumber}, payload: ${encryptedPayload.length} bytes`);
      
      // Emit raw audio data event for processing
      this.emit('audioData', {
        ssrc,
        sequenceNumber,
        timestamp,
        payload: encryptedPayload
      });
      
    } catch (error) {
      console.error('[SimpleVoice] Error processing incoming audio:', error);
    }
  }

  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.udpSocket) {
      this.udpSocket.close();
    }
  }
}