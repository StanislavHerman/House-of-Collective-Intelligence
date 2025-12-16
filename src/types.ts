// Типы данных

export type ProviderType = 'openai' | 'anthropic' | 'deepseek' | 'grok' | 'gemini' | 'perplexity' | 'openrouter';

export interface AgentStats {
  totalSuggestions: number;
  acceptedSuggestions: number;
  partiallyAcceptedSuggestions: number;
  rejectedSuggestions: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  model: string;
  enabled: boolean; // Включен ли в совет
}

export interface AppPermissions {
  allow_browser?: boolean;
  allow_desktop?: boolean;
  allow_file_read?: boolean;
  allow_file_write?: boolean;
  allow_file_edit?: boolean;
  allow_command?: boolean;
}

export interface AppConfig {
  apiKeys: Record<string, string>; // ProviderType -> API Key
  agents: AgentConfig[];
  chairAgentId?: string;
  secretaryAgentId?: string;
  muteMode?: boolean; // Скрывать ответы совета
  councilActive?: boolean; // Активен ли Совет и Секретарь
  autoCompact?: boolean; // Автоматическое сжатие контекста
  autoCompactLimit?: number; // Лимит сообщений для автосжатия (по умолчанию 20)
  language?: 'ru' | 'en'; // Язык интерфейса
  permissions?: AppPermissions; // Права доступа инструментов
}

export interface Message {
  role: 'user' | 'assistant' | 'chair';
  text: string;
  providerId?: string;
  timestamp: number;
  images?: string[]; // Base64 strings (jpeg/png)
}

export interface ProviderResponse {
  providerId: string;
  model: string;
  text: string;
  reasoning?: string;
  error?: string;
}

export type CouncilEventType = 'step' | 'tool_start' | 'tool_result' | 'agent_thinking' | 'agent_response' | 'info' | 'error' | 'success';

export interface CouncilEvent {
  type: CouncilEventType;
  message?: string;
  payload?: any;
}