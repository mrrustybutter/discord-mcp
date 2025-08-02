#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import http from 'http';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { UserDiscordClient } from './userDiscordClient.js';
import { ElevenLabsService } from './elevenLabsService.js';
import { DiscordLogin } from './discordLogin.js';
import { loggers } from './logger.js';

const logger = loggers.mcp;
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

// Helper function for local TTS fallback
async function generateLocalTTS(text: string): Promise<Buffer> {
  const ttsDir = path.join(process.cwd(), 'packages', 'local-tts');
  const outputPath = path.join(ttsDir, 'output', `discord_${Date.now()}.wav`);
  
  // Create output directory if it doesn't exist
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  
  // Generate audio
  const { stderr } = await execAsync(
    `cd "${ttsDir}" && python stream_audio.py --text "${text.replace(/"/g, '\\"')}" --output "${outputPath}" --emotion hyped --energy 8`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  
  if (stderr && !stderr.includes('Using device:')) {
    logger.error('TTS generation error', { stderr });
  }
  
  // Read the generated audio file
  const audioBuffer = await fs.readFile(outputPath);
  
  // Clean up
  await fs.unlink(outputPath).catch(() => {});
  
  return audioBuffer;
}

// Initialize clients
const discordClient = new UserDiscordClient();

// Initialize ElevenLabs if credentials are available
let elevenLabs: ElevenLabsService | null = null;
if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
  elevenLabs = new ElevenLabsService(
    process.env.ELEVENLABS_API_KEY,
    process.env.ELEVENLABS_VOICE_ID
  );
  logger.info('ElevenLabs initialized', { voiceId: process.env.ELEVENLABS_VOICE_ID });
} else {
  logger.warn('ElevenLabs not configured - TTS will use local fallback');
}

// MCP Server
const server = new Server(
  {
    name: 'discord-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Store handlers for HTTP access
const listToolsHandler = async () => ({
  tools: [
    {
      name: 'discord_login',
      description: 'Login to Discord using username and password to get authentication cookie',
      inputSchema: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Discord username/email'
          },
          password: {
            type: 'string',
            description: 'Discord password'
          }
        },
        required: ['username', 'password']
      }
    },
    {
      name: 'discord_connect',
      description: 'Connect to Discord using cookie authentication',
      inputSchema: {
        type: 'object',
        properties: {
          cookie: {
            type: 'string',
            description: 'Discord cookie string (optional, uses env if not provided)'
          }
        }
      }
    },
    {
      name: 'discord_list_servers',
      description: 'List all Discord servers the user is in',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'discord_list_channels',
      description: 'List all channels in a Discord server',
      inputSchema: {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: 'Discord server ID'
          }
        },
        required: ['serverId']
      }
    },
    {
      name: 'discord_list_voice_channels',
      description: 'List all voice channels in a Discord server',
      inputSchema: {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: 'Discord server ID'
          }
        },
        required: ['serverId']
      }
    },
    {
      name: 'discord_send_message',
      description: 'Send a message to a Discord channel',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'Discord channel ID'
          },
          message: {
            type: 'string',
            description: 'Message to send'
          }
        },
        required: ['channelId', 'message']
      }
    },
    {
      name: 'discord_read_messages',
      description: 'Read recent messages from a Discord channel',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'Discord channel ID'
          },
          limit: {
            type: 'number',
            description: 'Number of messages to fetch (default: 10)',
            minimum: 1,
            maximum: 100
          }
        },
        required: ['channelId']
      }
    },
    {
      name: 'discord_join_voice',
      description: 'Join a Discord voice channel',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'Voice channel ID'
          },
          serverId: {
            type: 'string',
            description: 'Server ID (deprecated, use guildId)'
          },
          guildId: {
            type: 'string',
            description: 'Guild ID'
          }
        },
        required: ['channelId']
      }
    },
    {
      name: 'discord_leave_voice',
      description: 'Leave the current voice channel in a server',
      inputSchema: {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: 'Server ID'
          }
        },
        required: ['serverId']
      }
    },
    {
      name: 'voice_speak',
      description: 'Speak in voice channel using ElevenLabs TTS',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to speak'
          }
        },
        required: ['text']
      }
    },
    {
      name: 'discord_get_voice_members',
      description: 'Get list of members in current voice channel',
      inputSchema: {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: 'Server ID'
          },
          channelId: {
            type: 'string',
            description: 'Voice channel ID'
          }
        },
        required: ['serverId', 'channelId']
      }
    },
    {
      name: 'discord_get_status',
      description: 'Get current Discord connection status',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ]
});

