import type { Guild, TextChannel, GuildMember } from 'discord.js';
import { PermissionChecker } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

export class AdminFeatures {
  /**
   * Delete messages (requires ManageMessages permission)
   */
  static async deleteMessages(channel: TextChannel, count: number): Promise<number | null> {
    return await PermissionChecker.executeWithPermission(
      channel.guild,
      'ManageMessages',
      async () => {
        const messages = await channel.bulkDelete(count, true);
        logger.info(`Deleted ${messages.size} messages in ${channel.name}`);
        return messages.size;
      },
      'Cannot delete messages - missing ManageMessages permission'
    );
  }

  /**
   * Create a new channel (requires ManageChannels permission)
   */
  static async createChannel(guild: Guild, name: string, type: 'text' | 'voice'): Promise<any> {
    return await PermissionChecker.executeWithPermission(
      guild,
      'ManageChannels',
      async () => {
        const channel = await guild.channels.create({
          name,
          type: type === 'text' ? 0 : 2, // 0 = text, 2 = voice
        });
        logger.info(`Created ${type} channel: ${name}`);
        return channel;
      },
      'Cannot create channel - missing ManageChannels permission'
    );
  }

  /**
   * Kick a member (requires KickMembers permission)
   */
  static async kickMember(member: GuildMember, reason?: string): Promise<boolean> {
    const result = await PermissionChecker.executeWithPermission(
      member.guild,
      'KickMembers',
      async () => {
        await member.kick(reason);
        logger.info(`Kicked member: ${member.user.tag}`);
        return true;
      },
      'Cannot kick member - missing KickMembers permission'
    );
    return result ?? false;
  }

  /**
   * Ban a member (requires BanMembers permission)
   */
  static async banMember(member: GuildMember, reason?: string): Promise<boolean> {
    const result = await PermissionChecker.executeWithPermission(
      member.guild,
      'BanMembers',
      async () => {
        await member.ban({ reason });
        logger.info(`Banned member: ${member.user.tag}`);
        return true;
      },
      'Cannot ban member - missing BanMembers permission'
    );
    return result ?? false;
  }

  /**
   * Pin a message (requires ManageMessages permission)
   */
  static async pinMessage(channel: TextChannel, messageId: string): Promise<boolean> {
    const result = await PermissionChecker.executeWithPermission(
      channel.guild,
      'ManageMessages',
      async () => {
        const message = await channel.messages.fetch(messageId);
        await message.pin();
        logger.info(`Pinned message in ${channel.name}`);
        return true;
      },
      'Cannot pin message - missing ManageMessages permission'
    );
    return result ?? false;
  }

  /**
   * Create a role (requires ManageRoles permission)
   */
  static async createRole(guild: Guild, name: string, color?: string): Promise<any> {
    return await PermissionChecker.executeWithPermission(
      guild,
      'ManageRoles',
      async () => {
        const role = await guild.roles.create({
          name,
          color: color as any,
        });
        logger.info(`Created role: ${name}`);
        return role;
      },
      'Cannot create role - missing ManageRoles permission'
    );
  }

  /**
   * Check what admin features are available
   */
  static getAvailableFeatures(guild: Guild): Record<string, boolean> {
    return {
      deleteMessages: PermissionChecker.botHasPermission(guild, 'ManageMessages'),
      createChannels: PermissionChecker.botHasPermission(guild, 'ManageChannels'),
      kickMembers: PermissionChecker.botHasPermission(guild, 'KickMembers'),
      banMembers: PermissionChecker.botHasPermission(guild, 'BanMembers'),
      manageRoles: PermissionChecker.botHasPermission(guild, 'ManageRoles'),
      administrator: PermissionChecker.botHasPermission(guild, 'Administrator'),
    };
  }
}