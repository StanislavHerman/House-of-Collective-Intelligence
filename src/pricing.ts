// Цены в USD за 1M токенов (Input / Output)
// Context - размер окна контекста в токенах (приблизительно)
export interface ModelPrice {
    in: number;
    out: number;
    context: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // --- Perplexity Sonar Series ---
  'sonar': { in: 1.00, out: 1.00, context: 128000 },
  'sonar-pro': { in: 3.00, out: 15.00, context: 200000 },
  'sonar-reasoning': { in: 1.00, out: 5.00, context: 128000 },
  'sonar-reasoning-pro': { in: 2.00, out: 8.00, context: 128000 },
  'sonar-deep-research': { in: 2.00, out: 8.00, context: 128000 },

  // --- Gemini 3 Series ---
  'gemini-3-pro-preview': { in: 2.00, out: 12.00, context: 200000 },
  'gemini-3-pro-image-preview': { in: 2.00, out: 120.00, context: 200000 },

  // --- Gemini 2.5 Series ---
  'gemini-2.5-pro': { in: 1.25, out: 10.00, context: 2000000 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50, context: 1000000 },
  'gemini-2.5-flash-preview-09-2025': { in: 0.30, out: 2.50, context: 1000000 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40, context: 1000000 },
  'gemini-2.5-flash-lite-preview-09-2025': { in: 0.10, out: 0.40, context: 1000000 },
  'gemini-2.5-flash-native-audio-preview-09-2025': { in: 0.50, out: 2.00, context: 1000000 },
  'gemini-2.5-flash-image': { in: 0.30, out: 30.00, context: 1000000 },
  'gemini-2.5-flash-preview-tts': { in: 0.50, out: 10.00, context: 1000000 },
  'gemini-2.5-pro-preview-tts': { in: 1.00, out: 20.00, context: 2000000 },
  'gemini-2.5-computer-use-preview-10-2025': { in: 1.25, out: 10.00, context: 200000 },

  // --- Gemini 2.0 Series ---
  'gemini-2.0-flash': { in: 0.10, out: 0.40, context: 1000000 },
  'gemini-2.0-flash-lite': { in: 0.075, out: 0.30, context: 1000000 },

  // --- Imagen Series (Output per image) ---
  'imagen-4.0-fast-generate-001': { in: 0, out: 0.02, context: 0 }, 
  'imagen-4.0-generate-001': { in: 0, out: 0.04, context: 0 },
  'imagen-4.0-ultra-generate-001': { in: 0, out: 0.06, context: 0 },
  'imagen-3.0-generate-002': { in: 0, out: 0.03, context: 0 },

  // --- Veo Series (Output per second) ---
  'veo-3.1-generate-preview': { in: 0, out: 0.40, context: 0 },
  'veo-3.1-fast-generate-preview': { in: 0, out: 0.15, context: 0 },
  'veo-3.0-generate-001': { in: 0, out: 0.40, context: 0 },
  'veo-3.0-fast-generate-001': { in: 0, out: 0.15, context: 0 },
  'veo-2.0-generate-001': { in: 0, out: 0.35, context: 0 },

  // --- Other Gemini-related Models ---
  'gemini-embedding-001': { in: 0.15, out: 0.00, context: 2048 },
  'gemini-robotics-er-1.5-preview': { in: 0.30, out: 2.50, context: 1000000 },

  // --- Gemma Series (Free tier) ---
  'gemma-3': { in: 0.00, out: 0.00, context: 8192 },
  'gemma-3n': { in: 0.00, out: 0.00, context: 8192 },

  // --- OpenAI Future / New Models ---
  'gpt-5.1': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5-mini': { in: 0.25, out: 2.00, context: 128000 },
  'gpt-5-nano': { in: 0.05, out: 0.40, context: 16000 },
  'gpt-5.1-chat-latest': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5-chat-latest': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5.1-codex-max': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5.1-codex': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5-codex': { in: 1.25, out: 10.00, context: 128000 },
  'gpt-5-pro': { in: 15.00, out: 120.00, context: 128000 },
  'gpt-5.1-codex-mini': { in: 0.25, out: 2.00, context: 128000 },
  'gpt-5-search-api': { in: 1.25, out: 10.00, context: 128000 },
  
  'gpt-4.1': { in: 2.00, out: 8.00, context: 128000 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60, context: 128000 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40, context: 16000 },

