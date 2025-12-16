// Провайдеры LLM
import axios from 'axios';
import FormData from 'form-data';
import fs from 'node:fs';
import { AgentConfig, ProviderResponse, Message, ProviderType } from './types.js';
import { MODEL_PRICING, updatePricing, ModelPrice, getModelInfo } from './pricing.js';

const DEFAULT_SYSTEM_PROMPT = `Ты — член Совета ИИ. Твоя задача — давать краткие, точные и полезные советы Председателю. Не пытайся выполнять команды, только анализируй и советуй.`;

// Базовые URL
const API_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com',
  grok: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  perplexity: 'https://api.perplexity.ai',
  openrouter: 'https://openrouter.ai/api/v1',
};

export const API_KEY_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  grok: 'https://console.x.ai/',
  gemini: 'https://aistudio.google.com/app/apikey',
  perplexity: 'https://www.perplexity.ai/settings/api',
  openrouter: 'https://openrouter.ai/keys',
};

// Дефолтные модели для fetchModels fallback
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
  grok: 'grok-2-1212',
  gemini: 'gemini-2.0-flash',
  perplexity: 'sonar',
  openrouter: 'google/gemini-2.0-flash-001',
};

// --- Helper Functions ---

export function estimateTokens(text: string): number {
  // Conservative estimate: ~2.5-3 chars per token for Cyrillic/mixed text
  // Standard English is ~4, but we want to be safe.
  return Math.ceil(text.length / 2.5);
}

export function getMimeType(base64: string): string {
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (base64.startsWith('R0lGODdh') || base64.startsWith('R0lGODlh')) return 'image/gif';
    if (base64.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg'; // Default fallback
}

function prepareMessages(
  history: Message[], 
  prompt: string, 
  systemPrompt: string, 
  model: string
): { role: string, content: any[] }[] {
  // 1. Get context limit
  const modelInfo = getModelInfo(model);
  // Default to 128k for modern models if unknown, or safe 4k fallback
  let contextLimit = modelInfo?.context || 4096; 
  
  // Safety margin for output tokens
  const outputReserve = 2000;
  const availableContext = contextLimit - outputReserve;

  // 2. Prepare fixed messages (System + User Prompt)
  const systemMsg = { role: 'system', content: [{ type: 'text', text: systemPrompt }] };
  const userMsg = { role: 'user', content: [{ type: 'text', text: prompt }] };
  
  const fixedTokens = estimateTokens(systemPrompt) + estimateTokens(prompt);
  
  // 3. Slice history to fit remaining context
  let remainingTokens = availableContext - fixedTokens;
  if (remainingTokens < 0) remainingTokens = 0; // Should not happen ideally

  const textHistory: { role: string, content: any[] }[] = [];
  
  // Iterate from end to start
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    
    // Skip if this is the very last message and it duplicates the current prompt
    if (i === history.length - 1 && msg.role === 'user' && msg.text === prompt) {
        continue;
    }

    // Map internal roles to standard API roles
    const apiRole = msg.role === 'chair' ? 'assistant' : (msg.role === 'assistant' ? 'assistant' : 'user');
    const tokens = estimateTokens(msg.text); // Rough estimate for text only
    
    // Images add tokens too, roughly 1000 per image for safety
    const imageTokens = (msg.images?.length || 0) * 1000;
    const totalMsgTokens = tokens + imageTokens;

    if (remainingTokens - totalMsgTokens >= 0) {
      if (msg.images && msg.images.length > 0) {
          // Keep structure for later formatting in send functions
          // We store it as a special object or just mixed content
          // Let's store as mixed content array which is compatible with our new logic
          // But wait, prepareMessages returns { role, content: string }[] normally.
          // We need to upgrade return type of prepareMessages
          // For now, let's just pass the raw object or handle it.
          // Let's change prepareMessages return type to allow any content
      }
      
      // We will handle content formatting in the specific send functions
      // Here we just pass the message object wrapper
      // Actually, refactoring prepareMessages return type is best.
      
      // Let's construct a content array for this message
      const contentParts: any[] = [{ type: 'text', text: msg.text }];
      if (msg.images) {
          msg.images.forEach(img => {
              contentParts.push({ type: 'image', data: img });
          });
      }
      
      textHistory.unshift({ role: apiRole, content: contentParts });
      remainingTokens -= totalMsgTokens;
    } else {
      break; // No more space
    }
  }

  // 4. Assemble final array: System -> History -> Current Prompt
  // Current prompt might also have images (not supported in current call signature, but usually Chair tools output images as history)
  
  const rawMessages = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] }, 
      ...textHistory, 
      { role: 'user', content: [{ type: 'text', text: prompt }] }
  ];

  // 5. Sanitize: Merge consecutive messages with the same role
  const sanitizedMessages: { role: string, content: any[] }[] = [];
  
  for (const msg of rawMessages) {
      if (sanitizedMessages.length === 0) {
          sanitizedMessages.push(msg);
          continue;
      }
      
      const last = sanitizedMessages[sanitizedMessages.length - 1];
      
      if (last.role === msg.role && msg.role !== 'system') {
          // Merge content arrays
          last.content = [...last.content, ...msg.content];
      } else {
          sanitizedMessages.push(msg);
      }
  }

  return sanitizedMessages;
}

