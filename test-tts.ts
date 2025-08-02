#!/usr/bin/env tsx
/**
 * Test script for Discord voice TTS functionality
 * This tests our ability to make the bot speak in Discord voice channels
 */

import { spawn } from 'child_process';
import { loggers } from './src/logger.js';

const logger = loggers.main;

async function testDiscordTTS() {
  logger.info('Starting Discord TTS test...');
  
  // First, let's call the discord_connect tool
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
  
  // Now let's join a voice channel
  const joinVoiceCommand = {
    jsonrpc: "2.0", 
    id: 2,
    method: "tools/call",
    params: {
      name: "discord_join_voice",
      arguments: {
        channelId: "1242595351816945674", // Rusty butter voice channel
        guildId: "1242595351028412528" // Rusty butter server ID
      }
    }
  };
  
  logger.info('Joining voice channel...');
  const joinResponse = await callMCPTool(joinVoiceCommand);
  logger.info('Join voice response:', joinResponse);
  
  // Wait a bit for connection to establish
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Now let's speak!
  const speakCommand = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "voice_speak",
      arguments: {
        text: "YO YO YO! Rusty Butter in the house! This is a test of our epic Discord voice capabilities! Can you hear me chat? Let's goooo!",
        voice: "shimmer" // Using a fun voice
      }
    }
  };
  
  logger.info('Speaking in voice channel...');
  const speakResponse = await callMCPTool(speakCommand);
  logger.info('Speak response:', speakResponse);
  
  // Wait for the speech to finish
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Leave voice channel
  const leaveCommand = {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "discord_leave_voice",
      arguments: {}
    }
  };
  
  logger.info('Leaving voice channel...');
  const leaveResponse = await callMCPTool(leaveCommand);
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
testDiscordTTS()
  .then(() => {
    logger.info('TTS test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('TTS test failed:', error);
    process.exit(1);
  });