  // --- OpenAI Models ---
  'gpt-4o': { in: 2.50, out: 10.00, context: 128000 },
  'gpt-4o-2024-05-13': { in: 5.00, out: 15.00, context: 128000 },
  'gpt-4o-mini': { in: 0.15, out: 0.60, context: 128000 },
  'gpt-4o-realtime-preview': { in: 5.00, out: 20.00, context: 128000 },
  'gpt-4o-mini-realtime-preview': { in: 0.60, out: 2.40, context: 128000 },
  'gpt-4o-audio-preview': { in: 2.50, out: 10.00, context: 128000 },
  'gpt-4o-mini-audio-preview': { in: 0.15, out: 0.60, context: 128000 },
  'gpt-4o-search-preview': { in: 2.50, out: 10.00, context: 128000 },
  'gpt-4o-mini-search-preview': { in: 0.15, out: 0.60, context: 128000 },

  'gpt-realtime': { in: 4.00, out: 16.00, context: 128000 },
  'gpt-realtime-mini': { in: 0.60, out: 2.40, context: 128000 },
  'gpt-audio': { in: 2.50, out: 10.00, context: 128000 },
  'gpt-audio-mini': { in: 0.60, out: 2.40, context: 128000 },

  'o1': { in: 15.00, out: 60.00, context: 128000 },
  'o1-pro': { in: 150.00, out: 600.00, context: 128000 },
  'o3-pro': { in: 20.00, out: 80.00, context: 128000 },
  'o3': { in: 2.00, out: 8.00, context: 128000 },
  'o3-deep-research': { in: 10.00, out: 40.00, context: 128000 },
  'o4-mini': { in: 1.10, out: 4.40, context: 128000 },
  'o4-mini-deep-research': { in: 2.00, out: 8.00, context: 128000 },
  'o3-mini': { in: 1.10, out: 4.40, context: 128000 },
  'o1-mini': { in: 1.10, out: 4.40, context: 128000 },
  
  'codex-mini-latest': { in: 1.50, out: 6.00, context: 128000 },
  'computer-use-preview': { in: 3.00, out: 12.00, context: 128000 },
  
  'gpt-image-1': { in: 5.00, out: 40.00, context: 128000 },
  'gpt-image-1-mini': { in: 2.00, out: 8.00, context: 128000 },

  // --- Other Providers ---
  'claude-opus-4.5': { in: 5.00, out: 25.00, context: 200000 },
  'claude-sonnet-4.5': { in: 3.00, out: 15.00, context: 200000 },
  'claude-haiku-4.5': { in: 1.00, out: 5.00, context: 200000 },
  'claude-3-opus-20240229': { in: 15.00, out: 75.00, context: 200000 },
  'claude-3-sonnet-20240229': { in: 3.00, out: 15.00, context: 200000 },
  'claude-3-haiku-20240307': { in: 0.25, out: 1.25, context: 200000 },
  'deepseek-chat': { in: 0.28, out: 0.42, context: 64000 },
  'deepseek-reasoner': { in: 0.28, out: 0.42, context: 64000 },
  'gemini-1.5-pro': { in: 1.25, out: 5.00, context: 2000000 },
  'gemini-1.5-flash': { in: 0.075, out: 0.30, context: 1000000 },
  'gemini-2.0-flash-exp': { in: 0, out: 0, context: 1000000 },
  'grok-4-1-fast-reasoning': { in: 0.20, out: 0.50, context: 128000 },
  'grok-4-1-fast-non-reasoning': { in: 0.20, out: 0.50, context: 128000 },
  'grok-code-fast-1': { in: 0.20, out: 1.50, context: 128000 },
  'grok-4-fast-reasoning': { in: 0.20, out: 0.50, context: 128000 },
  'grok-4-fast-non-reasoning': { in: 0.20, out: 0.50, context: 128000 },
  'grok-4-0709': { in: 3.00, out: 15.00, context: 128000 },
  'grok-3-mini': { in: 0.30, out: 0.50, context: 128000 },
  'grok-3': { in: 3.00, out: 15.00, context: 128000 },
  'grok-2-vision-1212': { in: 2.00, out: 10.00, context: 32768 },
  'grok-2-1212': { in: 2.00, out: 10.00, context: 32768 },
};

export function getPriceString(modelId: string): string {
  // 1. Точное совпадение
  let price = MODEL_PRICING[modelId];
  
  // 2. Поиск по вхождению (longest match wins)
  if (!price) {
      const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
      const key = keys.find(k => modelId.includes(k));
      if (key) price = MODEL_PRICING[key];
  }

  if (price) {
    return `($${price.in}/$${price.out})`;
  }
  return '';
}

export function getModelInfo(modelId: string): ModelPrice | undefined {
    // 1. Точное совпадение
    if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];

    // 2. Поиск по вхождению (longest match wins)
    const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
    const key = keys.find(k => modelId.includes(k));
    return key ? MODEL_PRICING[key] : undefined;
}

export function updatePricing(newPricing: Record<string, ModelPrice>) {
    Object.assign(MODEL_PRICING, newPricing);
}
