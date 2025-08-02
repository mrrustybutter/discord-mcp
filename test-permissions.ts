#!/usr/bin/env tsx
/**
 * Test Discord permissions using only the @me endpoint to avoid rate limits
 */

import { spawn } from 'child_process';
import { loggers } from './src/logger.js';

const logger = loggers.main;

async function testDiscordPermissions() {
  logger.info('Testing Discord permissions with minimal API calls...');
  
  // First, connect to Discord
  const connectCommand = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "discord_connect",
      arguments: {}
    }
  };
  
  logger.info('Connecting to Discord...');
  const connectResponse = await callMCPTool(connectCommand);
  logger.info('Connect response:', connectResponse);
  
  // Only get basic status (uses @me endpoint which rarely rate limits)
  const statusCommand = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "discord_get_status",
      arguments: {}
    }
  };
  
  logger.info('Getting Discord status (this should not rate limit)...');
  const statusResponse = await callMCPTool(statusCommand);
  logger.info('Status response:', statusResponse);
  
  // Test a simple text message to see if bot can send messages
  const sendMessageCommand = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "discord_send_message",
      arguments: {
        channelId: "1242595351816945673", // Rusty butter general channel
        message: "🤖 Testing Discord permissions from Discord MCP - voice debugging"
      }
    }
  };
  
  logger.info('Testing message sending permissions...');
  const messageResponse = await callMCPTool(sendMessageCommand);
  logger.info('Message response:', messageResponse);
}

async function callMCPTool(command: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', [
      '-X', 'POST',
      'http://localhost:3001/message',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(command)
    ]);
    
    let responseData = '';
    
    curl.stdout.on('data', (data) => {
      responseData += data.toString();
    });
    
    curl.stderr.on('data', (data) => {
      logger.error('Curl error:', data.toString());
    });
    
    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Curl exited with code ${code}`));
        return;
      }
      
      try {
        const response = JSON.parse(responseData);
        resolve(response);
      } catch (error) {
        logger.error('Failed to parse response:', responseData);
        reject(error);
      }
    });
  });
}

// Run the test
testDiscordPermissions()
  .then(() => {
    logger.info('Permission test completed!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Permission test failed:', error);
    process.exit(1);
  });