const callToolHandler = async (request: any) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'discord_login': {
        const { username, password } = args as { username: string; password: string };
        
        logger.info('Starting Discord login');
        const loginService = new DiscordLogin();
        const result = await loginService.login(username, password);
        
        if (result.success) {
          // Store the cookie in environment for immediate use
          if (result.cookie) {
            process.env.DISCORD_USER_COOKIE = result.cookie;
          }
          
          return {
            content: [{
              type: 'text',
              text: `Login successful! Cookie saved and ready to use. ${result.token ? 'Token also extracted.' : 'No token extracted.'}`
            }]
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: `Login failed: ${result.error}`
            }]
          };
        }
      }

      case 'discord_connect': {
        const { cookie } = args as { cookie?: string };
        
        // Check if already connected
        const currentStatus = await discordClient.getStatus();
        if (currentStatus.connected) {
          return { content: [{ type: 'text', text: 'Already connected to Discord!' }] };
        }
        
        const actualCookie = cookie || process.env.DISCORD_USER_COOKIE;
        if (!actualCookie && !process.env.DISCORD_USERNAME) {
          throw new Error('No Discord cookie provided and no login credentials available');
        }
        
        logger.info('Connecting to Discord');
        // Pass the cookie only if we have one, otherwise let connect() load from file
        if (actualCookie) {
          await discordClient.connect(actualCookie);
        } else {
          await discordClient.connect();
        }
        
        // Wait for ready event with better error handling
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout - ready event not received'));
          }, 30000);
          
          discordClient.once('ready', () => {
            logger.info('Ready event received, connection established');
            clearTimeout(timeout);
            // Wait a bit more to ensure token is fully synchronized
            setTimeout(resolve, 2000);
          });
        });
        
        return { content: [{ type: 'text', text: 'Successfully connected to Discord!' }] };
      }

      case 'discord_list_servers': {
        const servers = await discordClient.getGuilds();
        return { 
          content: [{ 
            type: 'text', 
            text: `Found ${servers.length} servers:\n${JSON.stringify(servers, null, 2)}` 
          }] 
        };
      }

      case 'discord_list_channels': {
        const { serverId } = args as { serverId: string };
        const channels = await discordClient.getChannels(serverId);
        return { 
          content: [{ 
            type: 'text', 
            text: `Channels:\n${JSON.stringify(channels, null, 2)}` 
          }] 
        };
      }

      case 'discord_list_voice_channels': {
        const { serverId } = args as { serverId: string };
        const allChannels = await discordClient.getChannels(serverId);
        // Filter for voice channels (type 2)
        const voiceChannels = allChannels.filter((ch: any) => ch.type === 2);
        return { 
          content: [{ 
            type: 'text', 
            text: `Voice Channels:\n${JSON.stringify(voiceChannels, null, 2)}` 
          }] 
        };
      }

      case 'discord_send_message': {
        const { channelId, message } = args as { channelId: string; message: string };
        await discordClient.sendMessage(channelId, message);
        return { 
          content: [{ 
            type: 'text', 
            text: `Message sent to channel ${channelId}` 
          }] 
        };
      }

      case 'discord_read_messages': {
        const { channelId, limit = 10 } = args as { channelId: string; limit?: number };
        const messages = await discordClient.getMessages(channelId, limit);
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(messages, null, 2) 
          }] 
        };
      }

      case 'discord_join_voice': {
        const { channelId, serverId, guildId } = args as { channelId: string; serverId?: string; guildId?: string };
        const actualGuildId = serverId || guildId;
        if (!actualGuildId) {
          throw new Error('Either serverId or guildId must be provided');
        }
        await discordClient.joinVoiceChannel(actualGuildId, channelId);
        
        // Wait a moment for voice connection to establish
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Automatically start real-time transcription - ENABLED!
        try {
          logger.info('Starting voice handler transcription');
          
          // Get the voice handler from Discord client
          const voiceHandler = discordClient.getVoiceHandler();
          if (voiceHandler) {
            logger.info('Voice handler found, enabling transcription');
            voiceHandler.setTranscriptionEnabled(true);
            
            // Listen for transcription events
            voiceHandler.on('transcription', (data: any) => {
              logger.info('Transcription received', data);
            });
            
            logger.info('Transcription enabled and listening!');
          } else {
            logger.warn('No voice handler available yet');
          }
          // Skip transcription - commented out original code
          /*
            
            // Get server and channel names
            let serverName: string | undefined;
            let channelName: string | undefined;
            
            try {
              // Get server info
              const guilds = await discordClient.getGuilds();
              const guild = guilds.find(g => g.id === actualGuildId);
              serverName = guild?.name;
              
              // Get channel info
              const channels = await discordClient.getChannels(actualGuildId);
              const channel = channels.find(ch => ch.id === channelId);
              channelName = channel?.name;
            } catch (error) {
              logger.error('Failed to get server/channel names', { error });
            }
            
            // Get WebRTC handler for audio stream
            const webrtcHandler = discordClient.getVoiceHandler();
            if (webrtcHandler) {
              // Listen for decrypted opus packets from WebRTC handler
              webrtcHandler.on('opusPacket', (data) => {
                opusHandler.handleOpusPacket(data);
              });
              
              // Listen for transcription events from WebRTC handler
              webrtcHandler.on('transcription', (data) => {
                logger.info('Transcription from user', { userId: data.userId, text: data.text });
                // You can emit this to other systems or store it
                const memberInfo = members.find(m => m.id === data.userId) || { username: data.userId };
                logger.info('User message', { username: memberInfo.username, text: data.text });
              });
              
              // Listen for complete audio segments from opus handler
              opusHandler.on('audioSegment', async (segment) => {
                logger.info('Got audio segment', { userId: segment.userId, duration: segment.duration });
                
                // Convert PCM to WAV and transcribe with Whisper
                try {
                  const { spawn } = await import('child_process');
                  const tempDir = path.join(process.cwd(), 'temp');
                  await fs.mkdir(tempDir, { recursive: true });
                  
                  const timestamp = Date.now();
                  const pcmPath = path.join(tempDir, `${segment.userId}_${timestamp}.pcm`);
                  const wavPath = path.join(tempDir, `${segment.userId}_${timestamp}.wav`);
                  
                  // Write PCM data
                  await fs.writeFile(pcmPath, segment.pcmAudio);
                  
                  // Convert PCM to WAV using ffmpeg
                  await new Promise<void>((resolve, reject) => {
                    const ffmpeg = spawn('ffmpeg', [
                      '-f', 's16le',
                      '-ar', '48000',
                      '-ac', '2',
                      '-i', pcmPath,
                      '-f', 'wav',
                      '-y',
                      wavPath
                    ]);
                    
                    ffmpeg.on('error', reject);
                    ffmpeg.on('close', (code) => {
                      if (code === 0) resolve();
                      else reject(new Error(`ffmpeg exited with code ${code}`));
                    });
                  });
                  
                  // Transcribe with Whisper
                  const text = await new Promise<string>((resolve, reject) => {
                    const whisper = spawn('whisper', [
                      wavPath,
                      '--model', 'base.en',
                      '--language', 'en',
                      '--output_format', 'txt',
                      '--output_dir', tempDir,
                      '--verbose', 'False'
                    ]);
                    
                    let stderr = '';
                    whisper.stderr.on('data', (data) => {
                      stderr += data.toString();
                    });
                    
                    whisper.on('error', reject);
                    whisper.on('close', async (code) => {
                      if (code === 0) {
                        const txtPath = wavPath.replace('.wav', '.txt');
                        try {
                          const transcript = await fs.readFile(txtPath, 'utf-8');
                          await fs.unlink(txtPath).catch(() => {});
                          resolve(transcript.trim());
                        } catch (error) {
                          reject(new Error('Failed to read transcript file'));
                        }
                      } else {
                        reject(new Error(`Whisper exited with code ${code}: ${stderr}`));
                      }
                    });
                  });
                  
                  // Clean up temp files
                  await fs.unlink(pcmPath).catch(() => {});
                  await fs.unlink(wavPath).catch(() => {});
                  
                  if (text && text.trim()) {
                    logger.info('Transcribed audio', { userId: segment.userId, text });
                    
                    // Add to transcript
                    const activeTranscript = transcriptHandler.getTranscript(actualGuildId);
                    if (activeTranscript) {
                      const username = activeTranscript.userMap.get(segment.userId) || 'Unknown User';
                      await transcriptHandler.addTranscriptMessage(activeTranscript, {
                        userId: segment.userId,
                        username,
                        timestamp: Date.now(),
                        text: text.trim()
                      });
                    }
                  }
                  
                } catch (error) {
                  logger.error('Failed to transcribe audio', { userId: segment.userId, error });
                }
              });
              
              // Store opus handler for cleanup
              (webrtcHandler as any).opusHandler = opusHandler;
              
              logger.info('Voice reception pipeline ready: RTP -> Decrypt -> Opus Decode -> PCM');
              
              // Create transcript file with server and channel names
              const transcriptPath = await transcriptHandler.startTranscription(
                null as any, 
                actualGuildId, 
                channelId, 
                memberMap,
                serverName,
                channelName
              );
              logger.info('Transcript file created', { path: transcriptPath });
            } else {
              logger.warn('WebRTC handler not available for transcription');
            }
          */
        } catch (error) {
          logger.error('Failed to start real-time transcription', { error });
        }
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Joined voice channel ${channelId} and started transcription` 
          }] 
        };
      }

      case 'discord_leave_voice': {
        const { serverId } = args as { serverId: string };
        
        await discordClient.leaveVoiceChannel(serverId);
        
        return { 
          content: [{ 
            type: 'text', 
            text: 'Left voice channel'
          }] 
        };
      }

      case 'voice_speak': {
        const { text } = args as { text: string };
        
        logger.info('voice_speak called', { text });
        
        // Check if we're in a voice channel
        const status = await discordClient.getStatus();
        if (!status.connected) {
          throw new Error('Not connected to Discord');
        }
        
        // Check if we have a voice handler
        const voiceHandler = discordClient.getVoiceHandler();
        if (!voiceHandler) {
          throw new Error('Not connected to a voice channel. Use discord_join_voice first.');
        }
        
        // Generate audio using ElevenLabs or fallback
        let audioBuffer: Buffer;
        
        logger.info('Generating audio');
        
        if (elevenLabs) {
          // Use ElevenLabs
          try {
            logger.info('Using ElevenLabs TTS');
            audioBuffer = await elevenLabs.generateSpeech(text);
            logger.info('Generated audio with ElevenLabs', { size: audioBuffer.length });
          } catch (error) {
            logger.error('ElevenLabs failed', { error });
            logger.info('Falling back to local TTS');
            // Fallback to local TTS
            audioBuffer = await generateLocalTTS(text);
            logger.info('Generated audio with local TTS', { size: audioBuffer.length });
          }
        } else {
          // Use local TTS
          logger.info('Using local TTS (no ElevenLabs configured)');
          audioBuffer = await generateLocalTTS(text);
          logger.info('Generated audio with local TTS', { size: audioBuffer.length });
        }
        
        // Play through voice channel
        try {
          logger.info('Playing audio in voice channel');
          await discordClient.playAudioInVoice(audioBuffer);
          logger.info('Audio playback completed successfully');
          
          return { 
            content: [{ 
              type: 'text', 
              text: `Speaking: "${text}"` 
            }] 
          };
        } catch (error) {
          logger.error('Failed to play audio', { error });
          logger.error('Audio playback error details', { stack: error instanceof Error ? error.stack : 'No stack trace' });
          
          // Check if it's a voice connection issue
          if (error instanceof Error && error.message.includes('Not connected to voice channel')) {
            throw new Error('Lost voice connection. Please rejoin the voice channel.');
          }
          
          throw new Error(`Audio playback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      case 'discord_start_listening': {
        const { serverId } = args as { serverId: string };
        
        // Check if we're in a voice channel
        const status = await discordClient.getStatus();
        if (!status.connected) {
          throw new Error('Not connected to Discord');
        }
        
        // Get voice channel members
        const voiceState = await discordClient.getVoiceState(serverId);
        if (!voiceState || !voiceState.channel_id) {
          throw new Error('Not in a voice channel');
        }
        
        const members = await discordClient.getVoiceMembers(serverId, voiceState.channel_id);
        
        // Get WebRTC handler
        const webrtcHandler = discordClient.getVoiceHandler();
        if (!webrtcHandler) {
          throw new Error('WebRTC not initialized - make sure you are connected to a voice channel');
        }
        
        // Enable transcription on the voice handler
        webrtcHandler.setTranscriptionEnabled(true);
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Started listening in voice channel with ${members.length} members` 
          }] 
        };
      }

      case 'discord_stop_listening': {
        const { serverId } = args as { serverId: string };
        
        // Get WebRTC handler
        const webrtcHandler = discordClient.getVoiceHandler();
        if (!webrtcHandler) {
          throw new Error('Not in a voice channel');
        }
        
        // Disable transcription
        webrtcHandler.setTranscriptionEnabled(false);
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Stopped listening` 
          }] 
        };
      }

      case 'discord_get_voice_members': {
        const { serverId, channelId } = args as { serverId: string; channelId: string };
        const members = await discordClient.getVoiceMembers(serverId, channelId);
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(members, null, 2) 
          }] 
        };
      }

      case 'discord_get_status': {
        const status = await discordClient.getStatus();
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(status, null, 2) 
          }] 
        };
      }

      case 'discord_get_partial_transcript': {
        const { serverId } = args as { serverId: string };
        
        return { 
          content: [{ 
            type: 'text', 
            text: 'Partial transcript not available - use voice_get_transcript instead' 
          }] 
        };
      }

      case 'voice_get_transcript': {
        // This will be implemented when transcription events are properly handled
        return { 
          content: [{ 
            type: 'text', 
            text: 'Transcription feature is being debugged' 
          }] 
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Discord operation failed: ${errorMessage}`
    );
  }
};

// Set up MCP server handlers
server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
server.setRequestHandler(CallToolRequestSchema, callToolHandler);

// Start the server
async function main() {
  logger.info('Starting server');
  
  // Check if we should use SSE or stdio
  const useSSE = process.argv.includes('--sse') || process.env.MCP_TRANSPORT === 'sse';
  const port = parseInt(process.env.MCP_PORT || '3001');
  
  if (useSSE) {
    logger.info(`Starting HTTP server on port ${port}`);
    
    // Create HTTP server that proxies to MCP server
    const httpServer = http.createServer(async (req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      if (req.method !== 'POST' || req.url !== '/message') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        let request: any;
        let requestId: any = null;
        
        try {
          // Parse request with better error handling
          try {
            request = JSON.parse(body);
            requestId = request.id;
          } catch (parseError) {
            logger.error('JSON Parse Error', { parseError });
            logger.debug('Raw body', { body });
            throw new Error(`Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
          }
          
          logger.debug(`HTTP Request ${requestId}: ${request.method}`);
          if (request.params) {
            logger.debug('Request parameters', request.params);
          }
          
          let result;
          
          // Handle MCP requests by calling handlers directly
          if (request.method === 'tools/list') {
            result = await listToolsHandler();
          } else if (request.method === 'tools/call') {
            if (!request.params?.name) {
              throw new Error('Missing required parameter: name');
            }
            logger.debug(`Calling tool: ${request.params.name}`);
            result = await callToolHandler({ params: request.params });
          } else {
            throw new Error(`Unknown method: ${request.method}`);
          }
          
          const response = {
            jsonrpc: '2.0',
            id: requestId,
            result
          };
          
          logger.debug(`Success response for request ${requestId}`);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(response, null, 2));
          
        } catch (error) {
          logger.error(`Error handling request ${requestId}`, { error });
          logger.error('Stack trace', { stack: error instanceof Error ? error.stack : 'No stack trace' });
          
          const errorResponse = {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
              data: {
                stack: error instanceof Error ? error.stack : undefined,
                body: body.substring(0, 1000) // Include first 1000 chars of body for debugging
              }
            }
          };
          
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(errorResponse, null, 2));
        }
      });
    });
    
    httpServer.listen(port, () => {
      logger.info(`HTTP server started on http://localhost:${port}`);
      logger.info(`Test tools list: curl -X POST http://localhost:${port}/message -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`);
      logger.info(`Test connect: curl -X POST http://localhost:${port}/message -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discord_connect","arguments":{}}}'`);
    });
  } else {
    logger.info('Starting stdio server');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Stdio server started successfully');
  }
}

main().catch((error) => {
  logger.fatal('Fatal error', { error });
  process.exit(1);
});