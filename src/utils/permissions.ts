import { PermissionsBitField, type Guild, type GuildMember } from 'discord.js';
import { logger } from './logger.js';

export class PermissionChecker {
  /**
   * Check if the bot has a specific permission in a guild
   */
  static botHasPermission(guild: Guild, permission: keyof typeof PermissionsBitField.Flags): boolean {
    const botMember = guild.members.me;
    if (!botMember) return false;
    
    return botMember.permissions.has(permission);
  }

  /**
   * Check if the bot has multiple permissions
   */
  static botHasPermissions(guild: Guild, permissions: (keyof typeof PermissionsBitField.Flags)[]): boolean {
    const botMember = guild.members.me;
    if (!botMember) return false;
    
    return permissions.every(perm => botMember.permissions.has(perm));
  }

  /**
   * Get all permissions the bot has in a guild
   */
  static getBotPermissions(guild: Guild): string[] {
    const botMember = guild.members.me;
    if (!botMember) return [];
    
    return botMember.permissions.toArray();
  }

  /**
   * Log bot permissions for debugging
   */
  static logBotPermissions(guild: Guild): void {
    const permissions = this.getBotPermissions(guild);
    logger.info(`Bot permissions in ${guild.name}:`, permissions);
    
    // Check for elevated permissions
    const elevatedPerms = {
      Administrator: this.botHasPermission(guild, 'Administrator'),
      ManageGuild: this.botHasPermission(guild, 'ManageGuild'),
      ManageChannels: this.botHasPermission(guild, 'ManageChannels'),
      ManageRoles: this.botHasPermission(guild, 'ManageRoles'),
      ManageMessages: this.botHasPermission(guild, 'ManageMessages'),
      KickMembers: this.botHasPermission(guild, 'KickMembers'),
      BanMembers: this.botHasPermission(guild, 'BanMembers'),
    };
    
    logger.info('Elevated permissions:', elevatedPerms);
  }

  /**
   * Execute function only if bot has required permissions
   */
  static async executeWithPermission<T>(
    guild: Guild,
    permission: keyof typeof PermissionsBitField.Flags,
    fn: () => Promise<T>,
    fallbackMessage?: string
  ): Promise<T | null> {
    if (this.botHasPermission(guild, permission)) {
      return await fn();
    } else {
      logger.warn(`Missing permission: ${permission} in guild ${guild.name}`);
      if (fallbackMessage) {
        logger.info(fallbackMessage);
      }
      return null;
    }
  }
}

// Core permissions required for basic functionality
export const CORE_PERMISSIONS = [
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'UseExternalEmojis',
  'AddReactions',
  'Connect',
  'Speak',
  'Stream', // for video
  'UseVAD',
  'UseApplicationCommands'
] as const;

// Optional elevated permissions
export const ELEVATED_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageChannels',
  'ManageRoles',
  'ManageMessages',
  'KickMembers',
  'BanMembers',
  'ManageWebhooks',
  'ManageEmojisAndStickers',
  'ManageEvents',
  'ModerateMembers'
] as const;