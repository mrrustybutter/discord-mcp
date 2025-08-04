import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { DiscordBotService } from '../services/discord-bot.js';
import { ConnectionHandlers } from './handlers/connection.js';
import { GuildHandlers } from './handlers/guild.js';
import { VoiceHandlers } from './handlers/voice.js';
import { MessageHandlers } from './handlers/message.js';

export { allTools } from './definitions.js';

export class ToolHandler {
  private connectionHandlers: ConnectionHandlers;
  private guildHandlers: GuildHandlers;
  private voiceHandlers: VoiceHandlers;
  private messageHandlers: MessageHandlers;

  constructor(private botService: DiscordBotService) {
    this.connectionHandlers = new ConnectionHandlers(botService);
    this.guildHandlers = new GuildHandlers(botService);
    this.voiceHandlers = new VoiceHandlers(botService);
    this.messageHandlers = new MessageHandlers(botService);
  }

  async handleToolCall(request: CallToolRequest) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Connection tools
        case 'bot_connect':
          return await this.connectionHandlers.handleConnect();
        case 'bot_disconnect':
          return await this.connectionHandlers.handleDisconnect();
        case 'bot_status':
          return await this.connectionHandlers.handleStatus();

        // Guild tools
        case 'list_guilds':
          return await this.guildHandlers.handleListGuilds();
        case 'list_channels':
          return await this.guildHandlers.handleListChannels(args);

        // Voice tools
        case 'join_voice_channel':
          return await this.voiceHandlers.handleJoinVoice(args);
        case 'leave_voice_channel':
          return await this.voiceHandlers.handleLeaveVoice(args);
        case 'speak_in_voice':
          return await this.voiceHandlers.handleSpeak(args);
        case 'start_transcription':
          return await this.voiceHandlers.handleStartTranscription(args);
        case 'stop_transcription':
          return await this.voiceHandlers.handleStopTranscription(args);
        case 'get_voice_members':
          return await this.voiceHandlers.handleGetVoiceMembers(args);

        // Message tools
        case 'send_message':
          return await this.messageHandlers.handleSendMessage(args);
        case 'read_messages':
          return await this.messageHandlers.handleReadMessages(args);
        case 'send_message_with_attachment':
          return await this.messageHandlers.handleSendAttachment(args);
        case 'add_reaction':
          return await this.messageHandlers.handleAddReaction(args);

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