#!/usr/bin/env node

/**
 * Quick test script to verify Discord voice is working
 */

import { spawn } from 'child_process';

console.log('🎤 Quick Voice Test Script');

// Server details
const serverId = '1234146034394304574';
const channelId = '1234146034394304577';

console.log(`Server: ${serverId}`);
console.log(`Channel: ${channelId}`);

// Start MCP server
console.log('\n1. Starting Discord MCP server...');
const mcp = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});

// Handle server output
mcp.stdout.on('data', (data) => {
  console.log('MCP:', data.toString().trim());
});

mcp.stderr.on('data', (data) => {
  console.error('MCP Error:', data.toString().trim());
});

// Wait for server to start
setTimeout(() => {
  console.log('\n2. Server should be ready. Connecting to Discord...');
  
  // First connect to Discord
  const connectCommand = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'discord_connect',
      arguments: {}
    }
  };
  
  mcp.stdin.write(JSON.stringify(connectCommand) + '\n');
  
  // Wait for connection
  setTimeout(() => {
    console.log('\n3. Connected! Now joining voice channel...');
    
    // Join voice channel
    const joinCommand = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'discord_join_voice',
        arguments: {
          serverId,
          channelId
        }
      }
    };
    
    mcp.stdin.write(JSON.stringify(joinCommand) + '\n');
    
    // Wait for join
    setTimeout(() => {
      console.log('\n4. Attempting to speak...');
      
      const speakCommand = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'voice_speak',
          arguments: {
            text: 'Testing, testing, one two three! CodingButter, can you hear this?'
          }
        }
      };
      
      mcp.stdin.write(JSON.stringify(speakCommand) + '\n');
      
      // Keep running for a bit
      setTimeout(() => {
        console.log('\n5. Test complete. Check Discord voice channel!');
        console.log('Staying connected to monitor for transcriptions...');
        // Don't kill the process - let it run to capture audio
      }, 5000);
    }, 5000);
  }, 5000);
}, 3000);