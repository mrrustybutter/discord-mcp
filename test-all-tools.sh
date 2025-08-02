#!/bin/bash

# Discord MCP Tools Test Script
# This script tests all Discord MCP tools via curl commands

BASE_URL="http://localhost:3001/message"
HEADERS="-H \"Content-Type: application/json\""

echo "🎯 Discord MCP Tools Test Suite"
echo "==============================="

# Helper function to send requests
send_request() {
    local id=$1
    local method=$2
    local params=$3
    echo -e "\n📡 Request $id: $method"
    echo "Parameters: $params"
    
    local data="{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}"
    echo "Request: $data"
    
    response=$(curl -s -X POST $BASE_URL -H "Content-Type: application/json" -d "$data")
    echo "Response: $response" | jq '.' 2>/dev/null || echo "$response"
    
    sleep 1
}

echo -e "\n1️⃣ Testing tools/list..."
send_request 1 "tools/list" "{}"

echo -e "\n2️⃣ Testing discord_connect..."
send_request 2 "tools/call" '{"name":"discord_connect","arguments":{}}'

echo -e "\n3️⃣ Testing discord_get_status..."
send_request 3 "tools/call" '{"name":"discord_get_status","arguments":{}}'

echo -e "\n4️⃣ Testing discord_list_servers..."
send_request 4 "tools/call" '{"name":"discord_list_servers","arguments":{}}'

# Extract server ID from response (assuming we have jq)
SERVER_ID="1400962207902204004"

echo -e "\n5️⃣ Testing discord_list_channels..."
send_request 5 "tools/call" "{\"name\":\"discord_list_channels\",\"arguments\":{\"serverId\":\"$SERVER_ID\"}}"

echo -e "\n6️⃣ Testing discord_list_voice_channels..."
send_request 6 "tools/call" "{\"name\":\"discord_list_voice_channels\",\"arguments\":{\"serverId\":\"$SERVER_ID\"}}"

# Known channel IDs
TEXT_CHANNEL_ID="1400962207902204006"
VOICE_CHANNEL_ID="1400962207902204009"

echo -e "\n7️⃣ Testing discord_send_message..."
send_request 7 "tools/call" "{\"name\":\"discord_send_message\",\"arguments\":{\"channelId\":\"$TEXT_CHANNEL_ID\",\"message\":\"Hello from Discord MCP test script! 🤖\"}}"

echo -e "\n8️⃣ Testing discord_read_messages..."
send_request 8 "tools/call" "{\"name\":\"discord_read_messages\",\"arguments\":{\"channelId\":\"$TEXT_CHANNEL_ID\",\"limit\":5}}"

echo -e "\n9️⃣ Testing discord_join_voice..."
send_request 9 "tools/call" "{\"name\":\"discord_join_voice\",\"arguments\":{\"serverId\":\"$SERVER_ID\",\"channelId\":\"$VOICE_CHANNEL_ID\"}}"

echo -e "\n🔟 Testing discord_get_voice_members..."
send_request 10 "tools/call" "{\"name\":\"discord_get_voice_members\",\"arguments\":{\"serverId\":\"$SERVER_ID\",\"channelId\":\"$VOICE_CHANNEL_ID\"}}"

echo -e "\n1️⃣1️⃣ Testing voice_speak..."
send_request 11 "tools/call" '{"name":"voice_speak","arguments":{"text":"Testing Discord MCP voice transmission!"}}'

echo -e "\n1️⃣2️⃣ Testing voice_get_transcript..."
send_request 12 "tools/call" '{"name":"voice_get_transcript","arguments":{}}'

echo -e "\n1️⃣3️⃣ Testing discord_leave_voice..."
send_request 13 "tools/call" "{\"name\":\"discord_leave_voice\",\"arguments\":{\"serverId\":\"$SERVER_ID\"}}"

echo -e "\n✅ Test suite completed!"
echo "Check discord-mcp.log for detailed server logs"