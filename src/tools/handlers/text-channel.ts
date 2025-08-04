import { DiscordBotService } from '../../services/discord-bot.js';
import { StateManager } from '../../services/state-manager.js';

export class TextChannelHandlers {
  constructor(
    private botService: DiscordBotService,
    private stateManager: StateManager
  ) {}

  async handleViewTextChannel(args: { channel_name: string }) {
    const currentServer = this.stateManager.getCurrentServer();
    if (!currentServer) {
      throw new Error('No server selected. Use view_server first.');
    }

    const channels = await this.botService.listChannels(currentServer.id);
    const channel = channels.find(c => 
      c.type === 'GuildText' && 
      c.name.toLowerCase() === args.channel_name.toLowerCase()
    );

    if (!channel) {
      throw new Error(`Text channel "${args.channel_name}" not found in server "${currentServer.name}"`);
    }

    this.stateManager.setCurrentTextChannel(channel.id, channel.name);

    return {
      content: [{
        type: 'text',
        text: `Now viewing text channel: #${channel.name}`,
      }],
    };
  }

  async handleReadMessages(args: { limit?: number; before_message_id?: string }) {
    const currentChannel = this.stateManager.getCurrentTextChannel();
    if (!currentChannel) {
      throw new Error('No text channel selected. Use view_text_channel first.');
    }

    const messages = await this.botService.readMessages(
      currentChannel.id, 
      args.limit || 10
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          channel: currentChannel.name,
          messageCount: messages.length,
          messages: messages.map(msg => ({
            id: msg.id,
            author: msg.author.username,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
            attachments: msg.attachments,
            reactions: msg.reactions,
          })).reverse(), // Show oldest first
        }, null, 2),
      }],
    };
  }

  async handleSendMessage(args: { message: string }) {
    const currentChannel = this.stateManager.getCurrentTextChannel();
    if (!currentChannel) {
      throw new Error('No text channel selected. Use view_text_channel first.');
    }

    await this.botService.sendMessage(currentChannel.id, args.message);

    return {
      content: [{
        type: 'text',
        text: `Message sent to #${currentChannel.name}`,
      }],
    };
  }

  async handleSendMessageWithFile(args: {
    message?: string;
    file_url: string;
    file_name?: string;
  }) {
    const currentChannel = this.stateManager.getCurrentTextChannel();
    if (!currentChannel) {
      throw new Error('No text channel selected. Use view_text_channel first.');
    }

    await this.botService.sendMessageWithAttachment(
      currentChannel.id,
      args.message,
      args.file_url,
      args.file_name
    );

    return {
      content: [{
        type: 'text',
        text: `Message with attachment sent to #${currentChannel.name}`,
      }],
    };
  }

  async handleAddReaction(args: { message_id: string; emoji: string }) {
    const currentChannel = this.stateManager.getCurrentTextChannel();
    if (!currentChannel) {
      throw new Error('No text channel selected. Use view_text_channel first.');
    }

    await this.botService.addReaction(
      currentChannel.id,
      args.message_id,
      args.emoji
    );

    return {
      content: [{
        type: 'text',
        text: `Added reaction ${args.emoji} to message`,
      }],
    };
  }
}