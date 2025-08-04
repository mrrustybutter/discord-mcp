import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
loadEnv({ path: resolve(process.cwd(), '.env') });

export const config = {
  // Discord Configuration
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,

  // Google Gemini Configuration
  GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash-002',

  // ElevenLabs Configuration
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY!,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'Au8OOcCmvsCaQpmULvvQ',
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2',
  ELEVENLABS_OUTPUT_FORMAT: process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_64',

  // Voice Activity Detection
  ACTIVATION_THRESHOLD: parseFloat(process.env.ACTIVATION_THRESHOLD || '0.5'),
  DEACTIVATION_THRESHOLD: parseFloat(process.env.DEACTIVATION_THRESHOLD || '0.3'),
  SILENCE_DURATION: parseInt(process.env.SILENCE_DURATION || '1000'),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Transcripts
  ENABLE_TRANSCRIPT_LOGGING: process.env.ENABLE_TRANSCRIPT_LOGGING === 'true',
  TRANSCRIPT_DIR: process.env.TRANSCRIPT_DIR || './transcripts',
} as const;

// Validate required configuration
const requiredConfigs = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID', 
  'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY',
];

for (const key of requiredConfigs) {
  if (!config[key as keyof typeof config]) {
    console.error(`ERROR: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}