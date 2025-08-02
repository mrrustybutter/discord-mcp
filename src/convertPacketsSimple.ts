import fs from 'fs';
import path from 'path';
import nacl from 'tweetnacl';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Your secret key from the log
const SECRET_KEY = Buffer.from([
  191, 119, 211, 178, 210, 110,  48, 200,
  149,  59,  80, 183, 180, 135, 111, 110,
   32, 140,  71, 208, 244, 226,  73,   4,
   17, 199,  59,  96,  97,  10,   2, 176
]);

async function convertPackets() {
  const debugDir = path.join(__dirname, '..', 'audio-debug');
  const outputDir = path.join(__dirname, '..', 'audio-output');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Process one specific packet for testing
  const testFile = 'packet_1754108123610_size_89.bin';
  const packet = fs.readFileSync(path.join(debugDir, testFile));
  
  console.log(`Processing ${testFile}`);
  console.log(`Raw packet (first 20 bytes): ${packet.slice(0, 20).toString('hex')}`);
  
  // Basic RTP header parsing
  const ssrc = packet.readUInt32BE(8);
  console.log(`SSRC: ${ssrc}`);
  
  // Get encrypted payload (after 12-byte RTP header)
  const payload = packet.slice(12);
  console.log(`Encrypted payload size: ${payload.length}`);
  console.log(`Encrypted payload (first 20 bytes): ${payload.slice(0, 20).toString('hex')}`);
  
  // Decrypt
  const nonceBuffer = payload.slice(-4);
  const audioData = payload.slice(0, -4);
  
  console.log(`Nonce: ${nonceBuffer.toString('hex')}`);
  console.log(`Encrypted audio size: ${audioData.length}`);
  
  const nonce = Buffer.alloc(24);
  nonceBuffer.copy(nonce, 0);
  
  const decrypted = nacl.secretbox.open(
    new Uint8Array(audioData),
    new Uint8Array(nonce),
    new Uint8Array(SECRET_KEY)
  );
  
  if (decrypted) {
    const opusData = Buffer.from(decrypted);
    console.log(`\nDecrypted Opus size: ${opusData.length}`);
    console.log(`Decrypted Opus (full): ${opusData.toString('hex')}`);
    
    // Check for Discord header
    if (opusData.readUInt16BE(0) === 0xBEDE) {
      console.log(`Has Discord header 0xBEDE`);
      const headerLen = opusData.readUInt16BE(2);
      console.log(`Discord header length field: ${headerLen}`);
      
      // Try to parse as simple header
      if (opusData.length > 8) {
        const actualOpus = opusData.slice(8); // Try skipping 8 bytes
        console.log(`\nActual Opus (after 8 bytes): ${actualOpus.toString('hex')}`);
        
        // Save the raw Opus
        fs.writeFileSync(path.join(outputDir, 'test_opus.opus'), actualOpus);
        console.log(`\nSaved raw Opus to test_opus.opus`);
        
        // Try to convert to WAV using ffmpeg
        try {
          await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
              '-f', 'opus',
              '-i', path.join(outputDir, 'test_opus.opus'),
              '-acodec', 'pcm_s16le',
              '-ar', '48000',
              '-ac', '2',
              '-y',
              path.join(outputDir, 'test_output.wav')
            ]);
            
            ffmpeg.stderr.on('data', (data) => {
              console.error(`ffmpeg: ${data}`);
            });
            
            ffmpeg.on('close', (code) => {
              if (code === 0) {
                console.log(`Created test_output.wav`);
                resolve(true);
              } else {
                reject(new Error(`ffmpeg exited with code ${code}`));
              }
            });
          });
        } catch (error) {
          console.error('Failed to convert with ffmpeg:', error);
        }
      }
    }
  } else {
    console.log('Decryption failed!');
  }
}

convertPackets().catch(console.error);