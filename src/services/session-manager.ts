import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StateManager } from './state-manager.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

export interface Session {
  id: string;
  transport?: SSEServerTransport;
  stateManager: StateManager;
  createdAt: Date;
  lastActivity: Date;
  keepAliveInterval?: NodeJS.Timeout;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes
  private keepAliveInterval = 30 * 1000; // 30 seconds
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 60 * 1000); // Check every minute
  }

  createSimpleSession(): string {
    const sessionId = randomUUID();
    const stateManager = new StateManager();
    
    const session: Session = {
      id: sessionId,
      stateManager,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    logger.info(`Created simple session ${sessionId}`);
    
    return sessionId;
  }

  createSession(transport: SSEServerTransport): Session {
    const sessionId = transport.sessionId;
    
    // Create a new state manager for this session
    const stateManager = new StateManager();
    
    const session: Session = {
      id: sessionId,
      transport,
      stateManager,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    // Set up keep-alive ping
    session.keepAliveInterval = setInterval(() => {
      this.sendKeepAlive(session);
    }, this.keepAliveInterval);

    // Handle transport close
    const originalOnClose = transport.onclose;
    transport.onclose = () => {
      logger.info(`Session ${sessionId} transport closed`);
      this.removeSession(sessionId);
      originalOnClose?.();
    };

    this.sessions.set(sessionId, session);
    logger.info(`Created session ${sessionId}`);
    
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Update last activity
      session.lastActivity = new Date();
    }
    return session;
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clear keep-alive interval
      if (session.keepAliveInterval) {
        clearInterval(session.keepAliveInterval);
      }
      
      // Close transport if still open (for SSE sessions)
      if (session.transport) {
        session.transport.close().catch(err => 
          logger.error(`Error closing transport for session ${sessionId}:`, err)
        );
      }
      
      this.sessions.delete(sessionId);
      logger.info(`Removed session ${sessionId}`);
    }
  }

  private sendKeepAlive(session: Session): void {
    // Only send keepalive for SSE sessions
    if (!session.transport) return;
    
    try {
      // Send a keep-alive event to maintain the connection
      session.transport.send({
        jsonrpc: '2.0',
        method: 'keepalive',
        params: {
          timestamp: new Date().toISOString(),
          sessionId: session.id
        }
      }).catch(err => {
        logger.error(`Failed to send keepalive for session ${session.id}:`, err);
        // If keepalive fails, remove the session
        this.removeSession(session.id);
      });
    } catch (error) {
      logger.error(`Error in keepalive for session ${session.id}:`, error);
      this.removeSession(session.id);
    }
  }

  private cleanupStaleSessions(): void {
    const now = new Date();
    const staleThreshold = now.getTime() - this.sessionTimeout;

    for (const [sessionId, session] of this.sessions) {
      if (session.lastActivity.getTime() < staleThreshold) {
        logger.info(`Cleaning up stale session ${sessionId}`);
        this.removeSession(sessionId);
      }
    }
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  shutdown(): void {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Remove all sessions
    for (const sessionId of this.sessions.keys()) {
      this.removeSession(sessionId);
    }
  }
}