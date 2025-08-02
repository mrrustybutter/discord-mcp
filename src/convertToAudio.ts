import fs from 'fs';
import path from 'path';
import nacl from 'tweetnacl';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import prism from 'prism-media';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Your secret key from the log
const SECRET_KEY = Buffer.from([
  191, 119, 211, 178, 210, 110,  48, 200,
  149,  59,  80, 183, 180, 135, 111, 110,
   32, 140,  71, 208, 244, 226,  73,   4,
   17, 199,  59,  96,  97,  10,   2, 176
]);

async function convertToAudio() {
  const debugDir = path.join(__dirname, '..', 'audio-debug');
  const outputDir = path.join(__dirname, '..', 'audio-output');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Get all packet files
  const files = fs.readdirSync(debugDir)
    .filter(f => f.startsWith('packet_') && f.endsWith('.bin'))
    .sort();
  
  console.log(`Found ${files.length} packet files`);
  
  // Collect all Opus packets
  const opusPackets: Buffer[] = [];
  let processedCount = 0;
  
  for (const file of files) {
    const filePath = path.join(debugDir, file);
    const packet = fs.readFileSync(filePath);
    
    // Skip if too small for RTP header
    if (packet.length < 12) continue;
    
    // Check RTP version
    const version = (packet[0] & 0b11000000) >> 6;
    if (version !== 2) continue;
    
    // Skip IP discovery packets
    if (packet.length === 74 && packet.readUInt16BE(0) === 1) continue;
    
    // Get encrypted payload (after 12-byte RTP header)
    const payload = packet.slice(12);
    if (payload.length < 4) continue;
    
    try {
      // Decrypt
      const nonceBuffer = payload.slice(-4);
      const audioData = payload.slice(0, -4);
      
      const nonce = Buffer.alloc(24);
      nonceBuffer.copy(nonce, 0);
      
      const decrypted = nacl.secretbox.open(
        new Uint8Array(audioData),
        new Uint8Array(nonce),
        new Uint8Array(SECRET_KEY)
      );
      
      if (decrypted) {
        let opusData = Buffer.from(decrypted);
        
        // Skip Discord header if present
        if (opusData.length > 8 && opusData.readUInt16BE(0) === 0xBEDE) {
          const headerWords = opusData.readUInt16BE(2);
          const headerSize = 4 + (headerWords * 4);
          opusData = opusData.slice(headerSize);
        }
        
        // Skip silence frames (very small packets)
        if (opusData.length > 20) {
          opusPackets.push(opusData);
          processedCount++;
        }
      }
    } catch (error) {
      // Skip failed packets
    }
  }
  
  console.log(`Decrypted ${processedCount} audio packets`);
  
  if (opusPackets.length === 0) {
    console.log('No audio packets found!');
    return;
  }
  
  // Create a raw Opus file
  const opusFile = path.join(outputDir, 'combined.opus');
  const opusStream = fs.createWriteStream(opusFile);
  
  // Write Ogg Opus header
  const oggHeader = createOggOpusHeader();
  opusStream.write(oggHeader);
  
  // Write packets
  let granulePosition = 0;
  for (const packet of opusPackets) {
    const oggPacket = createOggPacket(packet, granulePosition);
    opusStream.write(oggPacket);
    granulePosition += 960; // 20ms at 48kHz
  }
  
  opusStream.end();
  
  console.log(`Created ${opusFile}`);
  
  // Convert to WAV using ffmpeg
  const wavFile = path.join(outputDir, 'output.wav');
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', opusFile,
      '-acodec', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '2',
      '-y',
      wavFile
    ]);
    
    ffmpeg.stderr.on('data', (_data) => {
      // console.error(`ffmpeg: ${_data}`);
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`Created ${wavFile}`);
        resolve(true);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
  
  // Also create MP3
  const mp3File = path.join(outputDir, 'output.mp3');
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', wavFile,
      '-acodec', 'mp3',
      '-ab', '128k',
      '-y',
      mp3File
    ]);
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`Created ${mp3File}`);
        resolve(true);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function createOggOpusHeader(): Buffer {
  // Simplified Ogg Opus header
  const header = Buffer.concat([
    Buffer.from('OggS', 'ascii'), // Ogg page header
    Buffer.from([0, 2]), // Version, header type
    Buffer.alloc(8), // Granule position
    Buffer.from([0, 0, 0, 1]), // Serial number
    Buffer.from([0, 0, 0, 0]), // Page sequence
    Buffer.alloc(4), // CRC (will be wrong but ffmpeg doesn't care)
    Buffer.from([1]), // Number of segments
    Buffer.from([19]), // Segment length
    Buffer.from('OpusHead', 'ascii'), // Opus header
    Buffer.from([1, 2]), // Version, channels
    Buffer.from([0x38, 0x01]), // Pre-skip
    Buffer.from([0x80, 0xbb, 0x00, 0x00]), // Sample rate (48000)
    Buffer.from([0, 0]), // Output gain
    Buffer.from([0]) // Channel mapping
  ]);
  return header;
}

function createOggPacket(opus: Buffer, _granulePosition: number): Buffer {
  // Create a simple Ogg page with the Opus packet
  const segments = Math.ceil(opus.length / 255);
  const segmentTable = Buffer.alloc(segments);
  let remaining = opus.length;
  
  for (let i = 0; i < segments; i++) {
    segmentTable[i] = Math.min(remaining, 255);
    remaining -= segmentTable[i];
  }
  
  const header = Buffer.concat([
    Buffer.from('OggS', 'ascii'),
    Buffer.from([0, 0]), // Version, flags
    Buffer.alloc(8), // Granule position (simplified)
    Buffer.from([0, 0, 0, 1]), // Serial
    Buffer.from([0, 0, 0, 1]), // Sequence
    Buffer.alloc(4), // CRC
    Buffer.from([segments]),
    segmentTable
  ]);
  
  return Buffer.concat([header, opus]);
}

convertToAudio().catch(console.error);