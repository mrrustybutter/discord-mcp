#!/usr/bin/env node

/**
 * Discord Voice Demo Bot
 * 
 * This bot demonstrates the complete voice pipeline:
 * - Joins a voice channel
 * - Listens for voice input
 * - Transcribes speech to text
 * - Responds with TTS
 * 
 * Perfect for testing the fixed voice system!
 */

import { spawn } from 'child_process';
import readline from 'readline';

// Configuration
const SERVER_ID = process.env.DISCORD_SERVER_ID || 'YOUR_SERVER_ID';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || 'YOUR_CHANNEL_ID';

// Create readline interface for interactive commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// MCP process
let mcpProcess;
let requestId = 1;

// Start the MCP server
function startMcpServer() {
  console.log('🚀 Starting Discord MCP server...');
  mcpProcess = spawn('node', ['dist/index.js'], {
    env: {
      ...process.env,
      LOG_LEVEL: 'info'
    },
    stdio: ['pipe', 'pipe', 'inherit']
  });
  
  // Handle MCP responses
  mcpProcess.stdout.on('data', (data) => {
    try {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        const response = JSON.parse(line);
        handleMcpResponse(response);
      });
    } catch (e) {
      // Not JSON, probably log output
      console.log('MCP:', data.toString().trim());
    }
  });
  
  mcpProcess.on('close', (code) => {
    console.log(`MCP server exited with code ${code}`);
    process.exit(code);
  });
}

// Send MCP command
function sendCommand(method, params) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method: 'tools/call',
    params: {
      name: method,
      arguments: params
    }
  };
  
  console.log(`\n→ ${method}:`, params);
  mcpProcess.stdin.write(JSON.stringify(request) + '\n');
}

// Handle MCP responses
function handleMcpResponse(response) {
  if (response.result) {
    console.log('✓ Success:', JSON.stringify(response.result, null, 2));
    
    // Check for transcriptions
    if (response.result.transcriptions) {
      console.log('\n📝 TRANSCRIPTIONS:');
      response.result.transcriptions.forEach(t => {
        console.log(`  [${t.username || t.userId}]: ${t.text}`);
      });
    }
  } else if (response.error) {
    console.error('✗ Error:', response.error.message);
  }
}

// Interactive command menu
function showMenu() {
  console.log(`
╔════════════════════════════════════════╗
║     Discord Voice Demo Bot Menu        ║
╠════════════════════════════════════════╣
║ 1. Join voice channel                  ║
║ 2. Leave voice channel                 ║
║ 3. Say something (TTS)                 ║
║ 4. Get recent transcripts              ║
║ 5. Toggle transcription                ║
║ 6. Exit                                ║
╚════════════════════════════════════════╝
`);
  
  rl.question('Select option (1-6): ', (answer) => {
    handleMenuChoice(answer);
  });
}

// Handle menu choices
async function handleMenuChoice(choice) {
  switch (choice) {
    case '1':
      sendCommand('discord_join_voice', {
        serverId: SERVER_ID,
        channelId: CHANNEL_ID
      });
      setTimeout(showMenu, 2000);
      break;
      
    case '2':
      sendCommand('discord_leave_voice', {});
      setTimeout(showMenu, 2000);
      break;
      
    case '3':
      rl.question('Enter text to speak: ', (text) => {
        sendCommand('voice_speak', { text });
        setTimeout(showMenu, 2000);
      });
      break;
      
    case '4':
      sendCommand('voice_get_transcript', { limit: 10 });
      setTimeout(showMenu, 2000);
      break;
      
    case '5':
      rl.question('Enable transcription? (true/false): ', (enabled) => {
        sendCommand('voice_set_transcription', { 
          enabled: enabled === 'true' 
        });
        setTimeout(showMenu, 2000);
      });
      break;
      
    case '6':
      console.log('👋 Goodbye!');
      process.exit(0);
      break;
      
    default:
      console.log('Invalid option!');
      showMenu();
  }
}

// Main execution
console.log(`
╔═══════════════════════════════════════════╗
║     🎤 Discord Voice Demo Bot 🎤          ║
║                                           ║
║  Testing the fixed voice transcription!   ║
╚═══════════════════════════════════════════╝
`);

// Check environment variables
if (SERVER_ID === 'YOUR_SERVER_ID') {
  console.warn(`
⚠️  Please set environment variables:
   export DISCORD_SERVER_ID=your_server_id
   export DISCORD_CHANNEL_ID=your_channel_id
`);
}

// Start the MCP server and show menu
startMcpServer();
setTimeout(showMenu, 3000);