// --- Main Send Function ---

export async function sendToProvider(
  agent: AgentConfig,
  apiKey: string,
  prompt: string,
  history: Message[],
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  const model = agent.model;
  const type = agent.providerType;
  
  if (!apiKey) {
    return { providerId: agent.id, model, text: '', error: 'Нет API ключа' };
  }

  // Prepare messages with potential images
  // We need to cast the return type of prepareMessages as we changed implementation above
  const messages = prepareMessages(history, prompt, systemPrompt, model) as any[];

  let attempts = 0;
  const maxAttempts = 2; // Try once, then retry once

  while (attempts < maxAttempts) {
    attempts++;
    try {
      if (type === 'anthropic') {
        return await sendAnthropic(apiKey, messages, model, systemPrompt, agent.id, signal);
      } else if (type === 'gemini') {
        return await sendGemini(apiKey, messages, model, systemPrompt, agent.id, signal);
      } else {
        // openai, deepseek, grok, perplexity, openrouter
        return await sendOpenAICompatible(type, apiKey, messages, model, systemPrompt, agent.id, signal);
      }
    } catch (error: any) {
      if (axios.isCancel(error) || signal?.aborted) {
         throw new Error('Aborted');
      }

      // Check for retryable errors (5xx, timeout)
      const isRetryable = 
          error.code === 'ECONNABORTED' || 
          error.message?.toLowerCase().includes('timeout') ||
          (error.response && error.response.status >= 500);

      if (isRetryable && attempts < maxAttempts) {
          // Log retry (optional, maybe debug only, or console.log/error)
          // console.error(`[Provider] Retry ${attempts}/${maxAttempts} for ${model} due to: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
          continue;
      }
      
      let msg = error?.message || 'Unknown error';
      
      if (error?.response?.data) {
          const data = error.response.data;
          if (typeof data === 'string') {
              msg = data;
          } else if (data.error) {
              if (typeof data.error === 'string') msg = data.error;
              else if (data.error.message) msg = data.error.message;
              else msg = JSON.stringify(data.error);
          } else if (data.message) {
              msg = data.message;
          } else {
              // Try to be helpful if unknown structure
              msg = JSON.stringify(data).slice(0, 200);
          }
      }
      
      return { providerId: agent.id, model, text: '', error: msg };
    }
  }
  return { providerId: agent.id, model, text: '', error: 'Max retries exceeded' };
}

// --- Provider Implementations ---

// Helper to determine timeout based on model
function getTimeoutForModel(model: string): number {
    const lower = model.toLowerCase();
    // Reasoning models take much longer
    if (lower.includes('reason') || lower.includes('r1') || lower.includes('o1-') || lower.includes('deep-research')) {
        return 900000; // 15 minutes (Reasoning models need time)
    }
    return 300000; // 5 minutes (Standard models with large context)
}

