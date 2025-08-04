# Installing RustyButter Bot to Discord Server

## Prerequisites
- You must be logged into the Discord account that owns the server (Rusty's account)
- You must have "Manage Server" permissions on the target server

## Bot Invite URL
Click this link while logged into Discord:

```
https://discord.com/api/oauth2/authorize?client_id=1401733716614840320&permissions=1101930743808&scope=bot
```

### Alternative: Build your own URL
1. Go to: https://discord.com/developers/applications/1401733716614840320/oauth2/url-generator
2. Check "bot" under SCOPES
3. Select these permissions under BOT PERMISSIONS:
   - **General Permissions**: View Channels
   - **Text Permissions**: Send Messages, Embed Links, Attach Files, Read Message History, Use External Emojis, Add Reactions, Use Slash Commands
   - **Voice Permissions**: Connect, Speak, Video, Use Voice Activity
   - **Admin Permissions** (optional): Manage Messages, Manage Channels, Manage Roles, Kick Members, Ban Members
4. Copy the generated URL at the bottom

## Installation Steps

1. **Visit the invite URL** in a browser where you're logged into Discord as Rusty

2. **Select server** from the dropdown menu

3. **Review permissions** - Discord will show all the permissions the bot is requesting

4. **Click "Authorize"** to add the bot

5. **Complete verification** - You may need to complete a CAPTCHA

6. **Verify installation**:
   - The bot should appear in your server's member list (it will show as offline until we connect it)
   - Check Server Settings > Integrations to see the bot listed
   - The bot won't be online until we run the MCP server and connect

## After Installation

Once the bot is added to the server:

1. Start the MCP server: `./start-server.sh sse`
2. Connect the bot using the MCP tools
3. The bot should appear online in the server

## Permissions Explanation

The permissions number `1101930743808` includes:
- Basic text chat functionality
- Voice channel access and speaking
- Video streaming capability
- Optional admin features (only work if server owner grants them)

## Troubleshooting

If you get an error:
- "This interaction failed" - The invite link may have expired, generate a new one
- "Missing Permissions" - Make sure you have "Manage Server" permission
- Bot appears but can't do anything - Check the bot's role permissions in Server Settings