#!/bin/bash

# Ultra-quick Discord voice test
# Just set your IDs and run!

echo "🎤 Quick Discord Voice Test"
echo ""

# Default to CodingButter's server if IDs not set
SERVER_ID="${DISCORD_SERVER_ID:-YOUR_SERVER_ID}"
CHANNEL_ID="${DISCORD_CHANNEL_ID:-YOUR_CHANNEL_ID}"

if [ "$SERVER_ID" = "YOUR_SERVER_ID" ]; then
  echo "⚠️  Set your Discord IDs first:"
  echo "  export DISCORD_SERVER_ID=your_server_id"
  echo "  export DISCORD_CHANNEL_ID=your_voice_channel_id"
  echo ""
  echo "To get IDs: Discord Settings → Advanced → Developer Mode ON"
  echo "Then right-click server/channel → Copy ID"
  exit 1
fi

echo "📡 Connecting to Discord voice..."
echo ""

# Run the interactive demo bot
node demo-voice-bot.js