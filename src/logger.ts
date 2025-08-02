import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure log directory exists
const logDir = join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Production transport configuration
const productionTransport = {
  targets: [
    // Write to file with daily rotation
    {
      target: 'pino/file',
      options: {
        destination: join(logDir, 'discord-mcp.log'),
        mkdir: true
      }
    },
    // Also output to stdout for container logs
    {
      target: 'pino/file',
      options: { destination: 1 } // stdout
    }
  ]
};

// Development transport with pretty printing
const developmentTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
    messageFormat: '{msg}',
    errorLikeObjectKeys: ['err', 'error']
  }
};

// Create logger with environment-specific configuration
export const logger = pino({
  name: 'discord-mcp',
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV === 'production' ? productionTransport : developmentTransport,
  // Add request ID for tracing
  mixin() {
    return { requestId: process.env.REQUEST_ID };
  },
  // Redact sensitive information
  redact: {
    paths: ['token', 'cookie', 'password', 'apiKey', 'secretKey', '*.token', '*.cookie', '*.password'],
    censor: '[REDACTED]'
  },
  // Error serializer
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  }
});

// Create child loggers for different components
export const createLogger = (component: string) => {
  return logger.child({ component });
};

// Export convenience methods
export const loggers = {
  main: createLogger('main'),
  discord: createLogger('discord'),
  voice: createLogger('voice'),
  webrtc: createLogger('webrtc'),
  worker: createLogger('worker'),
  stt: createLogger('stt'),
  tts: createLogger('tts'),
  mcp: createLogger('mcp'),
  transcript: createLogger('transcript'),
  auth: createLogger('auth'),
  cookie: createLogger('cookie'),
  udp: createLogger('udp')
};