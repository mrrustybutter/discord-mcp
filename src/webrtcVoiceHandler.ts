import { EventEmitter } from 'events';
import wrtc from 'wrtc';
import { Transform, PassThrough } from 'stream';
import prism from 'prism-media';
import WebSocket from 'ws';
import ffmpeg from 'fluent-ffmpeg';
import { DiscordAudioEncoder } from './discordAudioEncoder.js';
import { EncryptedAudioEncoder } from './encryptedAudioEncoder.js';
import dgram from 'dgram';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { RTCPeerConnection, RTCSessionDescription, MediaStream, RTCIceCandidate } = wrtc;
const { RTCAudioSource } = (wrtc as any).nonstandard;

interface VoiceConnectionOptions {
  endpoint: string;
  token: string;
  sessionId: string;
  userId: string;
  guildId: string;
  channelId: string;
}

export class WebRTCVoiceHandler extends EventEmitter {
  private peerConnection?: RTCPeerConnection;
  private localStream?: MediaStream;
  private remoteStreams = new Map<string, MediaStream>();
  private ssrcToUserId = new Map<number, string>();
  private opusDecoders = new Map<number, any>();
  private audioContext?: any;
  private audioSource?: any;
  private ws?: WebSocket;
  private heartbeatInterval?: NodeJS.Timeout;
  private speakingInterval?: NodeJS.Timeout;
  private ssrc?: number;
  private address?: string;
  private port?: number;
  private udpSocket?: dgram.Socket;
  private audioEncoder?: DiscordAudioEncoder | EncryptedAudioEncoder;
  private isReady = false;
  private secretKey?: Buffer;
  private mode?: string;

  constructor() {
    super();
  }

