/**
 * Tool definitions for Discord Bot MCP
 * Stateful approach - managing current server/channel internally
 */

export const connectionTools = [
  {
    name: 'bot_status',
    description: 'Get the current bot status, connection info, and current state (server/channel)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const navigationTools = [
  {
    name: 'list_servers',
    description: 'List all Discord servers the bot has access to',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'view_server',
    description: 'View a specific server and set it as the current server',
    inputSchema: {
      type: 'object',
      properties: {
        server_name: {
          type: 'string',
          description: 'Name of the server to view',
        },
      },
      required: ['server_name'],
    },
  },
  {
    name: 'list_channels',
    description: 'List all channels in the current server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const textChannelTools = [
  {
    name: 'view_text_channel',
    description: 'View a text channel and set it as the current channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel_name: {
          type: 'string',
          description: 'Name of the text channel to view',
        },
      },
      required: ['channel_name'],
    },
  },
  {
    name: 'read_messages',
    description: 'Read messages from the current text channel',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of messages to read (default: 10, max: 100)',
          default: 10,
        },
        before_message_id: {
          type: 'string',
          description: 'Read messages before this message ID (for pagination)',
        },
      },
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to the current text channel',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Message to send',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'send_message_with_file',
    description: 'Send a message with a file attachment to the current text channel',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Optional message to send with the file',
        },
        file_url: {
          type: 'string',
          description: 'URL of the file to attach',
        },
        file_name: {
          type: 'string',
          description: 'Name for the file attachment',
        },
      },
      required: ['file_url'],
    },
  },
  {
    name: 'add_reaction',
    description: 'Add a reaction emoji to a message in the current channel',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'ID of the message to react to',
        },
        emoji: {
          type: 'string',
          description: 'Emoji to react with (e.g., "👍" or ":thumbsup:")',
        },
      },
      required: ['message_id', 'emoji'],
    },
  },
];

export const voiceChannelTools = [
  {
    name: 'join_voice_channel',
    description: 'Join a voice channel and start transcribing automatically',
    inputSchema: {
      type: 'object',
      properties: {
        channel_name: {
          type: 'string',
          description: 'Name of the voice channel to join',
        },
      },
      required: ['channel_name'],
    },
  },
  {
    name: 'leave_voice_channel',
    description: 'Leave the current voice channel and stop transcribing',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'speak',
    description: 'Speak text in the current voice channel using text-to-speech',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to speak',
        },
        voice_id: {
          type: 'string',
          description: 'Optional ElevenLabs voice ID (defaults to configured voice)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'read_voice_transcript',
    description: 'Read the current voice channel transcript',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'Optional timestamp to read transcript from (ISO format)',
        },
      },
    },
  },
  {
    name: 'clear_voice_transcript',
    description: 'Clear the voice channel transcript history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_voice_members',
    description: 'List members currently in the voice channel',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Export all tools as a single array
export const allTools = [
  ...connectionTools,
  ...navigationTools,
  ...textChannelTools,
  ...voiceChannelTools,
];