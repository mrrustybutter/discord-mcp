import { DiscordBotService } from '../../services/discord-bot.js';

export class ConnectionHandlers {
  constructor(private botService: DiscordBotService) {}

  async handleConnect() {
    if (this.botService.isConnected()) {
      return {
        content: [{
          type: 'text',
          text: 'Bot is already connected',
        }],
      };
    }

    await this.botService.connect();
    return {
      content: [{
        type: 'text',
        text: 'Bot connected successfully',
      }],
    };
  }

  async handleDisconnect() {
    if (!this.botService.isConnected()) {
      return {
        content: [{
          type: 'text',
          text: 'Bot is not connected',
        }],
      };
    }

    await this.botService.disconnect();
    return {
      content: [{
        type: 'text',
        text: 'Bot disconnected successfully',
      }],
    };
  }

  async handleStatus() {
    const status = await this.botService.getStatus();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(status, null, 2),
      }],
    };
  }
}