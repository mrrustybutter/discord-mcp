# Discord Voice Demo Bot 🎤

An interactive demo bot for testing the Discord voice transcription system!

## Features

- ✅ Interactive menu system
- 🎙️ Join/leave voice channels
- 🗣️ Text-to-speech testing
- 📝 Real-time transcription
- 🔧 Toggle transcription on/off

## Quick Start

1. **Set your Discord server and channel IDs:**
   ```bash
   export DISCORD_SERVER_ID=your_server_id_here
   export DISCORD_CHANNEL_ID=your_voice_channel_id_here
   ```

2. **Run the demo bot:**
   ```bash
   node demo-voice-bot.js
   ```

3. **Use the interactive menu:**
   - Press `1` to join voice channel
   - Press `3` to test TTS
   - Press `4` to see transcriptions
   - Speak in Discord to test STT!

## How to Get Server/Channel IDs

1. **Enable Developer Mode in Discord:**
   - Settings → Advanced → Developer Mode (toggle ON)

2. **Get Server ID:**
   - Right-click your server name → Copy Server ID

3. **Get Voice Channel ID:**
   - Right-click the voice channel → Copy Channel ID

## Testing the Voice System

1. **Join the voice channel** (option 1)
2. **Say something with TTS** (option 3) to verify audio output
3. **Speak in Discord** - your voice should be transcribed!
4. **Check transcriptions** (option 4) to see the results

## What's Fixed

✅ **xsalsa20_poly1305_lite decryption** - Nonce construction now correct!
✅ **User ID mapping** - SSRC to Discord user ID properly tracked
✅ **Audio buffering** - 2-second buffer for reliable transcription
✅ **ElevenLabs STT** - API integration with correct parameters

## Troubleshooting

- **No transcriptions?** Make sure transcription is enabled (option 5)
- **Can't join channel?** Verify your server/channel IDs are correct
- **No audio?** Check that FFmpeg is installed: `ffmpeg -version`

## Example Session

```
$ export DISCORD_SERVER_ID=123456789
$ export DISCORD_CHANNEL_ID=987654321
$ node demo-voice-bot.js

🚀 Starting Discord MCP server...

╔═══════════════════════════════════════════╗
║     🎤 Discord Voice Demo Bot 🎤          ║
║                                           ║
║  Testing the fixed voice transcription!   ║
╚═══════════════════════════════════════════╝

Select option (1-6): 1
→ discord_join_voice: { serverId: '123456789', channelId: '987654321' }
✓ Success: { "success": true }

Select option (1-6): 3
Enter text to speak: Hello Discord! The voice system is working!
→ voice_speak: { text: 'Hello Discord! The voice system is working!' }
✓ Success: { "success": true }

[Someone speaks in Discord]

Select option (1-6): 4
→ voice_get_transcript: { limit: 10 }
✓ Success: {
  "transcriptions": [
    {
      "userId": "123456789",
      "username": "TestUser",
      "text": "Hey, I can hear you!",
      "timestamp": 1754170000000
    }
  ]
}
```

## Next Steps

- Try speaking multiple times to test buffering
- Test with multiple users in the channel
- Check the `transcripts/` folder for saved transcriptions
- Monitor `logs/discord-mcp.log` for detailed debugging

Happy testing! 🚀