#!/bin/bash

# Simple Discord Voice Test Script
# Tests the voice functionality step by step

echo "🎤 Discord Voice Test Script"
echo "=========================="
echo ""
echo "This script will test:"
echo "1. Joining a voice channel"
echo "2. Playing test audio"
echo "3. Checking transcriptions"
echo ""
echo "Make sure to update SERVER_ID and CHANNEL_ID in the script!"
echo ""

# Configuration
SERVER_ID="YOUR_SERVER_ID"
CHANNEL_ID="YOUR_VOICE_CHANNEL_ID"

# Helper function to send MCP commands
send_mcp_command() {
    local json="$1"
    echo "$json" | node -e "
        const { spawn } = require('child_process');
        const mcp = spawn('node', ['dist/index.js']);
        
        process.stdin.on('data', (data) => {
            mcp.stdin.write(data);
            mcp.stdin.end();
        });
        
        mcp.stdout.on('data', (data) => {
            console.log(data.toString());
        });
        
        setTimeout(() => process.exit(0), 2000);
    "
}

echo "Step 1: Joining voice channel..."
send_mcp_command '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "discord_join_voice",
        "arguments": {
            "serverId": "'$SERVER_ID'",
            "channelId": "'$CHANNEL_ID'"
        }
    }
}'

sleep 5

echo -e "\nStep 2: Playing test audio..."
send_mcp_command '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
        "name": "voice_speak",
        "arguments": {
            "text": "Testing testing one two three. This is Rusty Butter speaking!"
        }
    }
}'

sleep 8

echo -e "\nStep 3: Getting transcript..."
send_mcp_command '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
        "name": "voice_get_transcript",
        "arguments": {
            "limit": 5
        }
    }
}'

sleep 2

echo -e "\nStep 4: Leaving voice channel..."
send_mcp_command '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
        "name": "discord_leave_voice",
        "arguments": {}
    }
}'

echo -e "\n✅ Test complete!"