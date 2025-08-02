import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { WebRTCVoiceHandler } from './webrtcVoiceHandler.js';
import { ThreadedWebRTCVoiceHandler } from './threadedWebrtcVoiceHandler.js';
import { SimpleVoiceHandler } from './simpleVoiceHandler.js';
import { DiscordLogin } from './discordLogin.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

interface SuperProperties {
  os: string;
  browser: string;
  browser_user_agent: string;
  browser_version: string;
  os_version: string;
  referrer: string;
  referring_domain: string;
  referrer_current: string;
  referring_domain_current: string;
  release_channel: string;
  client_build_number: number;
  client_event_source: null;
}

interface VoiceState {
  guild_id: string;
  channel_id: string | null;
  user_id: string;
  session_id: string;
  deaf: boolean;
  mute: boolean;
  self_deaf: boolean;
  self_mute: boolean;
  suppress: boolean;
}

export class UserDiscordClient extends EventEmitter {
  private ws?: WebSocket;
  private heartbeatInterval?: NodeJS.Timeout;
  private sequence: number | null = null;
  private sessionId?: string;
  private token?: string;
  private superProperties: SuperProperties;
  private cookie: string;
  private voiceStates = new Map<string, VoiceState>();
  private voiceWebsocket?: WebSocket;
  private webrtcHandler?: ThreadedWebRTCVoiceHandler;
  private user?: any;

  constructor(cookie?: string) {
    super();
    this.cookie = cookie || '';
    
    // Set up super properties to mimic a browser
    this.superProperties = {
      os: "Windows",
      browser: "Chrome",
      browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      browser_version: "120.0.0.0",
      os_version: "10",
      referrer: "https://discord.com/",
      referring_domain: "discord.com",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: 270539, // This changes frequently
      client_event_source: null
    };
  }

  private getHeaders(includeAuth: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': this.cookie,
      'Origin': 'https://discord.com',
      'Referer': 'https://discord.com/channels/@me',
      'User-Agent': this.superProperties.browser_user_agent,
      'X-Super-Properties': Buffer.from(JSON.stringify(this.superProperties)).toString('base64'),
      'X-Discord-Locale': 'en-US',
      'X-Discord-Timezone': 'America/New_York'
    };
    
    // Add authorization header if we have a token
    if (includeAuth && this.token) {
      headers['Authorization'] = this.token;
    }
    
