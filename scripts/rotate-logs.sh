#!/bin/bash
# Log rotation script for Discord MCP

LOG_DIR="$(dirname "$0")/../logs"
LOG_FILE="$LOG_DIR/discord-mcp.log"
MAX_SIZE=104857600  # 100MB
MAX_DAYS=7

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Check if log file exists and its size
if [ -f "$LOG_FILE" ]; then
    SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null)
    
    # Rotate if size exceeds max
    if [ "$SIZE" -gt "$MAX_SIZE" ]; then
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        mv "$LOG_FILE" "${LOG_FILE}.${TIMESTAMP}"
        echo "Rotated log file to ${LOG_FILE}.${TIMESTAMP}"
        
        # Signal the process to reopen log files (if using file descriptors)
        if [ -f ../discord-mcp.pid ]; then
            kill -USR2 $(cat ../discord-mcp.pid) 2>/dev/null || true
        fi
    fi
fi

# Delete old log files
find "$LOG_DIR" -name "discord-mcp.log.*" -mtime +$MAX_DAYS -delete

echo "Log rotation complete"