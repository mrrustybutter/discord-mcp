#!/bin/bash

# Simple curl test for Discord Bot MCP with SSE

echo "=== Discord Bot MCP Curl Test ==="
echo ""

# Get session ID from SSE endpoint
echo "Getting session ID..."
SESSION_ID=$(curl -s -N http://localhost:3003/sse 2>/dev/null | grep -o 'sessionId=[^"]*' | cut -d= -f2 | head -1)

if [ -z "$SESSION_ID" ]; then
    echo "Failed to get session ID"
    exit 1
fi

echo "Session ID: $SESSION_ID"
echo ""

# Helper function for API calls
call_tool() {
    local tool_name=$1
    local args=${2:-{}}
    
    echo "Calling $tool_name..."
    curl -s -X POST "http://localhost:3003/message?sessionId=$SESSION_ID" \
      -H "Content-Type: application/json" \
      -d "{
        \"jsonrpc\": \"2.0\",
        \"method\": \"tools/call\",
        \"params\": {
          \"name\": \"$tool_name\",
          \"arguments\": $args
        },
        \"id\": 1
      }"
    echo ""
}

# Test calls
call_tool "bot_status"
call_tool "list_servers"
call_tool "view_server" '{"server_name": "RustyButter"}'
call_tool "list_channels"

echo ""
echo "Check server status:"
curl -s http://localhost:3003/status | python3 -m json.tool