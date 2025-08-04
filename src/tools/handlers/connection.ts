import { DiscordBotService } from '../../services/discord-bot.js';
import { StateManager } from '../../services/state-manager.js';

export class ConnectionHandlers {
  constructor(
    private botService: DiscordBotService,
    private stateManager: StateManager
  ) {}

  async handleStatus() {
    const status = await this.botService.getStatus();
    const state = this.stateManager.getFullState();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bot: {
            connected: status.connected,
            user: status.user,
            guilds: status.guilds,
          },
          currentState: {
            server: state.currentServer?.name || null,
            textChannel: state.currentTextChannel?.name || null,
            voiceChannel: state.currentVoiceChannel?.name || null,
            isTranscribing: state.isTranscribing,
          },
        }, null, 2),
      }],
    };
  }
}