async function sendOpenAICompatible(
  type: string,
  apiKey: string,
  messages: any[],
  model: string,
  systemPrompt: string,
  agentId: string,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  const baseUrl = API_URLS[type] || API_URLS.openai;

  // Transform our internal content structure to OpenAI format
  // Internal: [{ type: 'text', text: '...' }, { type: 'image', data: 'base64...' }]
  // OpenAI: content: "text" OR content: [{ type: "text", text: "..." }, { type: "image_url", image_url: { url: "..." } }]
  
  const formattedMessages = messages.map(m => {
      // System message is usually just text for OpenAI, but GPT-4o supports array?
      // Best to keep system as string if possible, but let's see.
      // Usually system is just text.
      if (m.role === 'system') {
          const text = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          return { role: 'system', content: text };
      }

      const contentParts = m.content.map((c: any) => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'image') return { type: 'image_url', image_url: { url: `data:${getMimeType(c.data)};base64,${c.data}` } };
          return null;
      }).filter(Boolean);

      // Simplify to string if no images (better compatibility for OpenRouter/older models)
      const hasImages = contentParts.some((c: any) => c.type === 'image_url');
      if (!hasImages) {
          const textContent = contentParts.map((c: any) => c.text).join('\n');
          return { role: m.role, content: textContent };
      }

      return { role: m.role, content: contentParts };
  });

  const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
  };

  if (type === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/StanislavHerman/House-of-Collective-Intelligence'; // Optional but recommended
      headers['X-Title'] = 'House of Collective Intelligence';
  }

  const tryChat = async () => {
      try {
          const payload: any = {
              model,
              messages: formattedMessages,
          };

          // Handle max_tokens vs max_completion_tokens
          if (model.includes('o1-') || model.includes('o3-')) {
               payload.max_completion_tokens = 32768; // o1 supports large outputs
          } else {
               payload.max_tokens = 16384; // Safe default for most modern models
          }

          const res = await axios.post(
            `${baseUrl}/chat/completions`,
            payload,
            {
              headers,
              timeout: getTimeoutForModel(model),
              signal
            }
          );
          const msgObj = res.data?.choices?.[0]?.message;
          let text = msgObj?.content || '';
          
          // Capture reasoning if available (DeepSeek R1 / OpenRouter)
          const reasoning = msgObj?.reasoning_content || msgObj?.reasoning;
          
          return { providerId: agentId, model, text, reasoning };
      } catch (err: any) {
          // Debug logging for OpenRouter/API errors
          if (err.response?.data) {
              // Only log if it's an error we want to debug, or always log for now to find the issue
              const errorData = JSON.stringify(err.response.data, null, 2);
              // We can't easily console.log here without messing up UI potentially, 
              // but since the user is seeing "Provider returned error", the error is caught in sendToProvider.
              // We'll throw the error and let sendToProvider handle it, but we can add a property to the error object if we want.
          }
          throw err;
      }
  };

  return await tryChat();
}

async function sendAnthropic(
  apiKey: string,
  messages: any[],
  model: string,
  systemPrompt: string,
  agentId: string,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  // Anthropic format:
  // content: [{ type: "text", text: "..." }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } }]
  
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => {
      const content = m.content.map((c: any) => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'image') return { 
              type: 'image', 
              source: { 
                  type: 'base64', 
                  media_type: getMimeType(c.data) as any, 
                  data: c.data 
              } 
          };
          return null;
      }).filter(Boolean);
      
      return { role: m.role, content };
  });

  const res = await axios.post(
    `${API_URLS.anthropic}/messages`,
    {
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: chatMessages
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout: getTimeoutForModel(model),
      signal
    }
  );
  const text = res.data?.content?.[0]?.text || '';
  return { providerId: agentId, model, text };
}

async function sendGemini(
  apiKey: string,
  messages: any[],
  model: string,
  systemPrompt: string,
  agentId: string,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  // Gemini format: parts: [{ text: "..." }, { inlineData: { mimeType: "...", data: "..." } }]
  
  const geminiContent = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: m.content.map((c: any) => {
              if (c.type === 'text') return { text: c.text };
              if (c.type === 'image') return { inlineData: { mimeType: getMimeType(c.data), data: c.data } };
              return null;
          }).filter(Boolean)
      }));

  const requestBody: any = {
      contents: geminiContent,
      systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  const res = await axios.post(
    `${API_URLS.gemini}/models/${model}:generateContent?key=${apiKey}`,
    requestBody,
    { timeout: getTimeoutForModel(model), signal }
  );
  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { providerId: agentId, model, text };
}

// --- Utils ---

export async function getBalance(type: string, apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  try {
    if (type === 'deepseek') {
      const res = await axios.get('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5000
      });
      const usd = res.data?.balance_infos?.find((b: any) => b.currency === 'USD');
      if (usd) return `$${parseFloat(usd.total_balance).toFixed(2)}`;
    }

    if (type === 'openrouter') {
        const res = await axios.get('https://openrouter.ai/api/v1/credits', {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 5000
        });
        const data = res.data?.data;
        if (data) {
            const credits = parseFloat(data.total_credits || '0');
            const usage = parseFloat(data.total_usage || '0');
            const balance = credits - usage;
            return `$${balance.toFixed(2)}`;
        }
    }
    
    // For others, check validity
    const test = await testApiKey(type, apiKey);
    return test.valid ? '✓' : '✗';
  } catch {
    return '✗';
  }
}

