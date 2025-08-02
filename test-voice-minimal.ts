#!/usr/bin/env tsx
/**
 * Minimal test to focus on voice joining without triggering rate limits
 */

import { spawn } from 'child_process';
import { loggers } from './src/logger.js';

const logger = loggers.main;

async function testVoiceJoinMinimal() {
  logger.info('Testing minimal voice join to isolate VOICE_SERVER_UPDATE issue...');
  
  // Step 1: Connect to Discord
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
  
  // Wait a moment for connection to stabilize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 2: Join voice directly with known IDs
  const joinVoiceCommand = {
    jsonrpc: "2.0", 
    id: 2,
    method: "tools/call",
    params: {
      name: "discord_join_voice",
      arguments: {
        channelId: "1242595351816945674", // Rusty butter voice channel
        guildId: "1242595351028412528"   // Rusty butter server ID
      }
    }
  };
  
  logger.info('Joining voice channel...');
  const joinResponse = await callMCPTool(joinVoiceCommand);
  logger.info('Join response:', joinResponse);
  
  // Wait longer to see if VOICE_SERVER_UPDATE arrives
  logger.info('Waiting 10 seconds to monitor for VOICE_SERVER_UPDATE...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Step 3: Leave voice
  const leaveVoiceCommand = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "discord_leave_voice",
      arguments: {
        serverId: "1242595351028412528"
      }
    }
  };
  
  logger.info('Leaving voice channel...');
  const leaveResponse = await callMCPTool(leaveVoiceCommand);
  logger.info('Leave response:', leaveResponse);
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
testVoiceJoinMinimal()
  .then(() => {
    logger.info('Voice join test completed!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Voice join test failed:', error);
    process.exit(1);
  });