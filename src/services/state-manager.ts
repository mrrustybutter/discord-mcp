export interface DiscordState {
  currentServer: {
    id: string;
    name: string;
  } | null;
  currentTextChannel: {
    id: string;
    name: string;
  } | null;
  currentVoiceChannel: {
    id: string;
    name: string;
    guildId: string;
  } | null;
  isTranscribing: boolean;
}

export class StateManager {
  private state: DiscordState = {
    currentServer: null,
    currentTextChannel: null,
    currentVoiceChannel: null,
    isTranscribing: false,
  };

  setCurrentServer(id: string, name: string) {
    this.state.currentServer = { id, name };
    // Clear channels when switching servers
    this.state.currentTextChannel = null;
    this.state.currentVoiceChannel = null;
  }

  getCurrentServer() {
    return this.state.currentServer;
  }

  setCurrentTextChannel(id: string, name: string) {
    this.state.currentTextChannel = { id, name };
  }

  getCurrentTextChannel() {
    return this.state.currentTextChannel;
  }

  setCurrentVoiceChannel(id: string, name: string, guildId: string) {
    this.state.currentVoiceChannel = { id, name, guildId };
    this.state.isTranscribing = true;
  }

  getCurrentVoiceChannel() {
    return this.state.currentVoiceChannel;
  }

  clearVoiceChannel() {
    this.state.currentVoiceChannel = null;
    this.state.isTranscribing = false;
  }

  isInVoiceChannel() {
    return this.state.currentVoiceChannel !== null;
  }

  isTranscribing() {
    return this.state.isTranscribing;
  }

  getFullState() {
    return { ...this.state };
  }
}