  async connect(_options: VoiceConnectionOptions, ws: WebSocket): Promise<void> {
    this.ws = ws;
    
    // Create peer connection with Discord's STUN/TURN servers
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.discord.gg:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    } as RTCConfiguration);

    // Set up event handlers
    this.setupPeerConnectionHandlers();

    // Create local audio stream
    await this.setupLocalAudio();
  }

  private setupPeerConnectionHandlers(): void {
    if (!this.peerConnection) return;

    (this.peerConnection as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        // Send ICE candidate to Discord
        this.sendVoiceMessage({
          op: 13, // ICE candidate
          d: {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid
          }
        });
      }
    };

    (this.peerConnection as any).ontrack = (event: RTCTrackEvent) => {
      const [stream] = event.streams;
      const userId = this.extractUserIdFromStream(stream);
      this.remoteStreams.set(userId, stream);
      this.emit('userSpeaking', { userId, stream });
    };

    (this.peerConnection as any).onconnectionstatechange = () => {
      console.error('[WebRTC] Connection state:', this.peerConnection?.connectionState);
      if (this.peerConnection?.connectionState === 'connected') {
        this.emit('connected');
        this.startSpeakingIndicator();
      }
    };
  }

  private async setupLocalAudio(): Promise<void> {
    try {
      // Don't create audio track yet - we'll do it when we actually need to speak
      // This prevents Discord from thinking we're constantly transmitting
      console.error('[WebRTC] Audio setup ready - track will be created when speaking');
      
      // Just create an empty MediaStream for now
      this.localStream = new MediaStream();
      
      // Don't add any tracks to peer connection yet
      console.error('[WebRTC] No audio track added - will add when speaking');
    } catch (error) {
      console.error('[WebRTC] Error setting up audio:', error);
      // Fallback: create a basic stream without audio
      this.localStream = new MediaStream();
    }
  }

  async playAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.udpSocket || !this.audioEncoder || !this.address || !this.port) {
      throw new Error('Not connected to voice channel');
    }
    
    if (!this.isReady) {
      console.error('[WebRTC] Waiting for connection to be ready...');
      await new Promise(resolve => {
        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            resolve(true);
          }
        }, 100);
      });
    }

    console.error('[WebRTC] Playing audio buffer of size:', audioBuffer.length);
    
    // Check audio format by looking at the first few bytes
    const header = audioBuffer.slice(0, 12).toString('hex');
    console.error('[WebRTC] Audio header:', header);
    
    // Detect if it's MP3 (starts with FF FB or ID3) or WAV (starts with RIFF)
    const isMP3 = header.startsWith('fffb') || header.startsWith('fff3') || audioBuffer.slice(0, 3).toString() === 'ID3';
    const isWAV = audioBuffer.slice(0, 4).toString() === 'RIFF';
    
    console.error('[WebRTC] Detected format - MP3:', isMP3, 'WAV:', isWAV);

    try {
      // Set speaking state
      this.setSpeaking(true);

      // Convert audio to PCM using ffmpeg
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();
      
      inputStream.end(audioBuffer);
      
      let ffmpegCmd = ffmpeg(inputStream);
      
      // Set input format based on detection
      if (isMP3) {
        ffmpegCmd = ffmpegCmd.inputFormat('mp3');
      } else if (isWAV) {
        ffmpegCmd = ffmpegCmd.inputFormat('wav');
      }
      // If neither, let ffmpeg auto-detect
      
      ffmpegCmd
        .audioFrequency(48000)
        .audioChannels(2)
        .format('s16le')
        .on('error', (err: any) => {
          console.error('[WebRTC] FFmpeg error:', err);
          console.error('[WebRTC] FFmpeg stderr:', err.message);
          this.setSpeaking(false);
        })
        .on('end', () => {
          console.error('[WebRTC] FFmpeg conversion complete');
        })
        .pipe(outputStream);

      // Collect PCM data with timeout
      const chunks: Buffer[] = [];
      let conversionCompleted = false;
      
      // Add timeout for conversion
      const conversionTimeout = setTimeout(() => {
        if (!conversionCompleted) {
          console.error('[WebRTC] FFmpeg conversion timeout');
          this.setSpeaking(false);
        }
      }, 10000);
      
      outputStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      outputStream.on('end', () => {
        conversionCompleted = true;
        clearTimeout(conversionTimeout);
        
        const pcmData = Buffer.concat(chunks);
        console.error('[WebRTC] Conversion successful, PCM size:', pcmData.length);
        
        if (pcmData.length === 0) {
          console.error('[WebRTC] No PCM data generated, audio conversion failed');
          this.setSpeaking(false);
          return;
        }
        
        // Pre-process all frames to avoid blocking in timing loop
        const frameSize = 960 * 2 * 2; // 960 samples * 2 channels * 2 bytes (20ms at 48kHz)
        const frameCount = Math.ceil(pcmData.length / frameSize);
        const processedFrames: Buffer[] = [];
        
        console.error(`[WebRTC] Pre-processing ${frameCount} frames to avoid timing blocks...`);
        
        // Pre-encode and encrypt all frames
        for (let i = 0; i < frameCount; i++) {
          const offset = i * frameSize;
          let frame = pcmData.slice(offset, offset + frameSize);
          
          // Handle partial frames with fade-out
          if (frame.length < frameSize) {
            const remaining = Buffer.alloc(frameSize - frame.length);
            if (frame.length > 0) {
              const samplesInFrame = frame.length / 4;
              const fadeLength = Math.min(samplesInFrame, 240);
              for (let j = 0; j < fadeLength; j++) {
                const fadeMultiplier = (fadeLength - j) / fadeLength;
                const sampleIndex = samplesInFrame - fadeLength + j;
                const byteOffset = Math.floor(sampleIndex) * 4;
                
                if (byteOffset >= 0 && byteOffset + 3 < frame.length) {
                  const leftSample = frame.readInt16LE(byteOffset);
                  const rightSample = frame.readInt16LE(byteOffset + 2);
                  frame.writeInt16LE(Math.round(leftSample * fadeMultiplier), byteOffset);
                  frame.writeInt16LE(Math.round(rightSample * fadeMultiplier), byteOffset + 2);
                }
              }
            }
            frame = Buffer.concat([frame, remaining]);
          }
          
          // Pre-encode and encrypt this frame
          const rtpPacket = this.audioEncoder!.createAudioPacket(frame);
          processedFrames.push(rtpPacket);
        }
        
        console.error(`[WebRTC] All frames pre-processed. Starting transmission...`);
        
        // Now send pre-processed frames with precise timing
        let frameNumber = 0;
        const startTime = Date.now();
        
        const sendFrame = () => {
          if (frameNumber >= processedFrames.length) {
            console.error('[WebRTC] Audio transmission complete');
            this.setSpeaking(false);
            return;
          }
          
          // Get pre-processed frame (already encoded and encrypted)
          const rtpPacket = processedFrames[frameNumber];
          frameNumber++;
          
          // Send pre-processed packet directly (no encoding/encryption blocking)
          this.udpSocket!.send(rtpPacket, this.port!, this.address!, (err) => {
            if (err) {
              console.error('[WebRTC] UDP send error:', err);
            }
          });
          
          // Use more precise timing based on frame number instead of cumulative setTimeout
          const expectedTime = startTime + (frameNumber * 20);
          const currentTime = Date.now();
          const delay = Math.max(1, expectedTime - currentTime);
          
          setTimeout(sendFrame, delay);
        };
        
        // Start sending frames
        sendFrame();
      });

    } catch (error) {
      console.error('[WebRTC] Error playing audio:', error);
      this.setSpeaking(false);
      throw error;
    }
  }

  private startSpeakingIndicator(): void {
    // Don't send any speaking updates automatically
    // Speaking state will be controlled by setSpeaking() method when actually transmitting audio
    console.error('[WebRTC] Speaking indicator ready - will only activate during transmission');
  }

  async handleVoiceMessage(message: any): Promise<void> {
    console.error('[WebRTC] Voice message:', { op: message.op });
    
    switch (message.op) {
      case 2: // Ready
        await this.handleVoiceReady(message.d);
        break;
        
      case 4: // Session description
        console.error('[WebRTC] Session description received:', message.d);
        // This is actually protocol selection confirmation, not WebRTC SDP
        this.handleProtocolSelection(message.d);
        break;
        
      case 5: // Speaking
        console.error('[WebRTC] Speaking event:', message.d);
        // Map SSRC to user ID
        if (message.d.user_id && message.d.ssrc) {
          this.ssrcToUserId.set(message.d.ssrc, message.d.user_id);
          console.error(`[WebRTC] Mapped SSRC ${message.d.ssrc} to user ${message.d.user_id}`);
          
          // Subscribe to this user's audio
          // Note: We'll subscribe to all users including ourselves for now
          this.subscribeToAudio(message.d.user_id);
        }
        if (message.d.speaking === 1) {
          // User started speaking
          this.emit('userSpeaking', { 
            userId: message.d.user_id || `ssrc_${message.d.ssrc}`,
            ssrc: message.d.ssrc,
            speaking: true 
          });
        } else if (message.d.speaking === 0) {
          // User stopped speaking
          this.emit('userStopped', { 
            userId: message.d.user_id || `ssrc_${message.d.ssrc}`,
            ssrc: message.d.ssrc,
            speaking: false 
          });
        }
        this.emit('speaking', message.d);
        break;
        
      case 6: // Heartbeat ACK
        // Acknowledged
        break;
        
      case 8: // Hello
        // Heartbeat is handled by the parent userDiscordClient
        console.error('[WebRTC] Hello received (heartbeat handled by parent)');
        break;
        
      case 11: // Client info
        console.error('[WebRTC] Received op: 11 client info request');
        // Send client info response - only audio, no video
        this.sendVoiceMessage({
          op: 12,
          d: {
            audio_codec: 'opus',
            media_session_id: this.generateConnectionId()
            // Removed video_codec to indicate we don't support video
          }
        });
        console.error('[WebRTC] Sent op: 12 client info response');
        
        // Send SSRC update like browser does - first with audio_ssrc: 0
        setTimeout(() => {
          console.error('[WebRTC] Sending initial SSRC update with audio_ssrc: 0');
          this.sendVoiceMessage({
            op: 12,
            d: {
              audio_ssrc: 0,
              video_ssrc: 0,
              rtx_ssrc: 0,
              streams: []
            }
          });
          console.error('[WebRTC] Sent initial SSRC update with audio_ssrc: 0');
        }, 100);
        
        // Then update with our actual SSRC when ready
        setTimeout(() => {
          console.error('[WebRTC] Checking SSRC for update:', this.ssrc);
          if (this.ssrc) {
            console.error('[WebRTC] Sending SSRC update with ssrc:', this.ssrc);
            this.sendVoiceMessage({
              op: 12,
              d: {
                audio_ssrc: this.ssrc,
                video_ssrc: 0,
                rtx_ssrc: 0,
                streams: [{
                  type: 'audio',
                  ssrc: this.ssrc,
                  active: false  // Not actively transmitting
                }]
              }
            });
            console.error('[WebRTC] Sent SSRC update with audio_ssrc:', this.ssrc, 'active: false');
          } else {
            console.error('[WebRTC] No SSRC available for update');
          }
        }, 200);
        break;
        
      case 13: // ICE candidate
        this.handleIceCandidate(message.d);
        break;
        
      case 18: // Client flags
        // Acknowledged
        break;
        
      case 15: // Media sink wants
        console.error('[WebRTC] Media sink wants received:', message.d);
        // Respond that we only want audio, no video
        setTimeout(() => {
          this.sendVoiceMessage({
            op: 16,
            d: {
              any: 100, // Receive from up to 100 users
              streams: [],
              audio_ssrc: this.ssrc // Explicitly only audio
            }
          });
        }, 100);
        break;
        
      case 16: // Media sink wants response/acknowledgment
        console.error('[WebRTC] Media sink wants response received:', message.d);
        // Just acknowledge - no additional response needed
        break;
        
      case 20: // Version
        // Acknowledged
        break;
        
      case 21: // Client info response
        console.error('[WebRTC] Client info response:', message.d);
        break;
        
      default:
        console.error('[WebRTC] Unknown voice op:', message.op);
    }
  }

  private async handleSessionDescription(data: any): Promise<void> {
    if (!this.peerConnection) return;

    console.error('[WebRTC] Received session description');
    
    // Set remote description
    const answer = new RTCSessionDescription({
      type: 'answer',
      sdp: data.sdp
    });

    await this.peerConnection.setRemoteDescription(answer);
    
    // Mark as ready for audio
    this.isReady = true;
    console.error('[WebRTC] Voice connection ready for audio');
  }

  private handleProtocolSelection(data: any): void {
    // Store encryption info
    this.mode = data.mode;
    this.secretKey = Buffer.from(data.secret_key);
    
    console.error('[Voice] Protocol selected:', this.mode);
    console.error('[Voice] Got secret key for encryption');
    
    // Create encrypted audio encoder
    if (this.ssrc && this.secretKey && this.mode) {
      this.audioEncoder = new EncryptedAudioEncoder(this.ssrc, this.secretKey, this.mode);
    }
    
    // Mark as ready
    this.isReady = true;
    this.emit('protocol_ready');
    
    // Subscribe to all audio streams
    this.subscribeToAudio('all');
    
    // Start UDP keepalive to maintain connection
    this.startUDPKeepalive();
    
    // Send speaking state after protocol is ready
    this.sendVoiceMessage({
      op: 5,
      d: {
        speaking: 0,  // 0 = not speaking
        delay: 5,
        ssrc: this.ssrc
      }
    });
    console.error('[WebRTC] Sent speaking state after protocol ready: NOT speaking');
    
    // Also send SSRC update with active: false
    if (this.ssrc) {
      this.sendVoiceMessage({
        op: 12,
        d: {
          audio_ssrc: this.ssrc,
          video_ssrc: 0,
          rtx_ssrc: 0,
          streams: [{
            type: 'audio',
            ssrc: this.ssrc,
            active: false
          }]
        }
      });
      console.error('[WebRTC] Sent SSRC update after protocol ready with active: false');
    }
  }

  private async handleIceCandidate(data: any): Promise<void> {
    if (!this.peerConnection) return;

    const candidate = new RTCIceCandidate({
      candidate: data.candidate,
      sdpMLineIndex: data.sdpMLineIndex,
      sdpMid: data.sdpMid
    });

    await this.peerConnection.addIceCandidate(candidate);
  }

  private startHeartbeat(interval: number): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendVoiceMessage({
        op: 3, // Heartbeat
        d: Date.now()
      });
    }, interval);
  }

  private sendVoiceMessage(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private generateConnectionId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private handleIncomingAudio(packet: Buffer): void {
    try {
      // Save raw packet for debugging
      const debugDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'audio-debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const packetTimestamp = Date.now();
      fs.writeFileSync(path.join(debugDir, `packet_${packetTimestamp}_size_${packet.length}.bin`), packet);
      console.error(`[WebRTC] Saved raw packet ${packetTimestamp}, size: ${packet.length}`);
      
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
      
      // Check if we have encryption info
      if (!this.secretKey || !this.mode) return;
      
      // Skip RTP header (12 bytes minimum)
      const headerLength = 12;
      const encryptedAudio = packet.slice(headerLength);
      
      if (encryptedAudio.length === 0) return;
      
      console.error(`[WebRTC] Received audio packet from SSRC ${ssrc}, seq: ${sequenceNumber}, payload: ${encryptedAudio.length} bytes`);
      
      // Decrypt the audio using xsalsa20_poly1305_lite
      if (this.mode === 'xsalsa20_poly1305_lite') {
        try {
          // For _lite mode, the nonce is the last 4 bytes of the payload
          if (encryptedAudio.length < 4) return;
          
          const nonceBuffer = encryptedAudio.slice(-4);
          const audioData = encryptedAudio.slice(0, -4);
          
          // Create 24-byte nonce (20 zeros + 4 bytes from packet)
          const nonce = Buffer.alloc(24);
          nonceBuffer.copy(nonce, 0);
          
          // Decrypt using tweetnacl
          const decrypted = nacl.secretbox.open(
            new Uint8Array(audioData),
            new Uint8Array(nonce),
            new Uint8Array(this.secretKey)
          );
          
          if (decrypted) {
            // We have decrypted Opus audio!
            let opusPacket = Buffer.from(decrypted);
            
            // Skip Discord header if present (0xBEDE)
            if (opusPacket.length > 8 && opusPacket.readUInt16BE(0) === 0xBEDE) {
              const headerWords = opusPacket.readUInt16BE(2);
              const headerSize = 4 + (headerWords * 4);
              opusPacket = opusPacket.slice(headerSize);
              console.error(`[WebRTC] Removed Discord header, Opus packet from SSRC ${ssrc}, size: ${opusPacket.length}`);
            } else {
              console.error(`[WebRTC] Decrypted Opus packet from SSRC ${ssrc}, size: ${opusPacket.length}`);
            }
            
            // Skip silence frames (very small Opus packets)
            if (opusPacket.length <= 3) {
              return; // Don't emit silence frames
            }
            
            // Emit decrypted audio for processing
            this.emit('opusPacket', {
              ssrc,
              userId: this.ssrcToUserId.get(ssrc),
              sequenceNumber,
              timestamp,
              opus: opusPacket
            });
          } else {
            console.error('[WebRTC] Decryption failed for packet');
          }
        } catch (error) {
          console.error('[WebRTC] Decryption error:', error);
        }
      }
      
    } catch (error) {
      console.error('[WebRTC] Error processing incoming audio:', error);
    }
  }

  private extractUserIdFromStream(stream: MediaStream): string {
    // In a real implementation, this would extract user ID from stream metadata
    // For now, generate a unique ID based on stream tracks
    const tracks = stream.getTracks();
    return tracks.length > 0 ? (tracks[0] as any).id || 'track-' + Date.now() : 'unknown';
  }

  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.speakingInterval) {
      clearInterval(this.speakingInterval);
    }
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.remoteStreams.clear();
  }

  // Get audio from remote users
  getRemoteAudioStream(userId: string): MediaStream | undefined {
    return this.remoteStreams.get(userId);
  }

  // Set speaking state
  setSpeaking(speaking: boolean): void {
    // Discord speaking flags:
    // 0 = Not speaking
    // 1 = Normal speaking (microphone)
    // 2 = Soundshare
    // 4 = Priority speaker
    this.sendVoiceMessage({
      op: 5,
      d: {
        speaking: speaking ? 1 : 0,  // Use proper flag: 0 for not speaking
        delay: 5,  // Match browser behavior
        ssrc: this.ssrc
      }
    });
    console.error(`[WebRTC] Set speaking state to: ${speaking ? 'SPEAKING' : 'NOT SPEAKING'}`);
    
    // Also send SSRC update with active state
    if (this.ssrc) {
      this.sendVoiceMessage({
        op: 12,
        d: {
          audio_ssrc: this.ssrc,
          video_ssrc: 0,
          rtx_ssrc: 0,
          streams: [{
            type: 'audio',
            ssrc: this.ssrc,
            active: speaking  // Update active state
          }]
        }
      });
      console.error('[WebRTC] Updated SSRC active state to:', speaking);
    }
  }

  private async handleVoiceReady(data: any): Promise<void> {
    this.ssrc = data.ssrc;
    this.address = data.ip;
    this.port = data.port;
    
    console.error('[WebRTC] Voice ready - SSRC:', this.ssrc, 'Address:', this.address, 'Port:', this.port);
    
    // Initialize basic audio encoder (will be replaced after protocol selection)
    if (!this.ssrc) {
      throw new Error('No SSRC provided in voice ready data');
    }
    this.audioEncoder = new DiscordAudioEncoder(this.ssrc);
    
    // Don't send speaking state here - wait until after IP discovery
    
    // Create UDP socket for audio
    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.on('error', (err) => {
      console.error('[WebRTC] UDP socket error:', err);
    });
    
    // Set up permanent message handler for UDP packets
    this.udpSocket.on('message', (msg) => {
      console.error(`[WebRTC] UDP packet received, size: ${msg.length}`);
      
      // Check if this is an IP discovery response (74+ bytes starting with specific pattern)
      if (msg.length >= 74 && msg.readUInt16BE(0) === 1) {
        // This is IP discovery response, let the IP discovery handler process it
        return;
      }
      
      // This is an audio packet
      this.handleIncomingAudio(msg);
    });
    
    // Bind UDP socket to receive packets
    this.udpSocket.bind(0, () => {
      console.error('[WebRTC] UDP socket bound to port:', this.udpSocket!.address().port);
    });
    
    // Skip WebRTC setup - use simple UDP protocol
    
    // Perform IP discovery first
    await this.performIPDiscovery();
    
    this.emit('ready', data);
  }

  private async performIPDiscovery(): Promise<void> {
    if (!this.udpSocket || !this.ssrc || !this.address || !this.port) return;
    
    console.error('[Voice] Starting IP discovery...');
    
    // Create IP discovery packet
    const packet = Buffer.alloc(74);
    packet.writeUInt16BE(1, 0); // Type: IP discovery
    packet.writeUInt16BE(70, 2); // Length
    packet.writeUInt32BE(this.ssrc, 4); // SSRC
    
    // Send IP discovery
    this.udpSocket.send(packet, this.port, this.address, (err) => {
      if (err) console.error('[Voice] IP discovery send error:', err);
    });
    
    // Wait for response
    this.udpSocket.once('message', (msg) => {
      const ip = msg.slice(8, msg.indexOf(0, 8)).toString();
      const port = msg.readUInt16LE(msg.length - 2);
      
      console.error('[Voice] Discovered IP:', ip, 'Port:', port);
      
      // Select UDP protocol
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
      
      // Send initial speaking state after IP discovery
      setTimeout(() => {
        this.sendVoiceMessage({
          op: 5,
          d: {
            speaking: 0,  // 0 = not speaking
            delay: 5,
            ssrc: this.ssrc
          }
        });
        console.error('[WebRTC] Sent initial speaking state after IP discovery: NOT speaking');
        
        // Also send SSRC update with active: false
        if (this.ssrc) {
          this.sendVoiceMessage({
            op: 12,
            d: {
              audio_ssrc: this.ssrc,
              video_ssrc: 0,
              rtx_ssrc: 0,
              streams: [{
                type: 'audio',
                ssrc: this.ssrc,
                active: false
              }]
            }
          });
          console.error('[WebRTC] Sent SSRC update after IP discovery with active: false');
        }
      }, 100);
    });
  }

  private subscribeToAudio(userId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    console.error(`[WebRTC] Subscribing to audio from user ${userId}`);
    
    // Send voice subscribe command (op 13)
    this.ws.send(JSON.stringify({
      op: 13,
      d: {
        any: 100
      }
    }));
    
    console.error(`[WebRTC] Sent audio subscribe for all users`);
  }

  private keepaliveInterval?: NodeJS.Timeout;

  private startUDPKeepalive(): void {
    if (!this.udpSocket || !this.address || !this.port) return;
    
    console.error('[WebRTC] Starting UDP keepalive with silence frames');
    
    // Send silence frames every 20ms to establish bidirectional RTP
    this.keepaliveInterval = setInterval(() => {
      if (this.udpSocket && this.address && this.port && this.audioEncoder) {
        try {
          // Create silence PCM data (20ms worth of silence at 48kHz, 2 channels, 16-bit)
          // 960 samples * 2 channels * 2 bytes per sample = 3840 bytes
          const silencePCM = Buffer.alloc(3840);
          
          // Create RTP packet with silence
          const rtpPacket = this.audioEncoder.createAudioPacket(silencePCM);
          
          // Send the silence packet
          this.udpSocket.send(rtpPacket, this.port, this.address, (err) => {
            if (err) {
              console.error('[WebRTC] Silence packet send error:', err);
            }
          });
        } catch (error) {
          console.error('[WebRTC] Error creating silence packet:', error);
        }
      }
    }, 20); // Send every 20ms
  }

}