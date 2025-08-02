# Discord MCP Server Testing Guide

The Discord MCP server now supports both stdio (for MCP clients) and HTTP mode (for easy testing with curl).

## Starting the Server

### HTTP Mode (for testing)
```bash
npm run build          # Build TypeScript
npm run start:sse      # Start server in detached mode
npm run logs          # View server logs
npm run stop          # Stop the server
```

The HTTP server runs on port 3001 by default (configurable via `MCP_PORT` env var).

### Stdio Mode (for MCP clients)
```bash
npm run build
npm run start
```

## Testing with curl

### 1. List Available Tools
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 2. Connect to Discord
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discord_connect","arguments":{}}}'
```

### 3. List Discord Servers
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"discord_list_servers","arguments":{}}}'
```

### 4. Join Voice Channel
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"discord_join_voice","arguments":{"serverId":"YOUR_SERVER_ID","channelId":"YOUR_CHANNEL_ID"}}}'
```

### 5. Speak in Voice Channel
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"voice_speak","arguments":{"text":"Hello from Discord MCP!"}}}'
```

### 6. Leave Voice Channel
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"discord_leave_voice","arguments":{"serverId":"YOUR_SERVER_ID"}}}'
```

## Available Tools

1. **discord_connect** - Connect to Discord
2. **discord_list_servers** - List all servers
3. **discord_list_channels** - List channels in a server
4. **discord_list_voice_channels** - List voice channels in a server
5. **discord_send_message** - Send a text message
6. **discord_read_messages** - Read recent messages
7. **discord_join_voice** - Join a voice channel
8. **discord_leave_voice** - Leave voice channel
9. **voice_speak** - Speak in voice channel (TTS)
10. **discord_start_listening** - Start voice transcription
11. **discord_stop_listening** - Stop and get transcript
12. **voice_get_transcript** - Get current transcript
13. **discord_get_voice_members** - List voice channel members
14. **discord_get_status** - Get connection status
15. **discord_get_partial_transcript** - Get transcript while recording

## Environment Variables

- `DISCORD_USER_COOKIE` - Discord authentication cookie
- `DISCORD_USERNAME` - Discord username (for login)
- `DISCORD_PASSWORD` - Discord password (for login)
- `ELEVENLABS_API_KEY` - ElevenLabs API key for TTS
- `ELEVENLABS_VOICE_ID` - ElevenLabs voice ID
- `MCP_PORT` - HTTP server port (default: 3001)
- `MCP_TRANSPORT` - Set to "sse" for HTTP mode

## Troubleshooting

1. Check server logs: `npm run logs`
2. Verify server is running: `ps aux | grep "node dist/index.js"`
3. Stop and restart: `npm run stop && npm run start:sse`
4. Check saved cookies: `cat discord_cookies.json`