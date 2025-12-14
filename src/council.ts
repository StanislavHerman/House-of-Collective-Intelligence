// Совет — координация провайдеров
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from './config.js';
import { HistoryManager } from './history.js';
import { sendToProvider, estimateTokens } from './providers.js';
import { ProviderResponse, AgentConfig, AgentStats } from './types.js';
import { ToolManager, TOOLS_DEF } from './tools.js';
import { MODEL_PRICING, getModelInfo } from './pricing.js';
import { t } from './i18n.js';

export interface AskResult {
  councilResponses: ProviderResponse[];
  chairResponse: ProviderResponse | null;
}

export class Council {
  private tools = new ToolManager();
  private stats: Record<string, AgentStats> = {};
  private statsFile = path.join(os.homedir(), '.council-ai', 'stats.json');

  constructor(
    private config: ConfigManager,
    private history: HistoryManager
  ) {
      this.loadStats();
  }

  private loadStats() {
      try {
          if (fs.existsSync(this.statsFile)) {
              const data = fs.readFileSync(this.statsFile, 'utf8');
              this.stats = JSON.parse(data);
          }
      } catch (e) {
          // ignore
      }
  }

  private saveStats() {
      try {
          const dir = path.dirname(this.statsFile);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2));
      } catch (e) {
          // ignore
      }
  }

  async cleanup() {
      await this.tools.close();
  }

  resetStats() {
      this.stats = {};
      this.saveStats();
  }

  getStats(agentId: string): AgentStats {
      if (!this.stats[agentId]) {
          this.stats[agentId] = {
              totalSuggestions: 0,
              acceptedSuggestions: 0,
              partiallyAcceptedSuggestions: 0,
              rejectedSuggestions: 0
          };
      }
      return this.stats[agentId];
  }

  updateAgentStats(agentId: string, result: 'accepted' | 'partial' | 'rejected') {
      const s = this.getStats(agentId);
      s.totalSuggestions++;
      if (result === 'accepted') s.acceptedSuggestions++;
      if (result === 'partial') s.partiallyAcceptedSuggestions++;
      if (result === 'rejected') s.rejectedSuggestions++;
      this.saveStats();
  }

  getGlobalEfficiency(): number {
      let total = 0;
      let score = 0;
      
      Object.values(this.stats).forEach(s => {
          total += s.totalSuggestions;
          score += s.acceptedSuggestions + (s.partiallyAcceptedSuggestions * 0.5);
      });
      
      if (total === 0) return 100; // Default happy
      return Math.round((score / total) * 100);
  }

  async ask(
    question: string, 
    onProgress?: (msg: string) => void, 
    signal?: AbortSignal,
    onCouncilResponse?: (res: ProviderResponse) => void
  ): Promise<AskResult> {
    const COUNCIL_SYSTEM_PROMPT = t('sys_council');

    const allAgents = this.config.getAgents();
    const enabledAgents = allAgents.filter(a => a.enabled);
    const currentChairAgentId = this.config.getChairId();
    const currentSecretaryId = this.config.getSecretaryId();

    let chairAgent: AgentConfig | undefined = enabledAgents.find((a: AgentConfig) => a.id === currentChairAgentId);
    if (!chairAgent && enabledAgents.length > 0) chairAgent = enabledAgents[0];

    // Secretary should NOT be part of the active council voting
    const councilMembers = enabledAgents.filter((a: AgentConfig) => a.id !== chairAgent!.id && a.id !== currentSecretaryId);

    let chairSystemPromptText = t('sys_chair');
    if (councilMembers.length > 0) {
        chairSystemPromptText += " " + t('sys_chair_council_suffix');
    }
    // Опираемся на контекстное окно Председателя
    if (this.config.getAutoCompact() && chairAgent) {
        const modelPrice = getModelInfo(chairAgent.model);
        // Если модель неизвестна, берем консервативный лимит 128k, иначе используем реальный лимит
        const contextLimit = modelPrice?.context || 128000;
        const safeLimit = Math.floor(contextLimit * 0.8); // 80% заполненности - пора чистить

        const msgs = this.history.getMessages();
        let totalTokens = 0;
        for (const m of msgs) totalTokens += estimateTokens(m.text) + (m.images?.length || 0) * 1000;

        if (totalTokens > safeLimit) {
            // Нужно чистить. Оставляем 50% от лимита (удаляем старое)
            const targetTokens = Math.floor(contextLimit * 0.5);
            let currentTokens = totalTokens;
            let keepCount = msgs.length;

            // Идем с начала (старые сообщения) и "выкидываем" их из подсчета, пока не влезем
            for (let i = 0; i < msgs.length; i++) {
                const msgTokens = estimateTokens(msgs[i].text) + (msgs[i].images?.length || 0) * 1000;
                currentTokens -= msgTokens;
                keepCount--;
                if (currentTokens <= targetTokens) {
                    break;
                }
            }
            
            // Защита: оставляем хотя бы 5 последних сообщений
            keepCount = Math.max(keepCount, 5);
            
            // Calculate actual tokens remaining
            let remainingTokens = 0;
            const keptMsgs = msgs.slice(-keepCount);
            for (const m of keptMsgs) remainingTokens += estimateTokens(m.text) + (m.images?.length || 0) * 1000;

            this.history.compact(keepCount);
            if (onProgress) {
                onProgress(`${t('compact_auto')} [${chairAgent.model} / Limit: ${contextLimit}]`);
                onProgress(`Tokens: ${totalTokens} -> ~${remainingTokens}. Msgs: ${msgs.length} -> ${keepCount} (Removed ${msgs.length - keepCount})`);
            }
        }
    }

    // Сохраняем вопрос
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const detectedImages: string[] = [];
    
    // Helper to try load image
    const tryLoadImage = (p: string): string | null => {
        try {
            // Handle ~ expansion
            if (p.startsWith('~/')) {
                p = path.join(os.homedir(), p.slice(2));
            }
            
            // Handle escaped spaces (terminal drag & drop often escapes spaces)
            // But only if the file doesn't exist as is (some paths might actually have backslashes?)
            // Usually terminal produces "path\ to\ file.png".
            // We can try both.
            
            let targetPath = p;
            if (!fs.existsSync(targetPath)) {
                const unescaped = p.replace(/\\ /g, ' ');
                if (fs.existsSync(unescaped)) targetPath = unescaped;
            }

            if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                if (stat.isFile() && imageExtensions.includes(path.extname(targetPath).toLowerCase())) {
                    const bitmap = fs.readFileSync(targetPath);
                    return bitmap.toString('base64');
                }
            }
        } catch (e) {
            // ignore
        }
        return null;
    };

    // 1. Check strict path (entire trimmed input)
    let potentialPath = question.trim();
    // Remove wrapping quotes if present
    if ((potentialPath.startsWith('"') && potentialPath.endsWith('"')) || 
        (potentialPath.startsWith("'") && potentialPath.endsWith("'"))) {
        potentialPath = potentialPath.slice(1, -1);
    }
    
    const imgFromFull = tryLoadImage(potentialPath);
    if (imgFromFull) {
        detectedImages.push(imgFromFull);
    } else {
        // 2. Scan for paths in text
        // Look for typical file paths
        // Regex for absolute paths or paths starting with ~
        // We match non-whitespace chars, allowing escaped spaces
        // This is tricky regex.
        // Let's try simpler: split by quotes or assume paths are clearly delimited.
        
        // Naive regex for paths ending in extensions
        const regex = /(?:^|\s)(['"]?)((\/|~)[^\n\r]*?\.(?:png|jpg|jpeg|gif|webp))\1/gi;
        let match;
        while ((match = regex.exec(question)) !== null) {
             const capturedPath = match[2];
             const img = tryLoadImage(capturedPath.trim());
             if (img) detectedImages.push(img);
        }
    }

    this.history.add({
      role: 'user',
      text: question,
      timestamp: Date.now(),
      images: detectedImages.length > 0 ? detectedImages : undefined
    });

    if (enabledAgents.length === 0) {
      return {
        councilResponses: [],
        chairResponse: {
          providerId: 'system',
          model: '',
          text: 'Нет активных агентов. Используйте /agents для создания команды.',
          error: 'No active agents'
        }
      };
    }

    // TS Guard: chairAgent must be defined if enabledAgents > 0
    if (!chairAgent) {
        // Should logically never happen if logic above is correct
        chairAgent = enabledAgents[0];
    }

    if (signal?.aborted) throw new Error('Aborted');

    // --- INTEGRATION: Persistent Memory ---
    const memoryFile = path.resolve(process.cwd(), '.council_memory.md');
    let memoryInstruction = "";
    if (fs.existsSync(memoryFile)) {
        try {
            const memoryContent = fs.readFileSync(memoryFile, 'utf8');
            chairSystemPromptText += `\n\n=== ДОЛГОВРЕМЕННАЯ ПАМЯТЬ ПРОЕКТА (.council_memory.md) ===\n${memoryContent}\n==========================================================\n`;
            memoryInstruction = `\n[СИСТЕМА ПАМЯТИ]: Ты управляешь файлом .council_memory.md.\nТвоя задача — хранить там контекст, чтобы не терять нить разговора.\nПРАВИЛА ОБНОВЛЕНИЯ (ЗОНИРОВАНИЕ):\n1. РАЗДЕЛЯЙ: Держи в файле две зоны:\n   - ## 🛡 КОНТЕКСТ (Пути, Стек, Глобальные правила) — эту часть НЕ УДАЛЯЙ и НЕ СОКРАЩАЙ, если пользователь не просил. Это база.\n   - ## ⚡️ ОПЕРАТИВНОЕ (Текущая задача, Прогресс, Проблемы) — эту часть АКТУАЛИЗИРУЙ. Удаляй сделанное, пиши статус текущего.\n2. ПЕРЕЗАПИСЬ: При обновлении читай текущий файл, сохраняй "Щит", обновляй "Оперативное" и перезаписывай файл целиком.\n3. ОБЪЕМ: Ориентируйся на ~150 строк. Этого достаточно для всего важного. Не пиши поэмы, пиши факты.`;
        } catch (e) {
            console.error("Failed to read memory file:", e);
        }
    } else {
        // Если файла нет, предлагаем его создать при необходимости
        memoryInstruction = `\n[СИСТЕМА ПАМЯТИ]: Файл .council_memory.md пока пуст. Если появится важный контекст (стек, задача, правила), создай его. Используй структуру: "## 🛡 КОНТЕКСТ" и "## ⚡️ ОПЕРАТИВНОЕ".`;
    }
    chairSystemPromptText += memoryInstruction;
    // -------------------------------------

    const CHAIR_SYSTEM_PROMPT = chairSystemPromptText + `\n\n${TOOLS_DEF}\n\nФОРМАТ ВЫЗОВА ИНСТРУМЕНТОВ (строго соблюдай MARKDOWN блоки):\n   \n   1. Выполнить команду (bash):\n   \`\`\`bash\n   команда\n   \`\`\`\n   \n   2. Создать/записать файл:\n   \`\`\`file:путь/к/файлу\n   содержимое файла\n   \`\`\`\n   \n   3. Прочитать файл:\n   \`\`\`read:путь/к/файлу\`\`\`\n\n   4. Браузер (Интернет + Зрение):\n   \`\`\`browser:open url\`\`\`\n   \`\`\`browser:search query\`\`\`\n   \`\`\`browser:act action\`\`\`\n\n   5. Экран (macOS):\n   \`\`\`desktop:screenshot path.png\`\`\`\n   \`\`\`desktop:act action\`\`\`\n`;

    // 1. Опрашиваем Совет
    if (onProgress && councilMembers.length > 0) onProgress(`${t('council_asking')} (${councilMembers.length})...`);
    
    let councilResponses: ProviderResponse[] = [];
    if (councilMembers.length > 0) {
            const promises = councilMembers.map(async agent => {
              const apiKey = this.config.getApiKey(agent.providerType);
              const identityPrompt = `Ты — модель ${agent.model} от провайдера ${agent.providerType}. ${COUNCIL_SYSTEM_PROMPT}`;
              
              if (onProgress) onProgress(`${agent.name} (${agent.model}): ${t('thinking')}`);
              
              // Pass history without the last message (which is the current question), because 'question' is passed separately
              const historyWithoutCurrent = this.history.getMessages().slice(0, -1);
              const response = await sendToProvider(agent, apiKey || '', question, historyWithoutCurrent, identityPrompt, signal);
              
              if (onProgress) onProgress(`${agent.name} (${agent.model}): ${t('answer_received')}`);
              if (onCouncilResponse) onCouncilResponse(response);
              return response;
            });
            councilResponses = await Promise.all(promises);
    }

    if (signal?.aborted) throw new Error('Aborted');

    // 2. Формируем контекст для Председателя
    let contextForChair = `Запрос пользователя: "${question}"\n\n`;
    
    if (councilResponses.length > 0) {
      contextForChair += `--- МНЕНИЯ СОВЕТА ---\n`;
      councilResponses.forEach(r => {
         if (!r.error) {
           const agent = councilMembers.find(a => a.id === r.providerId);
           const name = agent ? `${agent.name} (ID: ${agent.id})` : r.providerId;
           
           let text = r.text;
           const MAX_AGENT_CHARS = 4000;
           if (text.length > MAX_AGENT_CHARS) {
               text = text.substring(0, MAX_AGENT_CHARS) + `\n... [обрезано, так как ответ слишком длинный] ...`;
           }

           contextForChair += `[${name}]: ${text}\n\n`;
         }
      });
      contextForChair += `---------------------\nИспользуй эти мнения для принятия решения. Ты не обязан соглашаться со всеми, но должен учитывать их экспертизу.\nТвоя задача — синтезировать ответ. Ссылайся на конкретных агентов, если используешь их идеи (например, "Как заметил Claude...").\n`;
    }
    
    if (onProgress) onProgress(`${t('chair_analyzing')} (${chairAgent.name})`);
    
    let promptSuffix = `\nДай финальный ответ и выполни действия при необходимости.`;
    if (councilMembers.length > 0) {
        promptSuffix += ` Не забудь блок оценки в конце!`;
    }
    
    let currentPrompt = contextForChair + promptSuffix;
    
    // --- TOOL EXECUTION LOOP ---
    // Председатель может вызывать инструменты в цикле, пока не решит задачу или не исчерпает лимит
    let finalChairResponse: ProviderResponse | null = null;
    let MAX_TURNS = 5; 
    let turn = 0;

    while (turn < MAX_TURNS) {
        if (signal?.aborted) throw new Error('Aborted');
        
        const chairApiKey = this.config.getApiKey(chairAgent.providerType);
        
        // Fix duplication: 
        // If turn == 0, the last message in history is the raw User Question. 
        // The 'currentPrompt' contains the User Question + Council Advice. 
        // So we slice history to avoid [User: Q, User: Q+Advice].
        //
        // If turn > 0, the last message is Tool Output. 
        // The 'currentPrompt' is "Continue". 
        // We MUST send the Tool Output, so we do NOT slice.
        let historyForRequest = this.history.getMessages();
        if (turn === 0) {
            historyForRequest = historyForRequest.slice(0, -1);
        }

        finalChairResponse = await sendToProvider(chairAgent, chairApiKey || '', currentPrompt, historyForRequest, CHAIR_SYSTEM_PROMPT, signal);

        // Парсим инструменты
        const toolsToRun = this.parseTools(finalChairResponse.text);
        
        if (toolsToRun.length === 0) {
            // Save final response to history
            this.history.add({
                role: 'assistant',
                text: finalChairResponse.text,
                timestamp: Date.now(),
                providerId: chairAgent.id
            });
            break; // Нет инструментов - это финальный ответ
        }
        
        // Выполняем инструменты
        let toolOutputMsg = `\n\n--- TOOL OUTPUTS (Turn ${turn + 1}) ---\n`;
        
        const currentImages: string[] = []; // Collect images from this turn
        const perms = this.config.getPermissions();
        
        if (onProgress) onProgress(`${t('tool_executing')} (${toolsToRun.length})...`);
        
        for (const tool of toolsToRun) {
            // Log specific tool action
            if (onProgress) {
                let toolName = '';
                let toolArg = tool.content;
                if (tool.type === 'command') toolName = t('tool_bash');
                if (tool.type === 'file') { toolName = t('tool_file_write'); toolArg = tool.arg; }
                if (tool.type === 'read') toolName = t('tool_file_read');
                if (tool.type === 'browser_open') toolName = t('tool_browser_open');
                if (tool.type === 'browser_search') toolName = t('tool_browser_search');
                if (tool.type === 'browser_act') toolName = t('tool_browser_act');
                if (tool.type === 'desktop_screenshot') toolName = t('tool_desktop_screenshot');
                if (tool.type === 'desktop_act') toolName = t('tool_desktop_act');

                const displayArg = toolArg.length > 50 ? toolArg.substring(0, 47) + '...' : toolArg;
                onProgress(`${toolName}: ${displayArg}`);
            }

            // Check Permissions
            if (tool.type === 'command' && !perms.allow_command) {
                toolOutputMsg += `Command: ${tool.content}\nError: Permission denied. User has disabled terminal commands in /settings.\n\n`;
                continue;
            }
            if (tool.type === 'file' && !perms.allow_file_write) {
                toolOutputMsg += `Write File: ${tool.arg}\nError: Permission denied. User has disabled file writing in /settings.\n\n`;
                continue;
            }
            if (tool.type === 'read' && !perms.allow_file_read) {
                toolOutputMsg += `Read File: ${tool.content}\nError: Permission denied. User has disabled file reading in /settings.\n\n`;
                continue;
            }
            if ((tool.type === 'browser_open' || tool.type === 'browser_search' || tool.type === 'browser_act') && !perms.allow_browser) {
                toolOutputMsg += `${tool.type}: ${tool.content}\nError: Permission denied. User has disabled browser access in /settings.\n\n`;
                continue;
            }
            if ((tool.type === 'desktop_screenshot' || tool.type === 'desktop_act') && !perms.allow_desktop) {
                toolOutputMsg += `${tool.type}: ${tool.content}\nError: Permission denied. User has disabled desktop control in /settings.\n\n`;
                continue;
            }

            if (tool.type === 'command') {
                const res = await this.tools.runCommand(tool.content);
                toolOutputMsg += `Command: ${tool.content}\nOutput: ${res.output}\nError: ${res.error || 'None'}\n\n`;
            } else if (tool.type === 'file') {
                const res = await this.tools.writeFile(tool.arg, tool.content);
                toolOutputMsg += `Write File: ${tool.arg}\nResult: ${res.output} ${res.error || ''}\n\n`;
            } else if (tool.type === 'read') {
                const res = await this.tools.readFile(tool.content);
                toolOutputMsg += `Read File: ${tool.content}\nContent:\n${res.output}\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'browser_open') {
                const res = await this.tools.browserOpen(tool.content);
                toolOutputMsg += `Browser Open: ${tool.content}\nContent: ${res.output.substring(0, 2000)}...\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'browser_search') {
                const res = await this.tools.browserSearch(tool.content);
                toolOutputMsg += `Browser Search: ${tool.content}\nResults:\n${res.output}\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'browser_act') {
                const res = await this.tools.browserAct(tool.content);
                toolOutputMsg += `Browser Act: ${tool.content}\nResult: ${res.output}\nError: ${res.error || ''}\n\n`;
                
                // If screenshot, load it as base64
                if (tool.content.startsWith('screenshot') && !res.error) {
                    try {
                        const parts = tool.content.trim().split(' ');
                        const p = parts[1];
                        if (p && fs.existsSync(p)) {
                            const bitmap = fs.readFileSync(p);
                            const base64 = bitmap.toString('base64');
                            currentImages.push(base64);
                            toolOutputMsg += `[SYSTEM]: Screenshot attached to context.\n`;
                        }
                    } catch (e) {
                        toolOutputMsg += `[SYSTEM]: Failed to attach screenshot: ${e}\n`;
                    }
                }
            } else if (tool.type === 'desktop_screenshot') {
                const res = await this.tools.desktopScreenshot(tool.content);
                toolOutputMsg += `Desktop Screenshot: ${tool.content}\nResult: ${res.output}\nError: ${res.error || ''}\n\n`;
                
                if (!res.error) {
                     try {
                        if (fs.existsSync(tool.content)) {
                            const bitmap = fs.readFileSync(tool.content);
                            const base64 = bitmap.toString('base64');
                            currentImages.push(base64);
                            toolOutputMsg += `[SYSTEM]: Desktop Screenshot attached to context.\n`;
                        }
                    } catch (e) {
                        toolOutputMsg += `[SYSTEM]: Failed to attach screenshot: ${e}\n`;
                    }
                }
            } else if (tool.type === 'desktop_act') {
                const res = await this.tools.desktopAct(tool.content);
                toolOutputMsg += `Desktop Act: ${tool.content}\nResult: ${res.output}\nError: ${res.error || ''}\n\n`;
            }
        }
        
        // Добавляем результат в историю для следующего шага
        this.history.add({
            role: 'assistant',
            text: finalChairResponse.text,
            timestamp: Date.now(),
            providerId: chairAgent.id
        });
        
        this.history.add({
            role: 'user', // Имитируем системный ответ как сообщение пользователя
            text: toolOutputMsg + "\nПродолжай выполнение задачи с учетом результатов инструментов.",
            timestamp: Date.now(),
            images: currentImages.length > 0 ? currentImages : undefined
        });
        
        // Обновляем промпт (хотя история уже содержит контекст, можно просто попросить продолжить)
        currentPrompt = "Продолжай."; 
        
        turn++;
    }
    
    // --- END LOOP ---

    if (!finalChairResponse) throw new Error("No response from chair");

    // Запуск Секретаря для оценки эффективности (если есть Секретарь и был Совет)
    if (currentSecretaryId && councilResponses.length > 0) {
        await this.evaluateEfficiency(currentSecretaryId, question, councilResponses, finalChairResponse.text, onProgress);
    }

    return { councilResponses, chairResponse: finalChairResponse };
  }

  private async evaluateEfficiency(
      secretaryId: string, 
      question: string, 
      councilResponses: ProviderResponse[], 
      chairAnswer: string,
      onProgress?: (msg: string) => void
  ) {
      const secretary = this.config.getAgent(secretaryId);
      if (!secretary) return;

      if (onProgress) onProgress(`📝 ${t('status_secretary')} analyzing efficiency...`);

      const apiKey = this.config.getApiKey(secretary.providerType);
      const chairId = this.config.getChairId();
      
      let prompt = `User Question: "${question}"\n\n`;
      prompt += `--- COUNCIL ADVICE ---\n`;
      councilResponses.forEach(r => {
          const agent = this.config.getAgent(r.providerId);
          const name = agent ? agent.name : r.providerId;
          prompt += `[ID: ${r.providerId}] ${name}: ${r.text.substring(0, 1000)}\n\n`;
      });
      prompt += `----------------------\n\n`;
      prompt += `--- CHAIRMAN (ID: ${chairId}) DECISION ---\n${chairAnswer.substring(0, 3000)}\n-------------------------\n`;
      prompt += `\nEvaluate usage of advice. Return strictly JSON.\n`;
      prompt += `IMPORTANT: Also evaluate the Chairman (ID: ${chairId})! If the final decision answers the user's question well, mark Chairman as "accepted". If it refuses or fails, "rejected".\n`;
      prompt += `You can also evaluate yourself (ID: ${secretaryId}) as "accepted" if this analysis process is working smoothly.`;

      try {
          const res = await sendToProvider(secretary, apiKey || '', prompt, [], t('sys_secretary'));
          
          let rawJson = res.text.trim();
          rawJson = rawJson.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
          const firstBrace = rawJson.indexOf('{');
          const lastBrace = rawJson.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              rawJson = rawJson.substring(firstBrace, lastBrace + 1);
          }

          const evalJson = JSON.parse(rawJson);
          let updateCount = 0;
          
          for (const [agentId, result] of Object.entries(evalJson)) {
              if (result === 'accepted' || result === 'partial' || result === 'rejected') {
                  this.updateAgentStats(agentId, result as any);
                  updateCount++;
              }
          }
          
          // Silently updated stats (User requested no output in chat)
          
      } catch (e: any) {
          if (onProgress) onProgress(`⚠️ Secretary error: ${e.message}`);
      }
  }

  private parseTools(text: string): { type: 'command' | 'file' | 'read' | 'browser_open' | 'browser_search' | 'browser_act' | 'desktop_screenshot' | 'desktop_act', content: string, arg: string }[] {
    const results: any[] = [];
    
    // Regex для bash
    const cmdRegex = /```bash\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = cmdRegex.exec(text)) !== null) {
      results.push({ type: 'command', content: match[1].trim(), arg: '' });
    }
    
    // Regex для file:path
    const fileRegex = /```file:(.*?)\s*([\s\S]*?)\s*```/g;
    while ((match = fileRegex.exec(text)) !== null) {
      results.push({ type: 'file', arg: match[1].trim(), content: match[2].trim() });
    }
    
    // Regex для read:path
    const readRegex = /```read:(.*?)\s*```/g;
    while ((match = readRegex.exec(text)) !== null) {
      results.push({ type: 'read', content: match[1].trim(), arg: '' });
    }
    
    // Regex для browser:open
    const bOpenRegex = /```browser:open\s*(.*?)\s*```/g;
    while ((match = bOpenRegex.exec(text)) !== null) {
      results.push({ type: 'browser_open', content: match[1].trim(), arg: '' });
    }

    // Regex для browser:act
    const bActRegex = /```browser:act\s*([\s\S]*?)\s*```/g;
    while ((match = bActRegex.exec(text)) !== null) {
      results.push({ type: 'browser_act', content: match[1].trim(), arg: '' });
    }
    
    // Regex для browser:search
    const bSearchRegex = /```browser:search\s*(.*?)\s*```/g;
    while ((match = bSearchRegex.exec(text)) !== null) {
      results.push({ type: 'browser_search', content: match[1].trim(), arg: '' });
    }
    
    // Regex for desktop:screenshot
    const dShotRegex = /```desktop:screenshot\s*(.*?)\s*```/g;
    while ((match = dShotRegex.exec(text)) !== null) {
      results.push({ type: 'desktop_screenshot', content: match[1].trim(), arg: '' });
    }

    // Regex for desktop:act
    const dActRegex = /```desktop:act\s*([\s\S]*?)\s*```/g;
    while ((match = dActRegex.exec(text)) !== null) {
      results.push({ type: 'desktop_act', content: match[1].trim(), arg: '' });
    }
    
    return results;
  }
}
