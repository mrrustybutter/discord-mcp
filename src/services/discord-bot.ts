import { 
  Client, 
  GatewayIntentBits, 
  type VoiceChannel,
  type TextChannel,
  ChannelType,
  type Message
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  type VoiceConnection,
} from '@discordjs/voice';
import { TranscriptionService } from './transcription.js';
import { ElevenLabsService } from './elevenlabs.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { PermissionChecker } from '../utils/permissions.js';

export class DiscordBotService {
  private client: Client | null = null;
  private voiceConnections: Map<string, VoiceConnection> = new Map();
  private transcriptionServices: Map<string, TranscriptionService> = new Map();
  private elevenLabsService: ElevenLabsService;
  private audioPlayers: Map<string, any> = new Map();

  constructor() {
    this.elevenLabsService = new ElevenLabsService();
  }

  async connect(): Promise<void> {
    if (this.client?.isReady()) {
      throw new Error('Bot is already connected');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    // Set up event handlers
    this.client.on('ready', () => {
      logger.info(`Discord bot logged in as ${this.client?.user?.tag}`);
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    // Login
    await this.client.login(config.DISCORD_BOT_TOKEN);
    
    // Wait for ready
    await new Promise<void>((resolve) => {
      this.client!.once('ready', resolve);
    });
  }

  async disconnect(): Promise<void> {
    // Stop all transcriptions
    for (const [guildId, service] of this.transcriptionServices) {
      service.stopTranscription();
      this.transcriptionServices.delete(guildId);
    }

    // Disconnect from all voice channels
    for (const [guildId, connection] of this.voiceConnections) {
      connection.destroy();
      this.voiceConnections.delete(guildId);
    }

    // Destroy Discord client
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }

  async getStatus() {
    if (!this.client?.isReady()) {
      return {
        connected: false,
        user: null,
        guilds: 0,
        voiceConnections: [],
        activeTranscriptions: [],
      };
    }

    return {
      connected: true,
      user: {
        id: this.client.user!.id,
        username: this.client.user!.username,
        discriminator: this.client.user!.discriminator,
      },
      guilds: this.client.guilds.cache.size,
      voiceConnections: Array.from(this.voiceConnections.keys()),
      activeTranscriptions: Array.from(this.transcriptionServices.keys()),
    };
  }

  async joinVoiceChannel(guildId: string, channelId: string): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Invalid voice channel');
    }

    const voiceChannel = channel as VoiceChannel;

    // Create voice connection
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Wait for connection to be ready
    await new Promise<void>((resolve, reject) => {
      connection.on(VoiceConnectionStatus.Ready, () => {
        logger.info(`Connected to voice channel ${channelId} in guild ${guildId}`);
        resolve();
      });

      connection.on('error', (error) => {
        logger.error('Voice connection error:', error);
        reject(error);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Voice connection timeout'));
      }, 10000);
    });

    // Store connection
    this.voiceConnections.set(guildId, connection);

    // Create audio player for this guild
    const player = createAudioPlayer();
    connection.subscribe(player);
    this.audioPlayers.set(guildId, player);
  }

  async leaveVoiceChannel(guildId: string): Promise<void> {
    const connection = this.voiceConnections.get(guildId);
    if (!connection) {
      throw new Error('Not connected to voice channel in this guild');
    }

    // Stop transcription if active
    const transcriptionService = this.transcriptionServices.get(guildId);
    if (transcriptionService) {
      transcriptionService.stopTranscription();
      this.transcriptionServices.delete(guildId);
    }

    // Destroy connection
    connection.destroy();
    this.voiceConnections.delete(guildId);
    this.audioPlayers.delete(guildId);
  }

  async sendMessage(channelId: string, message: string): Promise<void> {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error('Invalid text channel');
    }

    await (channel as TextChannel).send(message);
  }