    return headers;
  }

  async connect(cookie?: string): Promise<void> {
    if (cookie) {
      this.cookie = cookie;
    }
    
    // Try environment variable first
    if (!this.cookie && process.env.DISCORD_USER_COOKIE) {
      console.error('[Discord] Using cookie from environment variable');
      this.cookie = process.env.DISCORD_USER_COOKIE;
    }
    
    // Try to load saved cookies if still no cookie
    if (!this.cookie) {
      try {
        const cookieFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'discord_cookies.json');
        console.error('[Discord] Looking for cookies at:', cookieFile);
        const savedData = await fs.readFile(cookieFile, 'utf-8');
        const parsed = JSON.parse(savedData);
        console.error('[Discord] Parsed cookies - has cookieString:', !!parsed.cookieString, 'has token:', !!parsed.token);
        if (parsed.cookieString) {
          this.cookie = parsed.cookieString;
          // Only use saved token if we're using saved cookies (not env cookie)
          if (parsed.token && !process.env.DISCORD_USER_COOKIE) {
            this.token = parsed.token;
            console.error('[Discord] Token loaded from saved file');
          }
          console.error('[Discord] Using saved cookie from previous login');
        }
      } catch (e) {
        console.error('[Discord] Failed to load saved cookies:', e);
      }
    }
    
    // If we have an environment cookie but no token, try to load token from saved file
    if (this.cookie && !this.token) {
      try {
        const cookieFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'discord_cookies.json');
        const savedData = await fs.readFile(cookieFile, 'utf-8');
        const parsed = JSON.parse(savedData);
        if (parsed.token && typeof parsed.token === 'string' && parsed.token.length > 50) {
          this.token = parsed.token;
          console.error('[Discord] Token loaded from saved file for env cookie');
        }
      } catch (e) {
        console.error('[Discord] Failed to load saved token:', e);
      }
    }
    
    // If still no cookie and we have credentials, try to login
    if (!this.cookie && process.env.DISCORD_USERNAME && process.env.DISCORD_PASSWORD) {
      console.error('[Discord] No cookie found, attempting login...');
      const login = new DiscordLogin();
      const result = await login.login(
        process.env.DISCORD_USERNAME,
        process.env.DISCORD_PASSWORD
      );
      
      if (result.success && result.cookie) {
        this.cookie = result.cookie;
        if (result.token) {
          this.token = result.token;
        }
        console.error('[Discord] Login successful, using fresh cookie');
      } else {
        throw new Error(`Login failed: ${result.error}`);
      }
    }
    
    if (!this.cookie) {
      throw new Error('No Discord cookie available - set DISCORD_USER_COOKIE or provide login credentials');
    }
    // First, get gateway info
    const gatewayResponse = await fetch('https://discord.com/api/v10/gateway', {
      headers: this.getHeaders()
    });

    if (!gatewayResponse.ok) {
      throw new Error(`Failed to get gateway: ${gatewayResponse.status}`);
    }

    const gatewayData = await gatewayResponse.json() as { url: string };
    const wsUrl = `${gatewayData.url}?v=10&encoding=json`;

    // Connect to WebSocket
    this.ws = new WebSocket(wsUrl, {
      headers: {
        'Origin': 'https://discord.com',
        'User-Agent': this.superProperties.browser_user_agent
      }
    });

    this.ws.on('open', () => {
      console.error('[Discord] WebSocket connected');
      // Don't emit ready here - wait for READY dispatch
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      console.error(`[Discord] WebSocket closed: ${code} - ${reason}`);
      this.cleanup();
    });

    this.ws.on('error', (error) => {
      console.error('[Discord] WebSocket error:', error);
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    const message = JSON.parse(data.toString());
    
    if (message.s) this.sequence = message.s;

    switch (message.op) {
      case 10: // Hello
        this.handleHello(message.d);
        break;
      case 0: // Dispatch
        this.handleDispatch(message);
        break;
      case 11: // Heartbeat ACK
        break;
      case 7: // Reconnect
        console.error('[Discord] Server requested reconnect');
        this.reconnect();
        break;
      case 9: // Invalid Session
        console.error('[Discord] Invalid session');
        if (message.d) {
          this.reconnect();
        } else {
          this.connect();
        }
        break;
    }
  }

  private handleHello(data: { heartbeat_interval: number }): void {
    // Start heartbeat
    this.startHeartbeat(data.heartbeat_interval);
    
    // Send identify
    this.identify();
  }

  private startHeartbeat(interval: number): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          op: 1,
          d: this.sequence
        }));
      }
    }, interval);
  }

  private async identify(): Promise<void> {
    // If we don't have a token, try to get one through login
    if (!this.token) {
      console.error('[Discord] No token available, attempting to get one through login...');
      
      // Check if we have login credentials
      if (process.env.DISCORD_USERNAME && process.env.DISCORD_PASSWORD) {
        console.error('[Discord] Attempting fresh login to get token...');
        const login = new DiscordLogin();
        const result = await login.login(
          process.env.DISCORD_USERNAME,
          process.env.DISCORD_PASSWORD
        );
        
        if (result.success && result.token) {
          this.token = result.token;
          if (result.cookie) {
            this.cookie = result.cookie;
          }
          console.error('[Discord] Fresh login successful, got new token');
        } else {
          throw new Error(`Login failed to get token: ${result.error}`);
        }
      } else {
        // Try to validate the current cookie at least
        try {
          const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: this.getHeaders()
          });
          
          if (response.ok) {
            console.error('[Discord] Cookie appears valid, but no auth token available');
            throw new Error('Valid cookie found but no auth token available - need DISCORD_USERNAME/PASSWORD for login');
          } else {
            console.error('[Discord] Cookie validation failed:', response.status);
            throw new Error(`Cookie validation failed: ${response.status} - need DISCORD_USERNAME/PASSWORD for login`);
          }
        } catch (error) {
          console.error('[Discord] Error validating cookie:', error);
          throw new Error('No authentication token available and no login credentials provided');
        }
      }
    }

    const payload = {
      op: 2,
      d: {
        token: this.token,
        capabilities: 30717,
        properties: this.superProperties,
        presence: {
          status: "online",
          since: 0,
          activities: [],
          afk: false
        },
        compress: false,
        client_state: {
          guild_versions: {},
          highest_last_message_id: "0",
          read_state_version: 0,
          user_guild_settings_version: -1,
          user_settings_version: -1,
          private_channels_version: "0",
          api_code_version: 0
        }
      }
    };

    console.error('[Discord] Sending identify with token');
    this.ws?.send(JSON.stringify(payload));
  }

  private async extractTokenFromCookie(): Promise<string | null> {
    try {
      // Try to get token by making a request to Discord's application page
      // This often includes the token in the initial page load
      const response = await fetch('https://discord.com/api/v10/applications/@me', {
        headers: this.getHeaders()
      });

      if (response.ok) {
        // If this works, we can try to extract token from headers or make other API calls
        // But for now, we don't have a reliable way to extract the token from cookies alone
        console.error('[Discord] API access works with cookies, but we need WebSocket token');
        return null;
      }
    } catch (error) {
      console.error('[Discord] Failed to extract token from cookie:', error);
    }
    return null;
  }

  private handleDispatch(message: any): void {
    const { t: eventType, d: data } = message;

    switch (eventType) {
      case 'READY':
        this.sessionId = data.session_id;
        console.error(`[Discord] Logged in as ${data.user.username}#${data.user.discriminator}`);
        console.error(`[Discord] Ready event - Token available: ${!!this.token}`);
        // Store user data for later use
        this.user = data.user;
        this.emit('ready', data);
        break;
        
      case 'VOICE_STATE_UPDATE':
        console.error('[Discord] VOICE_STATE_UPDATE received:', data);
        this.handleVoiceStateUpdate(data);
        break;
        
      case 'VOICE_SERVER_UPDATE':
        console.error('[Discord] VOICE_SERVER_UPDATE received:', data);
        this.handleVoiceServerUpdate(data);
        break;
        
      case 'MESSAGE_CREATE':
        this.emit('messageCreate', data);
        break;
        
      default:
        // Log unexpected events for debugging
        if (eventType !== 'GUILD_CREATE' && eventType !== 'READY_SUPPLEMENTAL' && 
            eventType !== 'SESSIONS_REPLACE' && eventType !== 'USER_REQUIRED_ACTION_UPDATE' &&
            eventType !== 'MESSAGE_ACK') {
          console.error(`[Discord] Received event: ${eventType}`);
        }
        // Always emit the event
        this.emit(eventType, data);
    }
  }

  private handleVoiceStateUpdate(data: VoiceState): void {
    this.voiceStates.set(data.user_id, data);
    this.emit('voiceStateUpdate', data);
  }

  private async handleVoiceServerUpdate(data: any): Promise<void> {
    console.error('[Voice] Server update received:', data);
    console.error('[Voice] Voice server token:', data.token ? 'Present' : 'Missing');
    console.error('[Voice] Voice server endpoint:', data.endpoint);
    console.error('[Voice] Current user ID:', this.user?.id);
    console.error('[Voice] Voice states map size:', this.voiceStates.size);
    
    // Get our own voice state for this guild
    let voiceState: VoiceState | undefined;
    for (const [userId, state] of this.voiceStates) {
      console.error('[Voice] Checking voice state - userId:', userId, 'guildId:', state.guild_id, 'channelId:', state.channel_id);
      if (state.guild_id === data.guild_id && userId === this.user?.id) {
        voiceState = state;
        break;
      }
    }
    
    if (!voiceState) {
      console.error('[Voice] No voice state found for guild:', data.guild_id);
      console.error('[Voice] All voice states:', Array.from(this.voiceStates.entries()));
      return;
    }

    // Connect to voice websocket using v9 protocol
    const voiceWsUrl = `wss://${data.endpoint}?v=9`;
    
    this.voiceWebsocket = new WebSocket(voiceWsUrl, {
      headers: {
        'Origin': 'https://discord.com',
        'User-Agent': this.superProperties.browser_user_agent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    this.voiceWebsocket.on('open', () => {
      console.error('[Voice WebSocket] Connected');
      // Send voice identify
      this.voiceWebsocket?.send(JSON.stringify({
        op: 0,
        d: {
          server_id: data.guild_id,
          user_id: this.user?.id || voiceState.user_id,
          session_id: voiceState.session_id,
          token: data.token
        }
      }));
    });

    this.voiceWebsocket.on('message', async (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString());
      await this.handleVoiceMessage(message);
    });
    
    this.voiceWebsocket.on('error', (error) => {
      console.error('[Voice WebSocket] Error:', error);
    });
    
    this.voiceWebsocket.on('close', (code, reason) => {
      console.error('[Voice WebSocket] Closed:', code, reason?.toString());
      // Clean up voice handler
      if (this.webrtcHandler) {
        this.webrtcHandler.disconnect();
        this.webrtcHandler = undefined;
      }
    });
  }

  private async handleVoiceMessage(message: any): Promise<void> {
    console.error('[Voice] Message received:', { op: message.op, t: message.t, seq: message.seq });
    
    // Track sequence numbers
    if (message.seq !== undefined) {
      this.voiceSequence = message.seq;
    }
    
    switch (message.op) {
      case 2: // Ready
        console.error('[Voice] Ready event received:', message.d);
        // Create WebRTC handler
        if (!this.webrtcHandler) {
          console.error('[Voice] Creating ThreadedWebRTCVoiceHandler');
          this.webrtcHandler = new ThreadedWebRTCVoiceHandler();
        }
        
        // Get our voice state for this connection
        let voiceState: VoiceState | undefined;
        for (const [userId, state] of this.voiceStates) {
          if (userId === this.user?.id) {
            voiceState = state;
            break;
          }
        }
        
        if (voiceState && this.voiceWebsocket) {
          console.error('[Voice] Setting up WebRTC with voice state:', voiceState);
          
          // Connect the WebRTC voice handler
          if (this.voiceWebsocket) {
            const options = {
              endpoint: '',
              token: '',
              sessionId: voiceState.session_id,
              userId: this.user?.id || voiceState.user_id,
              guildId: voiceState.guild_id,
              channelId: voiceState.channel_id || ''
            };
            await this.webrtcHandler.connect(options, this.voiceWebsocket);
            await this.webrtcHandler.handleVoiceMessage({ op: 2, d: message.d });
          }
        } else {
          console.error('[Voice] No voice state found!');
        }
        break;
        
      case 8: // Hello
        console.error('[Voice] Hello received, starting heartbeat');
        // Start voice heartbeat
        this.startVoiceHeartbeat(message.d.heartbeat_interval);
        break;
        
      case 6: // Heartbeat ACK
        console.error('[Voice] Heartbeat ACK received');
        break;
        
      default:
        // Pass other messages to WebRTC handler
        if (this.webrtcHandler) {
          this.webrtcHandler.handleVoiceMessage(message);
        }
        break;
    }
  }

  private voiceHeartbeatInterval?: NodeJS.Timeout;
  private voiceSequence: number = 0;

  private startVoiceHeartbeat(interval: number): void {
    // Clear any existing heartbeat
    if (this.voiceHeartbeatInterval) {
      clearInterval(this.voiceHeartbeatInterval);
    }
    
    console.error('[Voice] Starting heartbeat with suggested interval:', interval, 'but using 5000ms');
    // Use 5 second interval like the browser does, not the suggested interval
    this.voiceHeartbeatInterval = setInterval(() => {
      if (this.voiceWebsocket?.readyState === WebSocket.OPEN) {
        const heartbeat = {
          op: 3,
          d: {
            t: Date.now(),
            seq_ack: this.voiceSequence
          }
        };
        console.error('[Voice] Sending heartbeat:', heartbeat);
        this.voiceWebsocket.send(JSON.stringify(heartbeat));
      }
    }, 5000); // Send every 5 seconds like the browser
  }

  async joinVoiceChannel(guildId: string, channelId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Discord');
    }
    
    console.error('[Discord] Sending voice state update for guild:', guildId, 'channel:', channelId);
    console.error('[Discord] WebSocket state:', this.ws.readyState);

    // Send voice state update
    const voiceStatePayload = {
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: false,
        self_video: false
        // Removed flags entirely - let Discord use defaults
      }
    };
    
    console.error('[Discord] Voice state payload:', JSON.stringify(voiceStatePayload));
    this.ws.send(JSON.stringify(voiceStatePayload));
    console.error('[Discord] Voice state update sent');
  }

  async leaveVoiceChannel(guildId: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Discord');
    }

    this.ws.send(JSON.stringify({
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: null,
        self_mute: false,
        self_deaf: false
      }
    }));
  }

  async sendMessage(channelId: string, content: string): Promise<any> {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(true),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content,
        tts: false,
        flags: 0
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }

    return response.json();
  }

  async getMessages(channelId: string, limit: number = 50): Promise<any[]> {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
      headers: this.getHeaders(true)
    });

    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status}`);
    }

    return response.json() as Promise<any[]>;
  }

  async getGuilds(): Promise<any[]> {
    // Make sure we have a token before making API calls
    if (!this.token) {
      throw new Error('No token available for API calls');
    }

    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: this.getHeaders(true)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Discord API Error] Status: ${response.status}, Body: ${errorText}`);
      console.error(`[Discord API Error] Using token: ${this.token ? 'Yes' : 'No'}`);
      
      // Handle rate limits
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        console.error(`[Discord] Rate limited. Retry after ${retryAfter}s`);
      }
      
      throw new Error(`Failed to get guilds: ${response.status}`);
    }

    return response.json() as Promise<any[]>;
  }

  async getChannels(guildId: string): Promise<any[]> {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: this.getHeaders(true)
    });

    if (!response.ok) {
      throw new Error(`Failed to get channels: ${response.status}`);
    }

    return response.json() as Promise<any[]>;
  }

  async getVoiceState(guildId: string): Promise<VoiceState | null> {
    return this.voiceStates.get(guildId) || null;
  }

  async getVoiceMembers(guildId: string, channelId: string): Promise<{ id: string; username: string }[]> {
    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
        headers: this.getHeaders(true)
      });

      if (!response.ok) {
        console.error(`[Discord] Failed to get members (${response.status}), using fallback`);
        // Return basic info for current user as fallback
        if (this.user) {
          return [{ id: this.user.id, username: this.user.username }];
        }
        return [];
      }

      const members = await response.json() as any[];
      // Filter members in the voice channel
      return members
        .filter(m => m.voice?.channel_id === channelId)
        .map(m => ({ id: m.user.id, username: m.user.username }));
    } catch (error) {
      console.error('[Discord] Error getting voice members:', error);
      // Return basic info for current user as fallback
      if (this.user) {
        return [{ id: this.user.id, username: this.user.username }];
      }
      return [];
    }
  }

  async getStatus(): Promise<{ connected: boolean; user: any | null; guilds: number }> {
    const connected = this.ws?.readyState === WebSocket.OPEN;
    let user = this.user || null;  // Use stored user data
    let guilds = 0;

    if (connected) {
      try {
        // If we don't have user data, fetch it
        if (!user) {
          const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: this.getHeaders(true)
          });
          if (userResponse.ok) {
            user = await userResponse.json();
            this.user = user;
          }
        }

        const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: this.getHeaders(true)
        });
        if (guildsResponse.ok) {
          const guildsList = await guildsResponse.json() as any[];
          guilds = guildsList.length;
        }
      } catch (error) {
        console.error('[Status Error]', error);
      }
    }

    return { connected, user, guilds };
  }

  async playAudioInVoice(audioBuffer: Buffer): Promise<void> {
    if (!this.webrtcHandler) {
      throw new Error('Not connected to voice channel');
    }
    
    await this.webrtcHandler.playAudio(audioBuffer);
  }

  setSpeaking(speaking: boolean): void {
    if (this.webrtcHandler) {
      this.webrtcHandler.setSpeaking(speaking);
    }
  }

  getVoiceHandler(): ThreadedWebRTCVoiceHandler | undefined {
    return this.webrtcHandler;
  }

  private reconnect(): void {
    this.cleanup();
    setTimeout(() => this.connect(), 5000);
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.voiceHeartbeatInterval) {
      clearInterval(this.voiceHeartbeatInterval);
    }
    if (this.ws) {
      this.ws.close();
    }
    if (this.voiceWebsocket) {
      this.voiceWebsocket.close();
    }
    if (this.webrtcHandler) {
      this.webrtcHandler.disconnect();
      this.webrtcHandler = undefined;
    }
  }

  disconnect(): void {
    this.cleanup();
  }
}