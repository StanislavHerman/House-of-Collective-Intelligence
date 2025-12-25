// Совет — координация провайдеров
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from './config.js';
import { HistoryManager } from './history.js';
import { sendToProvider, estimateTokens } from './providers.js';
import { ProviderResponse, AgentConfig, AgentStats, CouncilEvent } from './types.js';
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

// ... methods ...

  public loadStats() {
      try {
          if (fs.existsSync(this.statsFile)) {
              const data = fs.readFileSync(this.statsFile, 'utf8');
              this.stats = JSON.parse(data);
          }
      } catch (e) {
          // ignore
      }
  }

  public saveStats() {
      try {
          const dir = path.dirname(this.statsFile);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2), { mode: 0o600 });
      } catch (e) {
          // ignore
      }
  }

  public async cleanup() {
      await this.tools.close();
  }

  public async runDiagnostics() {
      return await this.tools.runDiagnostics();
  }

  public resetStats() {
      this.stats = {};
      this.saveStats();
  }

  public getStats(agentId: string): AgentStats {
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

  public updateAgentStats(agentId: string, result: 'accepted' | 'partial' | 'rejected') {
      const s = this.getStats(agentId);
      s.totalSuggestions++;
      if (result === 'accepted') s.acceptedSuggestions++;
      if (result === 'partial') s.partiallyAcceptedSuggestions++;
      if (result === 'rejected') s.rejectedSuggestions++;
      this.saveStats();
  }

  public getGlobalEfficiency(): number {
      const s = Object.values(this.stats);
      const totalSuggestions = s.reduce((acc, curr) => acc + curr.totalSuggestions, 0);
      const acceptedSuggestions = s.reduce((acc, curr) => acc + curr.acceptedSuggestions, 0);
      return totalSuggestions > 0 ? (acceptedSuggestions / totalSuggestions) * 100 : 0;
  }

  async ask(
    question: string, 
    onProgress?: (event: CouncilEvent) => void, 
    signal?: AbortSignal,
    onCouncilResponse?: (res: ProviderResponse) => void
  ): Promise<AskResult> {
    const COUNCIL_SYSTEM_PROMPT = t('sys_council');

    const allAgents = this.config.getAgents();
    const enabledAgents = allAgents.filter(a => a.enabled);
    const currentChairAgentId = this.config.getChairId();
    const currentSecretaryId = this.config.getSecretaryId();
    const isCouncilActive = this.config.getCouncilActive();

    let chairAgent: AgentConfig | undefined = enabledAgents.find((a: AgentConfig) => a.id === currentChairAgentId);
    if (!chairAgent && enabledAgents.length > 0) chairAgent = enabledAgents[0];

    // Secretary should NOT be part of the active council voting
    // AND if Council is disabled globally, nobody should be voting
    const councilMembers = isCouncilActive 
        ? enabledAgents.filter((a: AgentConfig) => a.id !== chairAgent!.id && a.id !== currentSecretaryId)
        : [];

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
                onProgress({ 
                    type: 'info', 
                    message: `${t('compact_auto')} [${chairAgent.model}] (${totalTokens} -> ${remainingTokens})` 
                });
            }
        }
    }

    // Сохраняем вопрос
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const detectedImages: string[] = [];
    
    // Check permissions for implicit image loading
    if (this.config.getPermissions().allow_file_read) {
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
            // Minimal instruction: Read context, update if necessary. No forced zoning.
            memoryInstruction = `\n[СИСТЕМА ПАМЯТИ]: Файл .council_memory.md содержит контекст проекта. Поддерживай его в актуальном состоянии.`;
        } catch (e) {
            console.error("Failed to read memory file:", e);
        }
    } else {
        // Minimal create hint
        memoryInstruction = `\n[СИСТЕМА ПАМЯТИ]: Если нужно сохранить важный контекст на будущее, создай файл .council_memory.md.`;
    }
    chairSystemPromptText += memoryInstruction;
    // -------------------------------------

    const CHAIR_SYSTEM_PROMPT = chairSystemPromptText + `\n\n${TOOLS_DEF}\n\nФОРМАТ ВЫЗОВА ИНСТРУМЕНТОВ (строго соблюдай MARKDOWN блоки):\n   \n   1. Выполнить команду (bash):\n   \`\`\`bash\n   команда\n   \`\`\`\n   \n   2. Создать/записать файл:\n   \`\`\`file:путь/к/файлу\n   содержимое файла\n   \`\`\`\n   \n   3. Прочитать файл:\n   \`\`\`read:путь/к/файлу\`\`\`\n\n   4. Браузер (Интернет + Зрение):\n   \`\`\`browser:open url\`\`\`\n   \`\`\`browser:search query\`\`\`\n   \`\`\`browser:act action\`\`\`\n\n   5. Экран (macOS):\n   \`\`\`desktop:screenshot path.png\`\`\`\n   \`\`\`desktop:act action\`\`\`\n`;

    // 1. Опрашиваем Совет
    if (onProgress && councilMembers.length > 0) {
        onProgress({ type: 'step', message: `${t('council_asking')} (${councilMembers.length})...` });
    }
    
    let councilResponses: ProviderResponse[] = [];
    if (councilMembers.length > 0) {
            const promises = councilMembers.map(async agent => {
              const apiKey = this.config.getApiKey(agent.providerType);
              const identityPrompt = `Ты — модель ${agent.model} от провайдера ${agent.providerType}. ${COUNCIL_SYSTEM_PROMPT}`;
              
              // Pass CLEANED history without the last message to prevent pattern matching
              const historyWithoutCurrent = this.getCleanHistory().slice(0, -1);
              
              // Estimate tokens for logging
              let estimatedTokens = estimateTokens(identityPrompt) + estimateTokens(question);
              for (const m of historyWithoutCurrent) estimatedTokens += estimateTokens(m.text) + (m.images?.length || 0) * 1000;

              if (onProgress) onProgress({ type: 'agent_thinking', payload: { agent, estimatedTokens } });
              
              const startT = Date.now();
              const response = await sendToProvider(agent, apiKey || '', question, historyWithoutCurrent, identityPrompt, signal);
              const duration = ((Date.now() - startT) / 1000).toFixed(1);
              
              if (onProgress) onProgress({ type: 'agent_response', payload: { agent, duration } });
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
    
    if (onProgress) onProgress({ type: 'step', message: `${t('chair_analyzing')} (${chairAgent.name})` });
    
    let promptSuffix = `\nДай финальный ответ и выполни действия при необходимости.`;
    if (councilMembers.length > 0) {
        // Removed conflicting instruction about evaluation block
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
        
        let historyForRequest = this.getCleanHistory();
        
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
        
        if (onProgress) onProgress({ type: 'step', message: t('tool_executing'), payload: { count: toolsToRun.length } });
        
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
                onProgress({ type: 'tool_start', payload: { tool: toolName, input: displayArg } });
            }

            // Check Permissions
            if (tool.type === 'command' && !perms.allow_command) {
                toolOutputMsg += `Command: ${tool.content}\nError: Permission denied. User has disabled terminal commands in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (command)' });
                continue;
            }
            if (tool.type === 'file' && !perms.allow_file_write) {
                toolOutputMsg += `Write File: ${tool.arg}\nError: Permission denied. User has disabled file writing in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (write)' });
                continue;
            }
            if (tool.type === 'read' && !perms.allow_file_read) {
                toolOutputMsg += `Read File: ${tool.content}\nError: Permission denied. User has disabled file reading in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (read)' });
                continue;
            }
            if (tool.type === 'tree' && !perms.allow_file_read) {
                toolOutputMsg += `Tree View: ${tool.content}\nError: Permission denied. User has disabled file reading in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (read)' });
                continue;
            }
            if (tool.type === 'search' && (!perms.allow_file_read || !perms.allow_command)) {
                toolOutputMsg += `Smart Search: ${tool.content}\nError: Permission denied. Requires both 'Read Files' and 'Terminal' permissions.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (read/command)' });
                continue;
            }
            if ((tool.type === 'browser_open' || tool.type === 'browser_search' || tool.type === 'browser_act') && !perms.allow_browser) {
                toolOutputMsg += `${tool.type}: ${tool.content}\nError: Permission denied. User has disabled browser access in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (browser)' });
                continue;
            }
            if ((tool.type === 'desktop_screenshot' || tool.type === 'desktop_act') && !perms.allow_desktop) {
                toolOutputMsg += `${tool.type}: ${tool.content}\nError: Permission denied. User has disabled desktop control in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (desktop)' });
                continue;
            }
            if (tool.type === 'edit' && !perms.allow_file_edit) {
                toolOutputMsg += `Edit File: ${tool.arg}\nError: Permission denied. User has disabled file editing in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (edit)' });
                continue;
            }
            if (tool.type === 'system_diagnostics' && !perms.allow_command) {
                toolOutputMsg += `System Diagnostics\nError: Permission denied. User has disabled terminal commands in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (diagnostics)' });
                continue;
            }
            if (tool.type === 'ios_config' && !perms.allow_file_edit) {
                toolOutputMsg += `iOS Config: ${tool.content}\nError: Permission denied. User has disabled file editing in /settings.\n\n`;
                if (onProgress) onProgress({ type: 'error', message: 'Permission denied (ios_config)' });
                continue;
            }

            if (tool.type === 'command') {
                const res = await this.tools.runCommand(tool.content, signal);
                toolOutputMsg += `Command: ${tool.content}\nOutput: ${res.output}\nError: ${res.error || 'None'}\n\n`;
            } else if (tool.type === 'file') {
                const res = await this.tools.writeFile(tool.arg, tool.content);
                toolOutputMsg += `Write File: ${tool.arg}\nResult: ${res.output} ${res.error || ''}\n\n`;
            } else if (tool.type === 'edit') {
                // Parse SEARCH/REPLACE block
                const parts = tool.content.split('=======');
                if (parts.length === 2) {
                    const searchBlock = parts[0].replace('<<<<<<< SEARCH', '').trim();
                    const replaceBlock = parts[1].replace('>>>>>>>', '').trim();
                    const res = await this.tools.editFile(tool.arg, searchBlock, replaceBlock);
                    toolOutputMsg += `Edit File: ${tool.arg}\nResult: ${res.output} ${res.error || ''}\n\n`;
                } else {
                    toolOutputMsg += `Edit File: ${tool.arg}\nError: Invalid format. Must contain <<<<<<< SEARCH, =======, and >>>>>>> blocks.\n\n`;
                }
            } else if (tool.type === 'read') {
                // Parse optional line range: path:start-end
                const match = tool.content.match(/^(.*?):(\d+)-(\d+)$/);
                let res;
                if (match) {
                    const path = match[1];
                    const start = parseInt(match[2]);
                    const end = parseInt(match[3]);
                    res = await this.tools.readFile(path, start, end);
                } else {
                    res = await this.tools.readFile(tool.content);
                }
                
                toolOutputMsg += `Read File: ${tool.content}\nContent:\n${res.output}\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'tree') {
                const res = await this.tools.treeView(tool.content || '.');
                toolOutputMsg += `Tree View: ${tool.content}\nOutput:\n${res.output}\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'search') {
                // Parse query and path: "query" path OR query path
                let query = tool.content;
                let dir = '.';
                
                const trimmed = tool.content.trim();
                if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
                    const quote = trimmed[0];
                    const endQuote = trimmed.indexOf(quote, 1);
                    if (endQuote !== -1) {
                        query = trimmed.substring(1, endQuote);
                        const rest = trimmed.substring(endQuote + 1).trim();
                        if (rest) dir = rest;
                    }
                } else {
                    const firstSpace = trimmed.indexOf(' ');
                    if (firstSpace !== -1) {
                        query = trimmed.substring(0, firstSpace);
                        dir = trimmed.substring(firstSpace + 1).trim();
                    }
                }

                const res = await this.tools.searchSmart(query, dir);
                toolOutputMsg += `Smart Search: "${query}" in "${dir}"\nOutput:\n${res.output}\nError: ${res.error || ''}\n\n`;
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
            } else if (tool.type === 'system_diagnostics') {
                const res = await this.tools.runDiagnostics();
                toolOutputMsg += `System Diagnostics:\n${res.output}\nError: ${res.error || ''}\n\n`;
            } else if (tool.type === 'ios_config') {
                const res = await this.tools.iosConfig(tool.content);
                toolOutputMsg += `iOS Config:\n${res.output}\nError: ${res.error || ''}\n\n`;
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

    // Запуск Секретаря для оценки эффективности (если есть Секретарь, был Совет и режим Совета активен)
    if (isCouncilActive && currentSecretaryId && councilResponses.length > 0) {
        // Run in background (Fire and Forget) to not block user response
        this.evaluateEfficiency(currentSecretaryId, question, councilResponses, finalChairResponse.text, onProgress)
            .catch(err => console.error(`[Background] Secretary error: ${err.message}`));
    }

    return { councilResponses, chairResponse: finalChairResponse };
  }

  private getCleanHistory() {
      return this.history.getMessages().map(msg => {
          if (msg.role === 'assistant') {
              let text = msg.text;
              // Remove explicit blocks with AGGRESSIVE regex
              // Matches: 📊 (optional **) ЭФФЕКТИВНОСТЬ (optional **) СОВЕТА (optional :) ... rest of string
              const regexRu = /(\n\s*)?📊\s*(\*\*)?\s*ЭФФЕКТИВНОСТЬ\s+СОВЕТА.*$/is;
              const regexEn = /(\n\s*)?📊\s*(\*\*)?\s*COUNCIL\s+EFFICIENCY.*$/is;
              const regexEval = /(\n\s*)?📊\s*(\*\*)?\s*EVALUATION.*$/is;

              text = text.replace(regexRu, '');
              text = text.replace(regexEn, '');
              text = text.replace(regexEval, '');
              
              // Strip tool blocks to prevent repetition loops
              // Matches ```toolname ... ``` blocks
              const toolsRegex = /```\s*(?:bash|sh|zsh|command|shell|term|terminal|console|cmd|system_diagnostics|ios:config|edit|tree|search|file|read|browser:\w+|desktop:\w+)[\s\S]*?```/gi;
              text = text.replace(toolsRegex, '[Tool Executed]');

              return { ...msg, text };
          }
          return msg;
      });
  }

  private async evaluateEfficiency(
      secretaryId: string, 
      question: string, 
      councilResponses: ProviderResponse[], 
      chairAnswer: string,
      onProgress?: (event: CouncilEvent) => void
  ) {
      const secretary = this.config.getAgent(secretaryId);
      if (!secretary) return;

      if (onProgress) onProgress({ type: 'info', message: `📝 ${t('status_secretary')} analyzing efficiency...` });

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

      let rawJson = '';
      try {
          const res = await sendToProvider(secretary, apiKey || '', prompt, [], t('sys_secretary'));
          
          rawJson = res.text.trim();
          if (!rawJson) {
             console.warn(`[Secretary] Empty response from ${secretary.model}`);
             return;
          }

          // Try robust extraction
          let evalJson = this.extractJson(rawJson);
          
          // Fallback: simple parse if extraction returned nothing (maybe it's a flat number or array?)
          // But we expect Object.
          if (!evalJson) {
             // Try strict parse of the whole string as last resort
             try {
                 evalJson = JSON.parse(rawJson);
             } catch (e: any) {
                 console.warn(`[Secretary] Full invalid JSON: ${rawJson}`); 
                 throw new Error(`JSON Parse: ${e.message}`);
             }
          }

          let updateCount = 0;
          
          for (const [agentId, result] of Object.entries(evalJson)) {
              if (result === 'accepted' || result === 'partial' || result === 'rejected') {
                  this.updateAgentStats(agentId, result as any);
                  updateCount++;
              }
          }
          
          // Silently updated stats (User requested no output in chat)
          
      } catch (e: any) {
          const snippet = rawJson.length > 50 ? rawJson.substring(0, 50) + '...' : rawJson;
          if (onProgress) onProgress({ type: 'error', message: `⚠️ Secretary error: ${e.message} (Content: "${snippet}")` });
      }
  }

  private extractJson(text: string): any {
      let startIndex = text.indexOf('{');
      if (startIndex === -1) return null;

      let braceCount = 0;
      let inString = false;
      let escape = false;
      
      for (let i = startIndex; i < text.length; i++) {
          const char = text[i];
          
          if (escape) {
              escape = false;
              continue;
          }
          
          if (char === '\\') {
              escape = true;
              continue;
          }
          
          if (char === '"') {
              inString = !inString;
              continue;
          }
          
          if (!inString) {
              if (char === '{') {
                  braceCount++;
              } else if (char === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                      // Found complete object
                      const potentialJson = text.substring(startIndex, i + 1);
                      try {
                          return JSON.parse(potentialJson);
                      } catch (e) {
                          // If parse fails (e.g. bad control chars), we could keep looking, 
                          // but usually balanced braces mean we found the block.
                          // Return null to let fallback handle or fail.
                          return null;
                      }
                  }
              }
          }
      }
      return null;
  }

  public parseTools(text: string): { type: 'command' | 'file' | 'edit' | 'read' | 'tree' | 'search' | 'browser_open' | 'browser_search' | 'browser_act' | 'desktop_screenshot' | 'desktop_act' | 'system_diagnostics' | 'ios_config', content: string, arg: string }[] {
    const results: { type: any, content: string, arg: string, index: number }[] = [];
    
    // Regex для bash (command)
    // Allow ```bash or ```sh or just ```command or ``` bash or ```shell
    const cmdRegex = /```\s*(?:bash|sh|zsh|command|shell|term|terminal|console|cmd)\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = cmdRegex.exec(text)) !== null) {
      results.push({ type: 'command', content: match[1].trim(), arg: '', index: match.index });
    }

    // Regex для system_diagnostics
    const sysDiagRegex = /```\s*system_diagnostics\s*```/gi;
    while ((match = sysDiagRegex.exec(text)) !== null) {
        results.push({ type: 'system_diagnostics', content: '', arg: '', index: match.index });
    }

    // Regex для ios:config
    const iosConfigRegex = /```\s*ios:config\s*([\s\S]*?)\s*```/gi;
    while ((match = iosConfigRegex.exec(text)) !== null) {
        results.push({ type: 'ios_config', content: match[1].trim(), arg: '', index: match.index });
    }
    
    // Regex для edit:path
    // Allow: edit: path OR edit path
    // Force greedy match (.*) for path
    const editRegex = /```\s*edit[:\s]\s*(.*)\s*([\s\S]*?)\s*```/gi;
    while ((match = editRegex.exec(text)) !== null) {
        results.push({ type: 'edit', arg: match[1].trim(), content: match[2].trim(), index: match.index });
    }

    // Regex для tree:path
    // Allow: tree: path OR tree path OR tree\npath
    const treeRegex = /```\s*tree[:\s]?\s*([\s\S]*?)\s*```/gi;
    while ((match = treeRegex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content) results.push({ type: 'tree', content, arg: '', index: match.index });
    }

    // Regex для search:query
    const searchRegex = /```\s*search[:\s]?\s*([\s\S]*?)\s*```/gi;
    while ((match = searchRegex.exec(text)) !== null) {
        const content = match[1].trim();
        if (content) results.push({ type: 'search', content, arg: '', index: match.index });
    }

    // Regex для file:path
    // Force greedy match (.*) for path to prevent content group from eating it
    const fileRegex = /```\s*file[:\s]\s*(.*)\s*([\s\S]*?)\s*```/gi;
    while ((match = fileRegex.exec(text)) !== null) {
      results.push({ type: 'file', arg: match[1].trim(), content: match[2].trim(), index: match.index });
    }
    
    // Regex для read:path
    const readRegex = /```\s*read[:\s]?\s*([\s\S]*?)\s*```/gi;
    while ((match = readRegex.exec(text)) !== null) {
      const content = match[1].trim();
      if (content) results.push({ type: 'read', content, arg: '', index: match.index });
    }
    
    // Regex для browser:open
    const bOpenRegex = /```\s*browser:open[:\s]?\s*([\s\S]*?)\s*```/gi;
    while ((match = bOpenRegex.exec(text)) !== null) {
      results.push({ type: 'browser_open', content: match[1].trim(), arg: '', index: match.index });
    }

    // Regex для browser:act
    const bActRegex = /```\s*browser:act\s*([\s\S]*?)\s*```/gi;
    while ((match = bActRegex.exec(text)) !== null) {
      results.push({ type: 'browser_act', content: match[1].trim(), arg: '', index: match.index });
    }
    
    // Regex для browser:search
    const bSearchRegex = /```\s*browser:search\s*(.*?)\s*```/gi;
    while ((match = bSearchRegex.exec(text)) !== null) {
      results.push({ type: 'browser_search', content: match[1].trim(), arg: '', index: match.index });
    }
    
    // Regex for desktop:screenshot
    const dShotRegex = /```\s*desktop:screenshot\s*(.*?)\s*```/gi;
    while ((match = dShotRegex.exec(text)) !== null) {
      results.push({ type: 'desktop_screenshot', content: match[1].trim(), arg: '', index: match.index });
    }

    // Regex for desktop:act
    const dActRegex = /```\s*desktop:act\s*([\s\S]*?)\s*```/gi;
    while ((match = dActRegex.exec(text)) !== null) {
      results.push({ type: 'desktop_act', content: match[1].trim(), arg: '', index: match.index });
    }

    // SORT BY INDEX to preserve execution order
    results.sort((a, b) => a.index - b.index);

    // Debug Log found tools (commented out for cleaner UI)
    // if (results.length > 0) {
    //    console.log('[Parser] Raw tools found:', results.length, results.map(r => r.type));
    // } else if (text.includes('```')) {
    //    console.log('[Parser] Warning: Code blocks detected but no tools parsed. Check regex/format.');
    // }
    
    // Filter out obvious placeholders/examples
    return results.filter(r => {
        const p = (r.arg || r.content || '').toLowerCase();
        // Check filtering
        if (p.includes('path/to/') || p.includes('/path/to') || p === 'file.txt' || p === 'example.com') {
            // console.log(`[Parser] Filtered placeholder tool: ${r.type} ${p}`);
            return false;
        }
        // Also ignore if content is purely "..." (example block)
        if (r.content.trim() === '...') return false;
        
        return true;
    }).map(r => ({ type: r.type, content: r.content, arg: r.arg })); // Remove index from return
  }
}
