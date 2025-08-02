#!/usr/bin/env node

/**
 * Discord Voice Transcription Test Script
 * 
 * This script demonstrates the complete voice transcription pipeline:
 * 1. Connects to Discord
 * 2. Joins a voice channel
 * 3. Plays test audio
 * 4. Waits for transcriptions
 * 5. Displays results
 */

import { spawn } from 'child_process';
import WebSocket from 'ws';

const MCP_COMMANDS = {
  joinVoice: {
    method: 'tools/call',
    params: {
      name: 'discord_join_voice',
      arguments: {
        serverId: 'YOUR_SERVER_ID', // Replace with your server ID
        channelId: 'YOUR_CHANNEL_ID' // Replace with your voice channel ID
      }
    }
  },
  
  speak: {
    method: 'tools/call',
    params: {
      name: 'voice_speak',
      arguments: {
        text: 'Hello! This is a test of the Discord voice transcription system. Can you hear me clearly?'
      }
    }
  },
  
  getTranscript: {
    method: 'tools/call',
    params: {
      name: 'voice_get_transcript',
      arguments: {
        limit: 10
      }
    }
  },
  
  leaveVoice: {
    method: 'tools/call',
    params: {
      name: 'discord_leave_voice',
      arguments: {}
    }
  }
};

async function runTest() {
  console.log('🚀 Starting Discord Voice Transcription Test...\n');
  
  // Start the Discord MCP server
  console.log('Starting Discord MCP server...');
  const mcpProcess = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      LOG_LEVEL: 'info'
    }
  });
  
  // Give it time to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Connect via WebSocket for real-time updates
  const ws = new WebSocket('ws://localhost:3030/transcriptions');
  
  ws.on('open', () => {
    console.log('✅ Connected to transcription WebSocket\n');
  });
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('📝 Transcription:', msg);
  });
  
  // Simulate MCP calls
  let requestId = 1;
  
  function sendMcpCommand(command) {
    const request = {
      jsonrpc: '2.0',
      id: requestId++,
      ...command
    };
    
    console.log('Sending:', JSON.stringify(request, null, 2));
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
  }
  
  // Join voice channel
  console.log('\n1️⃣ Joining voice channel...');
  sendMcpCommand(MCP_COMMANDS.joinVoice);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Speak test message
  console.log('\n2️⃣ Speaking test message...');
  sendMcpCommand(MCP_COMMANDS.speak);
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  // Get transcript
  console.log('\n3️⃣ Getting transcript...');
  sendMcpCommand(MCP_COMMANDS.getTranscript);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Leave voice channel
  console.log('\n4️⃣ Leaving voice channel...');
  sendMcpCommand(MCP_COMMANDS.leaveVoice);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Cleanup
  console.log('\n✅ Test complete!');
  ws.close();
  mcpProcess.kill();
  process.exit(0);
}

// Run the test
runTest().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});