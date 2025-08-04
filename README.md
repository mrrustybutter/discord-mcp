# Discord Bot MCP

A Model Context Protocol (MCP) server that provides Discord bot functionality with voice transcription (using Google Gemini) and text-to-speech (using ElevenLabs).

## Features

- 🤖 Full Discord bot functionality through MCP
- 🎤 Voice channel transcription using Google Gemini
- 🔊 Text-to-speech in voice channels using ElevenLabs
- 💬 Text channel messaging
- 📝 Transcript logging
- 🔄 Real-time voice activity detection

## Prerequisites

1. **Discord Bot**
   - Create a bot on [Discord Developer Portal](https://discord.com/developers/applications)
   - Enable the following intents:
     - GUILD_MESSAGES
     - MESSAGE_CONTENT 
     - GUILD_VOICE_STATES
   - Get your bot token and client ID

2. **Google Gemini API**
   - Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

3. **ElevenLabs API**
   - Get an API key from [ElevenLabs](https://elevenlabs.io/)
   - Note your preferred voice ID

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your credentials:
   ```env
   # Discord Bot Configuration
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   DISCORD_CLIENT_ID=your_discord_client_id_here

   # Google Gemini API Configuration
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-1.5-flash-002

   # ElevenLabs Configuration  
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   ELEVENLABS_VOICE_ID=Au8OOcCmvsCaQpmULvvQ
   ```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### SSE Mode (for HTTP transport)
```bash
npm run dev:sse    # Development
npm run start:sse  # Production
```

## MCP Tools

### Bot Management
- `bot_connect` - Connect the Discord bot
- `bot_disconnect` - Disconnect the Discord bot
- `bot_status` - Get bot status and connection info

### Voice Channel
- `join_voice_channel` - Join a voice channel
- `leave_voice_channel` - Leave the current voice channel
- `speak_in_voice` - Use TTS to speak in voice channel
- `start_transcription` - Start transcribing voice
- `stop_transcription` - Stop transcribing voice

### Text Channel
- `send_message` - Send a message to a text channel

### Guild Management
- `list_guilds` - List all guilds the bot is in
- `list_channels` - List all channels in a guild

## Voice Transcription

The bot uses:
- **Voice Activity Detection (VAD)** to detect when users are speaking
- **Google Gemini** for accurate speech-to-text transcription
- **Automatic silence detection** to segment speech

Transcripts are saved to the `./transcripts` directory in JSON format.

## Text-to-Speech

The bot can speak in voice channels using:
- **ElevenLabs API** for natural-sounding speech
- **Configurable voice selection**
- **Streaming audio playback**

## Architecture

```
discord-bot-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── config.ts         # Configuration management
│   ├── services/
│   │   ├── discord-bot.ts    # Discord bot service
│   │   ├── transcription.ts  # Voice transcription service
│   │   └── elevenlabs.ts     # TTS service
│   └── utils/
│       ├── logger.ts          # Logging utility
│       └── transcript-logger.ts # Transcript file management
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Discord bot token | Required |
| `DISCORD_CLIENT_ID` | Discord application client ID | Required |
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | Required |
| `ELEVENLABS_VOICE_ID` | Voice ID for TTS | `Au8OOcCmvsCaQpmULvvQ` |
| `GEMINI_MODEL` | Gemini model to use | `gemini-1.5-flash-002` |
| `LOG_LEVEL` | Logging level | `info` |
| `ENABLE_TRANSCRIPT_LOGGING` | Save transcripts to files | `true` |
| `TRANSCRIPT_DIR` | Directory for transcripts | `./transcripts` |

## License

MIT