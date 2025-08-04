import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { DiscordBotService } from '../services/discord-bot.js';
import { StateManager } from '../services/state-manager.js';
import { ConnectionHandlers } from './handlers/connection.js';
import { NavigationHandlers } from './handlers/navigation.js';
import { TextChannelHandlers } from './handlers/text-channel.js';
import { VoiceChannelHandlers } from './handlers/voice-channel.js';

export { allTools } from './definitions.js';

export class ToolHandler {
  private connectionHandlers: ConnectionHandlers;
  private navigationHandlers: NavigationHandlers;
  private textChannelHandlers: TextChannelHandlers;
  private voiceChannelHandlers: VoiceChannelHandlers;

  constructor(
    private botService: DiscordBotService,
    private stateManager: StateManager
  ) {
    this.connectionHandlers = new ConnectionHandlers(botService, stateManager);
    this.navigationHandlers = new NavigationHandlers(botService, stateManager);
    this.textChannelHandlers = new TextChannelHandlers(botService, stateManager);
    this.voiceChannelHandlers = new VoiceChannelHandlers(botService, stateManager);
  }

  async handleToolCall(request: CallToolRequest) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Connection tools
        case 'bot_status':
          return await this.connectionHandlers.handleStatus();

        // Navigation tools
        case 'list_servers':
          return await this.navigationHandlers.handleListServers();
        case 'view_server':
          return await this.navigationHandlers.handleViewServer(args);
        case 'list_channels':
          return await this.navigationHandlers.handleListChannels();

        // Text channel tools
        case 'view_text_channel':
          return await this.textChannelHandlers.handleViewTextChannel(args);
        case 'read_messages':
          return await this.textChannelHandlers.handleReadMessages(args);
        case 'send_message':
          return await this.textChannelHandlers.handleSendMessage(args);
        case 'send_message_with_file':
          return await this.textChannelHandlers.handleSendMessageWithFile(args);
        case 'add_reaction':
          return await this.textChannelHandlers.handleAddReaction(args);

        // Voice channel tools
        case 'join_voice_channel':
          return await this.voiceChannelHandlers.handleJoinVoiceChannel(args);
        case 'leave_voice_channel':
          return await this.voiceChannelHandlers.handleLeaveVoiceChannel();
        case 'speak':
          return await this.voiceChannelHandlers.handleSpeak(args);
        case 'read_voice_transcript':
          return await this.voiceChannelHandlers.handleReadVoiceTranscript(args);
        case 'clear_voice_transcript':
          return await this.voiceChannelHandlers.handleClearVoiceTranscript();
        case 'list_voice_members':
          return await this.voiceChannelHandlers.handleListVoiceMembers();

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
      };
    }
  }
}