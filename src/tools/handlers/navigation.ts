import { DiscordBotService } from '../../services/discord-bot.js';
import { StateManager } from '../../services/state-manager.js';

export class NavigationHandlers {
  constructor(
    private botService: DiscordBotService,
    private stateManager: StateManager
  ) {}

  async handleListServers() {
    const guilds = await this.botService.listGuilds();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          servers: guilds.map(g => ({
            name: g.name,
            memberCount: g.memberCount,
            icon: g.icon,
          })),
          currentServer: this.stateManager.getCurrentServer()?.name || null,
        }, null, 2),
      }],
    };
  }

  async handleViewServer(args: { server_name: string }) {
    const guilds = await this.botService.listGuilds();
    const guild = guilds.find(g => 
      g.name.toLowerCase() === args.server_name.toLowerCase()
    );

    if (!guild) {
      throw new Error(`Server "${args.server_name}" not found`);
    }

    this.stateManager.setCurrentServer(guild.id, guild.name);

    return {
      content: [{
        type: 'text',
        text: `Now viewing server: ${guild.name}`,
      }],
    };
  }

  async handleListChannels() {
    const currentServer = this.stateManager.getCurrentServer();
    if (!currentServer) {
      throw new Error('No server selected. Use view_server first.');
    }

    const channels = await this.botService.listChannels(currentServer.id);
    
    // Group channels by type
    const textChannels = channels.filter(c => c.type === 'GuildText');
    const voiceChannels = channels.filter(c => c.type === 'GuildVoice');
    const categories = channels.filter(c => c.type === 'GuildCategory');
    const other = channels.filter(c => 
      !['GuildText', 'GuildVoice', 'GuildCategory'].includes(c.type)
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          server: currentServer.name,
          textChannels: textChannels.map(c => ({
            name: c.name,
            parentCategory: categories.find(cat => cat.id === c.parentId)?.name,
          })),
          voiceChannels: voiceChannels.map(c => ({
            name: c.name,
            parentCategory: categories.find(cat => cat.id === c.parentId)?.name,
          })),
          currentTextChannel: this.stateManager.getCurrentTextChannel()?.name || null,
          currentVoiceChannel: this.stateManager.getCurrentVoiceChannel()?.name || null,
        }, null, 2),
      }],
    };
  }
}