import { DiscordBotService } from '../../services/discord-bot.js';

export class GuildHandlers {
  constructor(private botService: DiscordBotService) {}

  async handleListGuilds() {
    const guilds = await this.botService.listGuilds();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(guilds, null, 2),
      }],
    };
  }

  async handleListChannels(args: { guildId: string }) {
    const channels = await this.botService.listChannels(args.guildId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(channels, null, 2),
      }],
    };
  }
}