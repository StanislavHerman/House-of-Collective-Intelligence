// Управление конфигурацией ~/.council-ai/config_v2.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppConfig, AgentConfig, ProviderType, AppPermissions } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.council-ai');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config_v2.json');

export class ConfigManager {
  private config: AppConfig = { apiKeys: {}, agents: [] };

  constructor() {
    this.load();
  }

  private load() {
    try {
      // Secure directory: 700 (rwx------)
      if (!fs.existsSync(CONFIG_DIR)) {
          fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      }
      
      if (fs.existsSync(CONFIG_FILE)) {
          const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
          this.config = JSON.parse(raw);
          // Ensure structure
          if (!this.config.apiKeys) this.config.apiKeys = {};
          if (!this.config.agents) this.config.agents = [];
          if (this.config.muteMode === undefined) this.config.muteMode = false;
          if (this.config.autoCompact === undefined) this.config.autoCompact = true; // Default ON
          if (this.config.autoCompactLimit === undefined) this.config.autoCompactLimit = 20; // Default 20
          if (this.config.language === undefined) this.config.language = 'ru'; // Default RU
          
          // Permissions defaults
          const defaultPerms = {
              allow_browser: true,
              allow_desktop: true,
              allow_file_read: true,
              allow_file_write: true,
              allow_file_edit: true,
              allow_command: true
          };

          if (!this.config.permissions) {
              this.config.permissions = defaultPerms;
          } else {
              // Merge to ensure missing keys are added (migration)
              this.config.permissions = { ...defaultPerms, ...this.config.permissions };
          }
      } else {
          // Миграция со старого конфига (если есть) или дефолт
          this.config = { 
              apiKeys: {}, 
              agents: [], 
              muteMode: false, 
              autoCompact: true, 
              autoCompactLimit: 20, 
              language: 'ru',
              permissions: {
                  allow_browser: true,
                  allow_desktop: true,
                  allow_file_read: true,
                  allow_file_write: true,
                  allow_file_edit: true,
                  allow_command: true
              }
          };
      }
    } catch {
      this.config = { 
          apiKeys: {}, 
          agents: [], 
          muteMode: false, 
          autoCompact: true, 
          autoCompactLimit: 20, 
          language: 'ru',
          permissions: {
              allow_browser: true,
              allow_desktop: true,
              allow_file_read: true,
              allow_file_write: true,
              allow_file_edit: true,
              allow_command: true
          }
      };
    }
    this.validateAgents();
    this.save();
  }

  private validateAgents() {
      const initialCount = this.config.agents.length;
      
      // Filter out agents where the provider has no API key
      this.config.agents = this.config.agents.filter(a => {
          const key = this.config.apiKeys[a.providerType];
          return !!key; // Keep only if key exists
      });
      
      if (this.config.agents.length !== initialCount) {
          // Check if chair was removed
          if (this.config.chairAgentId && !this.config.agents.find(a => a.id === this.config.chairAgentId)) {
              this.config.chairAgentId = undefined;
              // Try to assign new chair if any agents left
              if (this.config.agents.length > 0) {
                  const firstActive = this.config.agents.find(a => a.enabled);
                  if (firstActive) {
                      this.config.chairAgentId = firstActive.id;
                  } else {
                      this.config.chairAgentId = this.config.agents[0].id;
                  }
              }
          }
          
          // Check if secretary was removed
          if (this.config.secretaryAgentId && !this.config.agents.find(a => a.id === this.config.secretaryAgentId)) {
              this.config.secretaryAgentId = undefined;
          }

          this.save();
      }
  }

  private save() {
    const tempFile = CONFIG_FILE + '.tmp';
    // Secure directory: 700
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    // Secure file: 600 (rw-------)
    fs.writeFileSync(tempFile, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, CONFIG_FILE);
  }

  getPermissions(): AppPermissions {
      return this.config.permissions || {
          allow_browser: true,
          allow_desktop: true,
          allow_file_read: true,
          allow_file_write: true,
          allow_command: true
      };
  }

  setPermissions(perms: AppPermissions) {
      this.config.permissions = perms;
      this.save();
  }

  getLanguage(): 'ru' | 'en' {
      return this.config.language || 'ru';
  }

  setLanguage(lang: 'ru' | 'en') {
      this.config.language = lang;
      this.save();
  }

  getMuteMode(): boolean {
    return !!this.config.muteMode;
  }

  setMuteMode(value: boolean) {
    this.config.muteMode = value;
    this.save();
  }

  getCouncilActive(): boolean {
      return this.config.councilActive ?? true;
  }

  setCouncilActive(value: boolean) {
      this.config.councilActive = value;
      this.save();
  }

  getAutoCompact(): boolean {
      return this.config.autoCompact ?? true;
  }

  setAutoCompact(value: boolean) {
      this.config.autoCompact = value;
      this.save();
  }

  getAutoCompactLimit(): number {
      return this.config.autoCompactLimit || 20;
  }

  setAutoCompactLimit(value: number) {
      this.config.autoCompactLimit = value;
      this.save();
  }

  getApiKey(type: string): string | undefined {
    return this.config.apiKeys[type];
  }

  setApiKey(type: string, key: string) {
    this.config.apiKeys[type] = key;
    
    // If key is deleted (empty), remove all agents with this provider
    if (!key) {
        const initialCount = this.config.agents.length;
        this.config.agents = this.config.agents.filter(a => a.providerType !== type);
        
        if (this.config.agents.length !== initialCount) {
            // Check if chair was removed
            if (this.config.chairAgentId && !this.config.agents.find(a => a.id === this.config.chairAgentId)) {
                this.config.chairAgentId = undefined;
                // Try to assign new chair if any agents left
                if (this.config.agents.length > 0) {
                    const firstActive = this.config.agents.find(a => a.enabled);
                    if (firstActive) {
                        this.config.chairAgentId = firstActive.id;
                    } else {
                        this.config.chairAgentId = this.config.agents[0].id;
                    }
                }
            }
        }
    }
    
    this.save();
  }

  getAgents(): AgentConfig[] {
    return this.config.agents;
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.config.agents.find(a => a.id === id);
  }

  addAgent(data: { name: string; providerType: ProviderType; model: string; enabled: boolean }): AgentConfig {
    const newAgent: AgentConfig = {
        id: Math.random().toString(36).substring(2, 9),
        ...data
    };
    this.config.agents.push(newAgent);
    this.save();
    return newAgent;
  }

  removeAgent(id: string) {
    this.config.agents = this.config.agents.filter(a => a.id !== id);
    if (this.config.chairAgentId === id) {
      this.config.chairAgentId = undefined;
    }
    if (this.config.secretaryAgentId === id) {
        this.config.secretaryAgentId = undefined;
    }
    this.save();
  }
  
  updateAgent(id: string, updates: Partial<AgentConfig>) {
      const agent = this.getAgent(id);
      if (agent) {
          Object.assign(agent, updates);
          this.save();
      }
  }

  getChairId(): string | undefined {
    return this.config.chairAgentId;
  }

  setChairId(id: string | undefined) {
    this.config.chairAgentId = id;
    this.save();
  }

  getSecretaryId(): string | undefined {
      return this.config.secretaryAgentId;
  }

  setSecretaryId(id: string | undefined) {
      this.config.secretaryAgentId = id;
      this.save();
  }
}
