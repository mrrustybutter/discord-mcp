#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { DiscordBotService } from './services/discord-bot.js';
import { StateManager } from './services/state-manager.js';
import { SessionManager } from './services/session-manager.js';
import { config } from './config.js';
import { ToolHandler, allTools } from './tools/index.js';
import { logger } from './utils/logger.js';

class DiscordBotMCPServer {
  private server: Server;
  private botService: DiscordBotService;
  private sessionManager: SessionManager;
  private httpServer?: any;
  private stdioStateManager: StateManager;

  constructor() {
    this.botService = new DiscordBotService();
    this.sessionManager = new SessionManager();
    this.stdioStateManager = new StateManager();

    this.server = new Server(
      {
        name: 'discord-bot-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allTools,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      // Get session from extra context (this will be set up in SSE mode)
      const session = (extra as any)?.session;
      
      if (session) {
        // Use session-specific state manager and tool handler
        const toolHandler = new ToolHandler(this.botService, session.stateManager);
        return await toolHandler.handleToolCall(request);
      } else {
        // Fallback for stdio mode - use persistent state manager
        const toolHandler = new ToolHandler(this.botService, this.stdioStateManager);
        return await toolHandler.handleToolCall(request);
      }
    });
  }

  async run() {
    const isSSE = process.argv.includes('--sse');

    if (isSSE) {
      await this.startSSEServer();
    } else {
      await this.startStdioServer();
    }

    // Print server info
    console.error('[Discord Bot MCP] Server v1.0.0 running');
    console.error(`[Discord Bot MCP] Voice: Gemini ${config.GEMINI_MODEL} transcription`);
    console.error(`[Discord Bot MCP] TTS: ElevenLabs voice ${config.ELEVENLABS_VOICE_ID}`);
    
    // Auto-connect bot on startup
    console.error('[Discord Bot MCP] Auto-connecting Discord bot...');
    try {
      await this.botService.connect();
      console.error('[Discord Bot MCP] ✅ Bot connected successfully!');
    } catch (error) {
      console.error('[Discord Bot MCP] ❌ Failed to auto-connect bot:', error);
    }
  }

  private async startSSEServer() {
    console.error('[Discord Bot MCP] Starting in SSE mode on port 3003...');
    
    const httpServer = createServer(async (req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // GET /session - Create a new session
      if (req.method === 'GET' && req.url === '/session') {
        const sessionId = this.sessionManager.createSimpleSession();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sessionId,
          expiresIn: '30 minutes'
        }));
        return;
      }
      
      // GET /sse - Establish SSE connection (for MCP clients that need it)
      if (req.method === 'GET' && req.url === '/sse') {
        const transport = new SSEServerTransport('/message', res);
        
        // Create session with its own state manager
        const session = this.sessionManager.createSession(transport);
        
        // Create a custom server instance for this session
        const sessionServer = new Server(
          {
            name: 'discord-bot-mcp',
            version: '1.0.0',
          },
          {
            capabilities: {
              tools: {},
            },
          }
        );

        // Set up handlers with session context
        sessionServer.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: allTools,
        }));

        sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
          const toolHandler = new ToolHandler(this.botService, session.stateManager);
          return await toolHandler.handleToolCall(request);
        });
        
        await sessionServer.connect(transport);
        
        logger.info(`SSE client connected with session ${session.id}`);
        return;
      }
      
      // POST /message - Handle messages (with or without session)
      if (req.method === 'POST' && req.url?.startsWith('/message')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const message = JSON.parse(body);
            
            // For stateless requests, handle directly
            if (!req.url?.includes('sessionId')) {
              // Create a temporary state manager for this request
              const stateManager = new StateManager();
              const toolHandler = new ToolHandler(this.botService, stateManager);
              
              if (message.method === 'tools/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: { tools: allTools }
                }));
                return;
              }
              
              if (message.method === 'tools/call') {
                try {
                  const result = await toolHandler.handleToolCall(message);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    result
                  }));
                } catch (error: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                      code: -32603,
                      message: error.message
                    }
                  }));
                }
                return;
              }
            }
            
            // For session-based requests, use the session
            const url = new URL(req.url, `http://localhost:3003`);
            const sessionId = url.searchParams.get('sessionId');
            
            if (!sessionId) {
              res.writeHead(400);
              res.end('Missing sessionId');
              return;
            }
            
            const session = this.sessionManager.getSession(sessionId);
            if (!session) {
              res.writeHead(404);
              res.end('Session not found');
              return;
            }
            
            // For simple sessions (no SSE transport)
            if (!session.transport) {
              const toolHandler = new ToolHandler(this.botService, session.stateManager);
              
              if (message.method === 'tools/list') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: { tools: allTools }
                }));
                return;
              }
              
              if (message.method === 'tools/call') {
                try {
                  const result = await toolHandler.handleToolCall(message);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    result
                  }));
                } catch (error: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                      code: -32603,
                      message: error.message
                    }
                  }));
                }
                return;
              }
            }
            
            // For SSE sessions, use the transport
            await session.transport.handlePostMessage(req, res, message);
          } catch (error) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }
      
      // GET /status - Server status endpoint
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          sessions: this.sessionManager.getSessionCount(),
          bot: {
            connected: this.botService.isConnected(),
            guilds: this.botService.isConnected() ? 
              (await this.botService.listGuilds()).length : 0
          }
        }));
        return;
      }
      
      // Default response
      res.writeHead(404);
      res.end('Not found');
    });
    
    this.httpServer = httpServer;
    
    httpServer.listen(3003, '127.0.0.1', () => {
      console.error('[Discord Bot MCP] SSE Server running on http://localhost:3003');
      console.error('[Discord Bot MCP] SSE endpoint: GET http://localhost:3003/sse');
      console.error('[Discord Bot MCP] Message endpoint: POST http://localhost:3003/message?sessionId=<sessionId>');
      console.error('[Discord Bot MCP] Status endpoint: GET http://localhost:3003/status');
    });
  }

  async shutdown() {
    // Disconnect bot
    if (this.botService.isConnected()) {
      await this.botService.disconnect();
    }
    
    // Shutdown session manager
    this.sessionManager.shutdown();
    
    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
    }
  }

  private async startStdioServer() {
    console.error('[Discord Bot MCP] Starting in stdio mode...');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new DiscordBotMCPServer();

// Handle shutdown
process.on('SIGINT', async () => {
  console.error('\n[Discord Bot MCP] Shutting down...');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n[Discord Bot MCP] Shutting down...');
  await server.shutdown();
  process.exit(0);
});

server.run().catch(console.error);