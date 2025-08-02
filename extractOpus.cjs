const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');

// Your secret key from the log
const SECRET_KEY = Buffer.from([
  191, 119, 211, 178, 210, 110,  48, 200,
  149,  59,  80, 183, 180, 135, 111, 110,
   32, 140,  71, 208, 244, 226,  73,   4,
   17, 199,  59,  96,  97,  10,   2, 176
]);

const debugDir = path.join(__dirname, 'audio-debug');
const outputDir = path.join(__dirname, 'audio-output');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get all packet files
const files = fs.readdirSync(debugDir)
  .filter(f => f.startsWith('packet_') && f.endsWith('.bin'))
  .sort();

console.log(`Found ${files.length} packet files`);

// Create PCM output file
const pcmPath = path.join(outputDir, 'output.pcm');
const pcmStream = fs.createWriteStream(pcmPath);

let processedCount = 0;
let totalOpusSize = 0;

// Import opus decoder
const prism = require('prism-media');
const decoder = new prism.opus.Decoder({
  rate: 48000,
  channels: 2,
  frameSize: 960
});

// Pipe decoder output to PCM file
decoder.pipe(pcmStream);

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
        totalOpusSize += opusData.length;
        processedCount++;
        
        // Write to decoder
        decoder.write(opusData);
      }
    }
  } catch (error) {
    // Skip failed packets
  }
}

decoder.end();

console.log(`Processed ${processedCount} audio packets`);
console.log(`Total Opus data: ${totalOpusSize} bytes`);

// Wait for decoder to finish
decoder.on('end', () => {
  console.log(`PCM data written to ${pcmPath}`);
  
  // Convert PCM to WAV using ffmpeg
  const { spawn } = require('child_process');
  const wavPath = path.join(outputDir, 'output.wav');
  
  const ffmpeg = spawn('ffmpeg', [
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-i', pcmPath,
    '-y',
    wavPath
  ]);
  
  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`Created ${wavPath}`);
      
      // Also create MP3
      const mp3Path = path.join(outputDir, 'output.mp3');
      const ffmpeg2 = spawn('ffmpeg', [
        '-i', wavPath,
        '-acodec', 'mp3',
        '-ab', '128k',
        '-y',
        mp3Path
      ]);
      
      ffmpeg2.on('close', (code) => {
        if (code === 0) {
          console.log(`Created ${mp3Path}`);
        }
      });
    }
  });
});