export async function testApiKey(type: string, apiKey: string): Promise<{ valid: boolean, error?: string }> {
  try {
    if (type === 'gemini') {
      await axios.get(`${API_URLS.gemini}/models?key=${apiKey}`, { timeout: 10000 });
      return { valid: true };
    }
    if (type === 'anthropic') {
      await axios.post(
        `${API_URLS.anthropic}/messages`,
        { model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
        { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeout: 10000 }
      );
      return { valid: true };
    }
    if (type === 'perplexity') {
      const baseUrl = API_URLS.perplexity;
      await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: 'sonar',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      return { valid: true };
    }
    const baseUrl = API_URLS[type] || API_URLS.openai;
    await axios.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000
    });
    return { valid: true };
  } catch (error: any) {
    const status = error?.response?.status;
    const msg = error?.response?.data?.error?.message || error?.message || 'Ошибка сети';
    console.error(`API key test failed: ${msg} (Status: ${status})`);

    // If explicit auth error -> invalid
    if (status === 401 || status === 403) {
        return { valid: false, error: msg };
    }

    // If server error (5xx), assume key is valid (request reached server)
    // Perplexity often returns 500/502 for model issues
    if (status && status >= 500) {
        return { valid: true };
    }

    return { valid: false, error: msg };
  }
}

export async function fetchModels(type: string, apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  try {
    if (type === 'anthropic') {
      return [
        'claude-opus-4.5',
        'claude-sonnet-4.5',
        'claude-haiku-4.5',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
      ];
    }
    if (type === 'gemini') {
      const res = await axios.get(`${API_URLS.gemini}/models?key=${apiKey}`, { timeout: 10000 });
      const models = res.data?.models || [];
      return models
        .map((m: any) => m.name.replace(/^models\//, ''))
        .filter((m: string) => m.includes('gemini'));
    }
    if (type === 'perplexity') {
      // Perplexity не предоставляет эндпоинт /models. Возвращаем известный список.
      return [
        'sonar',
        'sonar-pro',
        'sonar-reasoning',
        'sonar-reasoning-pro',
        'sonar-deep-research',
      ].sort();
    }
    
    if (type === 'openrouter') {
        const res = await axios.get(`${API_URLS.openrouter}/models`, {
            timeout: 15000
        });
        
        const data = res.data?.data || [];
        const newPricing: Record<string, ModelPrice> = {};
        
        const models = data.map((m: any) => {
            // Update pricing if available
            if (m.pricing) {
                // OpenRouter gives price per token (usually), we need per 1M tokens
                // Actually they give string like "0.000001"
                const prompt = parseFloat(m.pricing.prompt) * 1000000;
                const completion = parseFloat(m.pricing.completion) * 1000000;
                const context = m.context_length || 4096;
                
                if (!isNaN(prompt) && !isNaN(completion)) {
                    newPricing[m.id] = { in: prompt, out: completion, context };
                }
            }
            return m.id;
        });
        
        if (Object.keys(newPricing).length > 0) {
            updatePricing(newPricing);
        }
        
        return models.sort();
    }

    const baseUrl = API_URLS[type] || API_URLS.openai;
    const res = await axios.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000
    });
    const data = res.data?.data || [];
    
    let models = data.map((m: any) => m.id);
    
    // Фильтрация для OpenAI
    if (!API_URLS[type] || type === 'openai') {
        const ignored = ['tts', 'whisper', 'dall-e', 'embedding', 'moderation', 'babbage-002', 'davinci-002'];
        models = models.filter((id: string) => {
            if (ignored.some(i => id.includes(i))) return false;
            return true;
        });
    }
    
    return models.sort();
  } catch (error: any) {
    console.error(`Fetch models for ${type} failed: ${error?.message || 'Ошибка'}`); // Отладочный вывод
    return [];
  }
}

export async function transcribeAudio(apiKey: string, filePath: string): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');

    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      timeout: 120000
    });

    return res.data?.text || '';
  } catch (error: any) {
    throw new Error(`Transcription failed: ${error?.response?.data?.error?.message || error?.message}`);
  }
}