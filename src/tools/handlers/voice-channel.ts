import { DiscordBotService } from '../../services/discord-bot.js';
import { StateManager } from '../../services/state-manager.js';

export class VoiceChannelHandlers {
  constructor(
    private botService: DiscordBotService,
    private stateManager: StateManager
  ) {}

  async handleJoinVoiceChannel(args: { channel_name: string }) {
    const currentServer = this.stateManager.getCurrentServer();
    if (!currentServer) {
      throw new Error('No server selected. Use view_server first.');
    }

    const channels = await this.botService.listChannels(currentServer.id);
    const channel = channels.find(c => 
      c.type === 'GuildVoice' && 
      c.name.toLowerCase() === args.channel_name.toLowerCase()
    );

    if (!channel) {
      throw new Error(`Voice channel "${args.channel_name}" not found in server "${currentServer.name}"`);
    }

    // Leave current voice channel if in one
    if (this.stateManager.isInVoiceChannel()) {
      const current = this.stateManager.getCurrentVoiceChannel()!;
      await this.botService.leaveVoiceChannel(current.guildId);
    }

    // Join new voice channel
    await this.botService.joinVoiceChannel(currentServer.id, channel.id);
    
    // Update state
    this.stateManager.setCurrentVoiceChannel(channel.id, channel.name, currentServer.id);

    // Start transcription automatically
    await this.botService.startTranscription(currentServer.id);

    return {
      content: [{
        type: 'text',
        text: `Joined voice channel: ${channel.name} (transcription started)`,
      }],
    };
  }

  async handleLeaveVoiceChannel() {
    const currentVoice = this.stateManager.getCurrentVoiceChannel();
    if (!currentVoice) {
      throw new Error('Not in any voice channel');
    }

    await this.botService.leaveVoiceChannel(currentVoice.guildId);
    this.stateManager.clearVoiceChannel();

    return {
      content: [{
        type: 'text',
        text: `Left voice channel: ${currentVoice.name}`,
      }],
    };
  }

  async handleSpeak(args: { text: string; voice_id?: string }) {
    const currentVoice = this.stateManager.getCurrentVoiceChannel();
    if (!currentVoice) {
      throw new Error('Not in any voice channel. Use join_voice_channel first.');
    }

    await this.botService.speakInVoice(
      currentVoice.guildId,
      args.text,
      args.voice_id
    );

    return {
      content: [{
        type: 'text',
        text: `Speaking in voice channel: ${currentVoice.name}`,
      }],
    };
  }

  async handleReadVoiceTranscript(args: { since?: string }) {
    const currentVoice = this.stateManager.getCurrentVoiceChannel();
    if (!currentVoice) {
      throw new Error('Not in any voice channel. Use join_voice_channel first.');
    }

    if (!this.stateManager.isTranscribing()) {
      throw new Error('Not currently transcribing');
    }

    // Get transcript from the bot service
    const transcript = await this.botService.getTranscript(currentVoice.guildId, args.since);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          channel: currentVoice.name,
          transcribing: true,
          transcript: transcript,
        }, null, 2),
      }],
    };
  }

  async handleListVoiceMembers() {
    const currentVoice = this.stateManager.getCurrentVoiceChannel();
    if (!currentVoice) {
      throw new Error('Not in any voice channel. Use join_voice_channel first.');
    }

    const members = await this.botService.getVoiceChannelMembers(currentVoice.id);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          channel: currentVoice.name,
          memberCount: members.length,
          members: members.map(m => ({
            username: m.username,
            displayName: m.displayName,
            isBot: m.bot,
          })),
        }, null, 2),
      }],
    };
  }

  async handleClearVoiceTranscript() {
    const currentVoice = this.stateManager.getCurrentVoiceChannel();
    if (!currentVoice) {
      throw new Error('Not in any voice channel. Use join_voice_channel first.');
    }

    await this.botService.clearTranscript(currentVoice.guildId);

    return {
      content: [{
        type: 'text',
        text: 'Voice transcript cleared successfully',
      }],
    };
  }
}