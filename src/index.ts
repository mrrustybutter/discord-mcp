#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { DiscordBotService } from './services/discord-bot.js';
import { config } from './config.js';
import { ToolHandler, allTools } from './tools/index.js';

class DiscordBotMCPServer {
  private server: Server;
  private botService: DiscordBotService;
  private toolHandler: ToolHandler;

  constructor() {
    this.botService = new DiscordBotService();
    this.toolHandler = new ToolHandler(this.botService);

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
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.toolHandler.handleToolCall(request);
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
    
    // Store transports by sessionId
    const transports: Map<string, SSEServerTransport> = new Map();
    
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
      
      // GET /sse - Establish SSE connection
      if (req.method === 'GET' && req.url === '/sse') {
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);
        
        res.on('close', () => {
          transports.delete(transport.sessionId);
        });
        
        await this.server.connect(transport);
        return;
      }
      
      // POST /message - Handle messages
      if (req.method === 'POST' && req.url?.startsWith('/message')) {
        // Extract sessionId from query params
        const url = new URL(req.url, `http://localhost:3003`);
        const sessionId = url.searchParams.get('sessionId');
        
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400);
          res.end('Invalid or missing sessionId');
          return;
        }
        
        const transport = transports.get(sessionId)!;
        
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const message = JSON.parse(body);
            await transport.handlePostMessage(req, res, message);
          } catch (error) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }
      
      // Default response
      res.writeHead(404);
      res.end('Not found');
    });
    
    httpServer.listen(3003, '127.0.0.1', () => {
      console.error('[Discord Bot MCP] SSE Server running on http://localhost:3003');
      console.error('[Discord Bot MCP] SSE endpoint: GET http://localhost:3003/sse');
      console.error('[Discord Bot MCP] Message endpoint: POST http://localhost:3003/message?sessionId=<sessionId>');
    });
  }

  private async startStdioServer() {
    console.error('[Discord Bot MCP] Starting in stdio mode...');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new DiscordBotMCPServer();
server.run().catch(console.error);