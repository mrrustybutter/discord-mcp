import { config } from '../config.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

class Logger {
  private levels: Record<LogLevel, number> = {
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  private currentLevel: number;

  constructor() {
    this.currentLevel = this.levels[config.LOG_LEVEL as LogLevel] || this.levels.info;
  }

  private log(level: LogLevel, ...args: any[]) {
    if (this.levels[level] <= this.currentLevel) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (level === 'error') {
        console.error(prefix, ...args);
      } else if (level === 'warn') {
        console.warn(prefix, ...args);
      } else {
        console.log(prefix, ...args);
      }
    }
  }

  error(...args: any[]) {
    this.log('error', ...args);
  }

  warn(...args: any[]) {
    this.log('warn', ...args);
  }

  info(...args: any[]) {
    this.log('info', ...args);
  }

  debug(...args: any[]) {
    this.log('debug', ...args);
  }
}

export const logger = new Logger();