# Discord Bot Setup Guide

## Bot Credentials
- **Bot Name**: RustyButter
- **Client ID**: 1401733716614840320
- **Bot Token**: (stored in .env)

## Required Permissions

### Core Permissions (Required)
- View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History
- Use External Emojis
- Add Reactions
- Connect (voice)
- Speak
- Video
- Use Voice Activity
- Use Slash Commands

### Elevated Permissions (Optional)
These permissions enable admin features if granted by server owner:
- Manage Messages
- Manage Channels
- Manage Roles
- Kick Members
- Ban Members

## Bot Invite Process

1. **Generate Invite URL**
   - Go to: https://discord.com/developers/applications/1401733716614840320/oauth2/url-generator
   - Select "bot" scope
   - Select all required permissions listed above
   - Copy the generated URL

2. **Add Bot to Server**
   - Visit the invite URL in a browser where you're logged into Discord
   - Select the server to add the bot to
   - Review and confirm permissions
   - Complete any verification (captcha, etc.)

3. **Verify Bot Setup**
   - Bot should appear in the server member list
   - Check that bot has all necessary permissions in server settings
   - Bot status will show as offline until MCP server is connected

## Bot Features

### Text Commands
- Send messages in any text channel the bot can access
- Read message history
- Add reactions and use emojis

### Voice Features
- Join voice channels
- Transcribe voice chat using Google Gemini
- Speak using ElevenLabs text-to-speech
- Support for video chat (when implemented)

### Admin Features (if permissions granted)
- Delete messages
- Create/manage channels
- Manage roles
- Kick/ban members

## Testing the Bot

1. Start the MCP server: `./start-server.sh sse`
2. Connect the bot: Use the `bot_connect` tool
3. Join a voice channel: Use the `bot_join_voice` tool
4. Start transcription: Use the `bot_start_transcription` tool

See test-sse.sh for examples of testing via curl commands.