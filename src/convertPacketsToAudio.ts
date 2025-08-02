import fs from 'fs';
import path from 'path';
import nacl from 'tweetnacl';
import prism from 'prism-media';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Your secret key from the log
const SECRET_KEY = Buffer.from([
  191, 119, 211, 178, 210, 110,  48, 200,
  149,  59,  80, 183, 180, 135, 111, 110,
   32, 140,  71, 208, 244, 226,  73,   4,
   17, 199,  59,  96,  97,  10,   2, 176
]);

async function convertPacketsToAudio() {
  const debugDir = path.join(__dirname, '..', 'audio-debug');
  const outputDir = path.join(__dirname, '..', 'audio-output');
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Get all packet files
  const files = fs.readdirSync(debugDir)
    .filter(f => f.startsWith('packet_') && f.endsWith('.bin'))
    .sort();
  
  console.log(`Found ${files.length} packet files`);
  
  // Group packets by SSRC
  const ssrcPackets = new Map<number, Array<{file: string, timestamp: number, sequence: number, opus: Buffer}>>();
  
  for (const file of files) {
    const filePath = path.join(debugDir, file);
    const packet = fs.readFileSync(filePath);
    
    // Skip if too small for RTP header
    if (packet.length < 12) continue;
    
    // Check RTP version
    const version = (packet[0] & 0b11000000) >> 6;
    if (version !== 2) continue;
    
    // Extract RTP header info
    const ssrc = packet.readUInt32BE(8);
    const sequence = packet.readUInt16BE(2);
    const timestamp = packet.readUInt32BE(4);
    
    // Skip IP discovery packets
    if (packet.length === 74 && packet.readUInt16BE(0) === 1) continue;
    
    // Check for RTP extension
    const hasExtension = (packet[0] & 0x10) !== 0;
    let headerLength = 12;
    
    if (hasExtension) {
      // RTP extension header is after the base header
      const extensionProfile = packet.readUInt16BE(12);
      const extensionLength = packet.readUInt16BE(14) * 4; // Length is in 32-bit words
      headerLength += 4 + extensionLength; // 4 bytes for extension header + extension data
      console.log(`Packet has RTP extension: profile=${extensionProfile}, length=${extensionLength}`);
    }
    
    // Get payload
    const payload = packet.slice(headerLength);
    if (payload.length < 4) continue;
    
    // Decrypt if xsalsa20_poly1305_lite
    try {
      const nonceBuffer = payload.slice(-4);
      const audioData = payload.slice(0, -4);
      
      // Create 24-byte nonce
      const nonce = Buffer.alloc(24);
      nonceBuffer.copy(nonce, 0);
      
      // Decrypt
      const decrypted = nacl.secretbox.open(
        new Uint8Array(audioData),
        new Uint8Array(nonce),
        new Uint8Array(SECRET_KEY)
      );
      
      if (decrypted) {
        let opusData = Buffer.from(decrypted);
        
        // Check if this has Discord's custom header (0xBEDE)
        if (opusData.length > 8 && opusData.readUInt16BE(0) === 0xBEDE) {
          // Skip Discord's custom header
          const headerLength = 4 + (opusData.readUInt16BE(2) * 4);
          opusData = opusData.slice(headerLength);
          
          if (!ssrcPackets.has(ssrc)) {
            console.log(`First packet for SSRC ${ssrc} (after removing Discord header): ${opusData.length} bytes, hex: ${opusData.slice(0, 10).toString('hex')}`);
          }
        } else if (!ssrcPackets.has(ssrc)) {
          console.log(`First packet for SSRC ${ssrc}: ${opusData.length} bytes, hex: ${opusData.slice(0, 10).toString('hex')}`);
        }
        
        if (!ssrcPackets.has(ssrc)) {
          ssrcPackets.set(ssrc, []);
        }
        
        ssrcPackets.get(ssrc)!.push({
          file,
          timestamp,
          sequence,
          opus: opusData
        });
      }
    } catch (error) {
      console.error(`Failed to decrypt packet ${file}:`, error);
    }
  }
  
  console.log(`Found audio from ${ssrcPackets.size} different SSRCs`);
  
  // Process each SSRC's audio
  for (const [ssrc, packets] of ssrcPackets) {
    if (packets.length === 0) continue;
    
    console.log(`\nProcessing SSRC ${ssrc}: ${packets.length} packets`);
    
    // Sort by sequence number
    packets.sort((a, b) => a.sequence - b.sequence);
    
    // Create Opus decoder
    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960
    });
    
    // Collect decoded PCM
    const pcmChunks: Buffer[] = [];
    
    decoder.on('data', (chunk: Buffer) => {
      pcmChunks.push(chunk);
    });
    
    decoder.on('error', (error: Error) => {
      console.error('Decoder error:', error.message);
    });
    
    // Feed Opus packets to decoder
    let decodedCount = 0;
    for (const packet of packets) {
      // Skip silence frames (very small Opus packets)
      if (packet.opus.length <= 3) {
        console.log(`Skipping silence frame (${packet.opus.length} bytes)`);
        continue;
      }
      
      try {
        decoder.write(packet.opus);
        decodedCount++;
      } catch (error) {
        console.error(`Failed to decode packet ${packet.file}: ${error}`);
      }
    }
    
    console.log(`Decoded ${decodedCount} packets out of ${packets.length}`);
    decoder.end();
    
    // Wait for decoding to complete
    await new Promise(resolve => decoder.on('end', resolve));
    
    if (pcmChunks.length === 0) {
      console.log(`No audio decoded for SSRC ${ssrc}`);
      continue;
    }
    
    // Combine PCM chunks
    const pcmData = Buffer.concat(pcmChunks);
    console.log(`Decoded ${pcmData.length} bytes of PCM audio`);
    
    // Save as WAV using ffmpeg
    const wavPath = path.join(outputDir, `ssrc_${ssrc}.wav`);
    const mp3Path = path.join(outputDir, `ssrc_${ssrc}.mp3`);
    
    // Convert PCM to WAV
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', 'pipe:0',
        '-y',
        wavPath
      ]);
      
      ffmpeg.stdin.write(pcmData);
      ffmpeg.stdin.end();
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`Created ${wavPath}`);
          resolve(true);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.stderr.on('data', (data) => {
        console.error(`ffmpeg: ${data}`);
      });
    });
    
    // Also create MP3
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', wavPath,
        '-acodec', 'mp3',
        '-ab', '128k',
        '-y',
        mp3Path
      ]);
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`Created ${mp3Path}`);
          resolve(true);
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
    });
  }
  
  console.log('\nConversion complete! Check the audio-output directory.');
}

// Run the conversion
convertPacketsToAudio().catch(console.error);