import { DiscordBotService } from '../../services/discord-bot.js';

export class MessageHandlers {
  constructor(private botService: DiscordBotService) {}

  async handleSendMessage(args: { channelId: string; message: string }) {
    await this.botService.sendMessage(args.channelId, args.message);
    return {
      content: [{
        type: 'text',
        text: 'Message sent successfully',
      }],
    };
  }

  async handleReadMessages(args: { channelId: string; limit?: number }) {
    const messages = await this.botService.readMessages(args.channelId, args.limit || 10);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(messages, null, 2),
      }],
    };
  }

  async handleSendAttachment(args: {
    channelId: string;
    message?: string;
    attachmentUrl: string;
    attachmentName?: string;
  }) {
    await this.botService.sendMessageWithAttachment(
      args.channelId,
      args.message,
      args.attachmentUrl,
      args.attachmentName
    );
    return {
      content: [{
        type: 'text',
        text: 'Message with attachment sent successfully',
      }],
    };
  }

  async handleAddReaction(args: {
    channelId: string;
    messageId: string;
    emoji: string;
  }) {
    await this.botService.addReaction(args.channelId, args.messageId, args.emoji);
    return {
      content: [{
        type: 'text',
        text: `Added reaction ${args.emoji}`,
      }],
    };
  }
}