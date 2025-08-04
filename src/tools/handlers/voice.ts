import { DiscordBotService } from '../../services/discord-bot.js';

export class VoiceHandlers {
  constructor(private botService: DiscordBotService) {}

  async handleJoinVoice(args: { guildId: string; channelId: string }) {
    await this.botService.joinVoiceChannel(args.guildId, args.channelId);
    return {
      content: [{
        type: 'text',
        text: `Joined voice channel ${args.channelId}`,
      }],
    };
  }

  async handleLeaveVoice(args: { guildId: string }) {
    await this.botService.leaveVoiceChannel(args.guildId);
    return {
      content: [{
        type: 'text',
        text: `Left voice channel in guild ${args.guildId}`,
      }],
    };
  }

  async handleSpeak(args: { guildId: string; text: string; voiceId?: string }) {
    await this.botService.speakInVoice(args.guildId, args.text, args.voiceId);
    return {
      content: [{
        type: 'text',
        text: 'Speaking in voice channel',
      }],
    };
  }

  async handleStartTranscription(args: { guildId: string; textChannelId?: string }) {
    await this.botService.startTranscription(args.guildId, args.textChannelId);
    return {
      content: [{
        type: 'text',
        text: 'Started voice transcription',
      }],
    };
  }

  async handleStopTranscription(args: { guildId: string }) {
    await this.botService.stopTranscription(args.guildId);
    return {
      content: [{
        type: 'text',
        text: 'Stopped voice transcription',
      }],
    };
  }

  async handleGetVoiceMembers(args: { channelId: string }) {
    const members = await this.botService.getVoiceChannelMembers(args.channelId);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(members, null, 2),
      }],
    };
  }
}