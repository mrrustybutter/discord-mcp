/**
 * Tool definitions for Discord Bot MCP
 * Organized by category for better maintainability
 */

export const connectionTools = [
  {
    name: 'bot_connect',
    description: 'Connect the Discord bot',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bot_disconnect',
    description: 'Disconnect the Discord bot',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bot_status',
    description: 'Get the bot status and connection info',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const guildTools = [
  {
    name: 'list_guilds',
    description: 'List all guilds the bot is in',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_channels',
    description: 'List all channels in a guild',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID',
        },
      },
      required: ['guildId'],
    },
  },
];

export const voiceTools = [
  {
    name: 'join_voice_channel',
    description: 'Join a voice channel',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID',
        },
        channelId: {
          type: 'string',
          description: 'Voice channel ID',
        },
      },
      required: ['guildId', 'channelId'],
    },
  },
  {
    name: 'leave_voice_channel',
    description: 'Leave the current voice channel',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID',
        },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'speak_in_voice',
    description: 'Use ElevenLabs TTS to speak in voice channel',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID where bot is connected',
        },
        text: {
          type: 'string',
          description: 'Text to speak',
        },
        voiceId: {
          type: 'string',
          description: 'ElevenLabs voice ID (optional)',
        },
      },
      required: ['guildId', 'text'],
    },
  },
  {
    name: 'start_transcription',
    description: 'Start transcribing voice in the current channel',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID',
        },
        textChannelId: {
          type: 'string',
          description: 'Text channel ID for transcripts (optional)',
        },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'stop_transcription',
    description: 'Stop transcribing voice',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: {
          type: 'string',
          description: 'Guild ID',
        },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'get_voice_members',
    description: 'Get list of members in a voice channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Voice channel ID',
        },
      },
      required: ['channelId'],
    },
  },
];

export const messageTools = [
  {
    name: 'send_message',
    description: 'Send a message to a text channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Text channel ID',
        },
        message: {
          type: 'string',
          description: 'Message content',
        },
      },
      required: ['channelId', 'message'],
    },
  },
  {
    name: 'read_messages',
    description: 'Read recent messages from a text channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Text channel ID',
        },
        limit: {
          type: 'number',
          description: 'Number of messages to fetch (default: 10, max: 100)',
        },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'send_message_with_attachment',
    description: 'Send a message with an attachment (image/video URL)',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Text channel ID',
        },
        message: {
          type: 'string',
          description: 'Message content (optional)',
        },
        attachmentUrl: {
          type: 'string',
          description: 'URL of the attachment',
        },
        attachmentName: {
          type: 'string',
          description: 'Name for the attachment file',
        },
      },
      required: ['channelId', 'attachmentUrl'],
    },
  },
  {
    name: 'add_reaction',
    description: 'Add a reaction emoji to a message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Text channel ID',
        },
        messageId: {
          type: 'string',
          description: 'Message ID to react to',
        },
        emoji: {
          type: 'string',
          description: 'Emoji to react with (e.g., "👍" or custom emoji "name:id")',
        },
      },
      required: ['channelId', 'messageId', 'emoji'],
    },
  },
];

// Export all tools as a single array
export const allTools = [
  ...connectionTools,
  ...guildTools,
  ...voiceTools,
  ...messageTools,
];