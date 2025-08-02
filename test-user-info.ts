#!/usr/bin/env tsx
/**
 * Test script to get Discord user info and permissions
 */

import { spawn } from 'child_process';
import { loggers } from './src/logger.js';

const logger = loggers.main;

async function testDiscordUserInfo() {
  logger.info('Testing Discord user info and permissions...');
  
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
  
  // Let's also check what Discord user we are
  const statusCommand = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "discord_get_status",
      arguments: {}
    }
  };
  
  logger.info('Getting Discord status...');
  const statusResponse = await callMCPTool(statusCommand);
  logger.info('Status response:', statusResponse);
  
  // Try to list servers we're in
  const listServersCommand = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "discord_list_servers",
      arguments: {}
    }
  };
  
  logger.info('Listing Discord servers...');
  const serversResponse = await callMCPTool(listServersCommand);
  logger.info('Servers response:', serversResponse);
  
  // Try to list channels in the rusty butter server
  const listChannelsCommand = {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "discord_list_channels",
      arguments: {
        serverId: "1242595351028412528" // Rusty butter server
      }
    }
  };
  
  logger.info('Listing channels in Rusty Butter server...');
  const channelsResponse = await callMCPTool(listChannelsCommand);
  logger.info('Channels response:', channelsResponse);
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
testDiscordUserInfo()
  .then(() => {
    logger.info('User info test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('User info test failed:', error);
    process.exit(1);
  });