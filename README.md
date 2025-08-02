# Discord MCP (Model Context Protocol) Server

A Discord integration for Rusty Butter that provides voice channel support, real-time speech-to-text transcription, and text-to-speech capabilities through the Model Context Protocol.

## Features

- 🎙️ **Voice Channel Support**: Join and leave Discord voice channels programmatically
- 🗣️ **Text-to-Speech**: Generate speech using ElevenLabs TTS and play in voice channels
- 👂 **Speech-to-Text**: Real-time transcription of voice channel audio using ElevenLabs
- 💬 **Text Chat**: Send and read messages in Discord channels
- 🔐 **Authentication**: Login with username/password or use saved cookies
- 🧵 **Multi-threaded**: Uses worker threads for audio encoding/decoding

## Architecture

The Discord MCP server uses a multi-threaded architecture for optimal performance:

- **Main Thread**: Handles Discord WebSocket connection, HTTP server, and UDP socket
- **Encoding Worker**: Encodes PCM audio to Opus for transmission
- **Decoding Worker**: Decodes received Opus audio to PCM
- **Voice Handler**: Manages WebRTC connection, audio pipeline, and transcription

## Prerequisites

- Node.js 20+ 
- FFmpeg (for audio processing)
- ElevenLabs API key (for TTS/STT)

## Installation

```bash
npm install
npm run build
```

## Configuration

Create a `.env` file:

```env
# Discord credentials (optional - can use cookie instead)
DISCORD_USERNAME=your_username
DISCORD_PASSWORD=your_password
DISCORD_USER_COOKIE=your_cookie_string

# ElevenLabs (required for TTS/STT)
ELEVENLABS_API_KEY=your_api_key
ELEVENLABS_VOICE_ID=your_voice_id
```

## Usage

Start the MCP server:

```bash
npm run start:sse
```

The server runs on `http://localhost:3001` and provides the following tools:

### Available Tools

- `discord_login` - Login with username/password
- `discord_connect` - Connect using saved credentials
- `discord_list_servers` - List all Discord servers
- `discord_list_channels` - List channels in a server
- `discord_list_voice_channels` - List voice channels
- `discord_send_message` - Send a text message
- `discord_read_messages` - Read recent messages
- `discord_join_voice` - Join a voice channel
- `discord_leave_voice` - Leave voice channel
- `voice_speak` - Speak in voice channel using TTS
- `discord_get_voice_members` - Get members in voice channel
- `discord_get_status` - Get connection status

## Development

```bash
# Run in development mode
npm run dev

# Watch logs
npm run logs

# Clean build artifacts
npm run clean
```

## Technical Details

### Voice Connection Flow

1. Join voice channel via gateway WebSocket
2. Receive voice server update with endpoint/token
3. Connect to voice WebSocket server
4. Perform IP discovery via UDP
5. Initialize encryption with secret key
6. Start sending/receiving audio packets

### Audio Pipeline

- **Outgoing**: PCM → Opus encoding → RTP packet → Encryption → UDP transmission
- **Incoming**: UDP packet → Decryption → Opus decoding → PCM → Transcription

### Worker Thread Communication

Workers use message passing for audio data:
- Main thread owns UDP socket
- Workers handle CPU-intensive encoding/decoding
- Audio buffers passed between threads

## Troubleshooting

- Check `discord-mcp.log` for errors
- Ensure FFmpeg is installed: `ffmpeg -version`
- Verify ElevenLabs API key is valid
- Check network connectivity to Discord

## License

Part of the Rusty Butter project