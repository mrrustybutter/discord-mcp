#\!/bin/bash

# Connect to Discord
echo "Connecting to Discord..."
curl -X POST http://localhost:3001/message -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"discord_connect","arguments":{}}}'

# Wait a bit for connection to stabilize
echo -e "\n\nWaiting 5 seconds..."
sleep 5

# Join voice channel
echo -e "\n\nJoining voice channel..."
curl -X POST http://localhost:3001/message -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"discord_join_voice","arguments":{"guildId":"1260302102785949807","channelId":"1260302103301980305"}}}'

echo -e "\n\nDone\!"