  async speakInVoice(guildId: string, text: string, voiceId?: string): Promise<void> {
    const connection = this.voiceConnections.get(guildId);
    if (!connection) {
      throw new Error('Not connected to voice channel in this guild');
    }

    const player = this.audioPlayers.get(guildId);
    if (!player) {
      throw new Error('No audio player for this guild');
    }

    // Generate audio with ElevenLabs
    const audioStream = await this.elevenLabsService.generateSpeech(text, voiceId);
    
    // Create audio resource
    const resource = createAudioResource(audioStream);
    
    // Play audio
    player.play(resource);

    // Wait for playback to complete
    await new Promise<void>((resolve, reject) => {
      player.once(AudioPlayerStatus.Idle, resolve);
      player.once('error', reject);
    });
  }

  async startTranscription(guildId: string, textChannelId?: string): Promise<void> {
    const connection = this.voiceConnections.get(guildId);
    if (!connection) {
      throw new Error('Not connected to voice channel in this guild');
    }

    // Stop existing transcription if any
    const existingService = this.transcriptionServices.get(guildId);
    if (existingService) {
      existingService.stopTranscription();
    }

    // Get text channel if provided
    let textChannel: TextChannel | undefined;
    if (textChannelId && this.client) {
      const channel = await this.client.channels.fetch(textChannelId);
      if (channel && channel.type === ChannelType.GuildText) {
        textChannel = channel as TextChannel;
      }
    }

    // Create new transcription service
    const transcriptionService = new TranscriptionService(connection, textChannel);
    this.transcriptionServices.set(guildId, transcriptionService);

    // Start transcription
    transcriptionService.startTranscription();
  }

  async stopTranscription(guildId: string): Promise<void> {
    const transcriptionService = this.transcriptionServices.get(guildId);
    if (!transcriptionService) {
      throw new Error('No active transcription in this guild');
    }

    transcriptionService.stopTranscription();
    this.transcriptionServices.delete(guildId);
  }

  async listGuilds() {
    if (!this.client?.isReady()) {
      return [];
    }

    return this.client.guilds.cache.map(guild => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      icon: guild.iconURL(),
    }));
  }

  async listChannels(guildId: string) {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const guild = await this.client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error('Guild not found');
    }

    const channels = await guild.channels.fetch();
    
    return channels.map(channel => ({
      id: channel!.id,
      name: channel!.name,
      type: ChannelType[channel!.type],
      parentId: channel!.parentId,
    }));
  }

  isConnected(): boolean {
    return this.client?.isReady() || false;
  }

  async readMessages(channelId: string, limit: number = 10) {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error('Invalid text channel');
    }

    const messages = await (channel as TextChannel).messages.fetch({ limit: Math.min(limit, 100) });
    
    return messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        bot: msg.author.bot,
      },
      timestamp: msg.createdTimestamp,
      attachments: msg.attachments.map(att => ({
        url: att.url,
        name: att.name,
        contentType: att.contentType,
      })),
      reactions: msg.reactions.cache.map(reaction => ({
        emoji: reaction.emoji.toString(),
        count: reaction.count,
      })),
    }));
  }

  async sendMessageWithAttachment(
    channelId: string, 
    message?: string, 
    attachmentUrl?: string,
    attachmentName?: string
  ) {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      throw new Error('Invalid text channel');
    }

    const messageOptions: any = {};
    if (message) messageOptions.content = message;
    if (attachmentUrl) {
      messageOptions.files = [{
        attachment: attachmentUrl,
        name: attachmentName || 'attachment',
      }];
    }

    await (channel as TextChannel).send(messageOptions);
  }

  async addReaction(channelId: string, messageId: string, emoji: string) {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error('Invalid text channel');
    }

    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.react(emoji);
  }

  async getVoiceChannelMembers(channelId: string) {
    if (!this.client?.isReady()) {
      throw new Error('Bot is not connected');
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Invalid voice channel');
    }

    const voiceChannel = channel as VoiceChannel;
    return voiceChannel.members.map(member => ({
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      bot: member.user.bot,
    }));
  }
}