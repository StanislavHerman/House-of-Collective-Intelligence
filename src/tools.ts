import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { BrowserManager } from './browser.js';
import os from 'node:os';
import axios from 'axios';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const xcode = nodeRequire('xcode');

const execAsync = util.promisify(exec);

export interface ToolResult {
  output: string;
  error?: string;
}

export const TOOLS_DEF = `
Доступные инструменты (используй их, если нужно выполнить действие):

1. run_command
   - Описание: Выполнить команду оболочки (bash). Используй для git, установки пакетов, листинга файлов и т.д.
   - ВАЖНО: Команда \`cd <путь>\` меняет рабочую папку НАВСЕГДА для следующих команд.
   - ВАЖНО: Если команда требует ввода (интерактивная), используй pipe: \`echo "y" | command\`.
   - ВАЖНО: Для запуска в фоне (серверы) добавь \`&\` в конце: \`npm start &\`. Вернет PID.
   - Формат вызова: 
     \`\`\`bash
     <команда>
     \`\`\`

2. write_file
   - Описание: Создать или ПОЛНОСТЬЮ ПЕРЕЗАПИСАТЬ файл. Используй только для новых или маленьких файлов.
   - ВАЖНО: Ты должен использовать этот блок, чтобы файл реально создался.
   - Формат вызова:
     \`\`\`file:<путь/к/файлу>
     <содержимое>
     \`\`\`

3. edit_file (РЕКОМЕНДУЕТСЯ)
   - Описание: Заменить кусок текста в файле. Безопаснее, чем write_file.
   - Формат вызова:
     \`\`\`edit:<путь/к/файлу>
     <<<<<<< SEARCH
     старый код (копируй точно, с пробелами!)
     =======
     новый код
     >>>>>>>
     \`\`\`

4. read_file
   - Описание: Прочитать файл. Можно указать строки.
   - Формат вызова:
     \`\`\`read:<путь/к/файлу>\`\`\`
     ИЛИ
     \`\`\`read:<путь/к/файлу>:<строка_нач>-<строка_кон>\`\`\`

5. tree_view (РЕКОМЕНДУЕТСЯ)
   - Описание: Показать дерево файлов проекта (без мусора вроде node_modules). 
   - СТРАТЕГИЯ: Используй ПЕРЕД поиском, чтобы понять, где искать.
   - Формат вызова:
     \`\`\`tree:<путь/к/папке> (обычно .)\`\`\`

6. search_smart (РЕКОМЕНДУЕТСЯ)
   - Описание: Умный поиск текста по файлам (grep).
   - ВАЖНО: Ищет БУКВАЛЬНОЕ совпадение текста. Не понимает смысл.
   - СТРАТЕГИЯ: 
     1. Сначала \`tree_view\`, чтобы найти папку.
     2. Ищи точечно: \`search:init src/components/\`, а не \`search:init .\`.
     3. Избегай общих слов (init, map, data) без уточнения папки.
   - Формат вызова:
     \`\`\`search:<запрос> <папка>\`\`\`

7. browser_open
   - Описание: Открыть сайт в браузере и получить его текстовое содержимое.
   - Формат вызова:
     \`\`\`browser:open <url>\`\`\`

8. browser_search
   - Описание: Поиск в Google/DuckDuckGo.
   - Формат вызова:
     \`\`\`browser:search <запрос>\`\`\`

9. browser_act
   - Описание: Выполнить действие на текущей странице (type, click, screenshot).
   - Формат вызова:
     \`\`\`browser:act
     type <selector> <text>
     // ИЛИ
     click <selector>
     // ИЛИ
     screenshot <path>
     \`\`\`

10. desktop_screenshot
   - Описание: Сделать скриншот всего экрана монитора (macOS).
   - Формат вызова:
     \`\`\`desktop:screenshot <путь/к/файлу.png>\`\`\`

11. desktop_act
   - Описание: Управление клавиатурой (macOS). Полезно для ввода текста в открытые окна (например, Xcode).
   - Формат вызова:
     \`\`\`desktop:act type <текст>\`\`\`
     // ИЛИ
     \`\`\`desktop:act key <название_клавиши> (enter, return, tab, space, escape, backspace, left, right, up, down)\`\`\`

12. system_diagnostics
   - Описание: Запустить полную самодиагностику системы (файлы, shell, интернет, git).
   - Формат вызова:
     \`\`\`system_diagnostics\`\`\`

13. ios_config
   - Описание: Безопасное чтение/изменение настроек iOS проекта (.pbxproj).
   - Действия: list, get, set.
   - Формат вызова:
     \`\`\`ios:config list <путь/к/project.pbxproj>\`\`\`
     \`\`\`ios:config get <путь/к/project.pbxproj> <ключ> [target]\`\`\`
     \`\`\`ios:config set <путь/к/project.pbxproj> <ключ> <значение> [target]\`\`\`
`;

export class ToolManager {
  private browser = new BrowserManager();

  constructor(private cwd: string = process.cwd()) {}

  async close() {
      await this.browser.close();
  }

  // ... (existing methods: runDiagnostics, resolvePath, runCommand, writeFile, editFile, readFile, treeView, searchSmart, browserOpen, browserSearch, browserAct, desktopScreenshot, desktopAct) ...

  async iosConfig(argsString: string): Promise<ToolResult> {
      try {
          // Parse args: action projectPath [key] [value/target]
          // Simple space split might fail if path has spaces.
          // Let's assume standard shell-like args or simple splits for now.
          // Better: use regex to capture path.
          
          const args = argsString.trim().split(/\s+/);
          const action = args[0];
          const projectPath = args[1];
          
          if (!action || !projectPath) {
              return { output: '', error: 'Usage: ios:config <action> <project.pbxproj> [args...]' };
          }

          const targetFile = this.resolvePath(projectPath);
          if (!await fs.access(targetFile).then(() => true).catch(() => false)) {
               return { output: '', error: `Project file not found: ${targetFile}` };
          }

          const project = xcode.project(targetFile);
          
          // Promisify parse
          await new Promise<void>((resolve, reject) => {
              project.parse((err: any) => {
                  if (err) reject(err);
                  else resolve();
              });
          });

          if (action === 'list') {
              const targets = project.pbxNativeTargetSection();
              const configs = project.pbxXCBuildConfigurationSection();
              
              let report = `Targets:\n`;
              for (const key in targets) {
                  if (!key.endsWith('_comment')) {
                      report += ` - ${targets[key].name} (UUID: ${key})\n`;
                  }
              }
              
              report += `\nBuild Configurations:\n`;
              // This is raw, maybe just list configuration names?
              // Getting build config names is tricky structure traversing
              return { output: report };
          }

          if (action === 'get') {
              const key = args[2];
              if (!key) return { output: '', error: 'Missing key for get' };
              
              // getBuildProperty returns the value
              const val = project.getBuildProperty(key);
              return { output: `Value for ${key}: ${val}` };
          }

          if (action === 'set') {
              const key = args[2];
              const val = args[3];
              if (!key || val === undefined) return { output: '', error: 'Missing key or value for set' };
              
              project.updateBuildProperty(key, val);
              
              const newContent = project.writeSync();
              await fs.writeFile(targetFile, newContent);
              
              return { output: `Successfully set ${key} = ${val} in ${projectPath}` };
          }

          return { output: '', error: `Unknown action: ${action}` };

      } catch (e: any) {
          return { output: '', error: `iOS Config Error: ${e.message}` };
      }
  }


  async runDiagnostics(): Promise<ToolResult> {
      const report: string[] = [];
      report.push(`🔍 **System Diagnostics Report**`);
      report.push(`Time: ${new Date().toISOString()}`);
      report.push(`Platform: ${os.platform()} ${os.release()} (${os.arch()})`);
      report.push(`Node: ${process.version}`);
      report.push(`CWD: ${this.cwd}`);
      
      // 1. Filesystem & Edit Check (Comprehensive)
      const testDir = path.join(this.cwd, '.council_diag_tmp');
      const testFile = path.join(testDir, 'test.txt');
      
      try {
          // Cleanup prev if exists
          try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
          await fs.mkdir(testDir, { recursive: true });

          // A. Write
          await this.writeFile(testFile, 'Line 1\nLine 2\nLine 3');
          report.push(`✅ FS: Write OK`);

          // B. Edit (Fuzzy)
          const editRes = await this.editFile(testFile, 'Line 2', 'Line 2 EDITED');
          if (editRes.error) {
              report.push(`❌ FS: Edit Failed (${editRes.error})`);
          } else {
              report.push(`✅ FS: Edit OK`);
          }

          // C. Read & Verify
          const readRes = await this.readFile(testFile);
          if (readRes.output.includes('Line 2 EDITED')) {
              report.push(`✅ FS: Verify Content OK`);
          } else {
              report.push(`❌ FS: Verify Content Mismatch`);
          }

          // Cleanup
          await fs.rm(testDir, { recursive: true, force: true });
          
      } catch (e: any) {
          report.push(`❌ FS: Critical Error (${e.message})`);
      }
      
      // 2. Shell Check
    try {
        const res = await this.runCommand('echo "shell_ok"');
        if (res.output.includes('shell_ok')) {
            report.push(`✅ Shell (exec): OK`);
        } else {
            report.push(`❌ Shell: output mismatch`);
        }
    } catch (e: any) {
        report.push(`❌ Shell: Error (${e.message})`);
    }
    
    // 3. Internet Check
    try {
        await axios.get('https://www.google.com', { timeout: 5000 });
        report.push(`✅ Internet: OK`);
    } catch (e: any) {
         report.push(`⚠️ Internet: Unreachable or Timeout (${e.message})`);
    }
    
    // 4. Git Check
    try {
        const gitRes = await this.runCommand('git --version');
        if (!gitRes.error) {
            report.push(`✅ Git: Installed (${gitRes.output.trim()})`);
        } else {
            report.push(`⚠️ Git: Error (${gitRes.error})`);
        }
    } catch (e: any) {
        report.push(`⚠️ Git: Not found`);
    }

    return { output: report.join('\n') };
  }

  // Helper to resolve paths with ~ support
  private resolvePath(filePath: string): string {
      if (filePath.startsWith('~/')) {
          return path.join(os.homedir(), filePath.slice(2));
      }
      return path.resolve(this.cwd, filePath);
  }

  async runCommand(cmd: string, signal?: AbortSignal): Promise<ToolResult> {
    try {
      // Wrap command to persist directory changes
      let wrappedCmd = '';
      let shell = '';
      
      const isWindows = process.platform === 'win32';

      if (isWindows) {
          // PowerShell wrapper
          // We use ; as separator.
          // Get-Location returns the path object, we need the path string.
          wrappedCmd = `${cmd} ; Write-Host "__CWD__" ; (Get-Location).Path`;
          shell = 'powershell.exe';
      } else {
          // Mac/Linux wrapper
          // Use zsh on macOS for better compatibility (globbing etc), bash on Linux
          // Use ; instead of && to ensure CWD is captured even if command fails
          shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
          wrappedCmd = `${cmd}; echo "__CWD__"; pwd`;
      }
      
      // Infinite timeout (0) - rely on User Abort (signal)
      // Inject CI/Non-interactive env vars to prevent tools from waiting for input
      const env = {
          ...process.env,
          CI: 'true',
          GIT_TERMINAL_PROMPT: '0',
          DEBIAN_FRONTEND: 'noninteractive'
      };

      const { stdout, stderr } = await execAsync(wrappedCmd, { 
          cwd: this.cwd, 
          shell, 
          timeout: 0, // No hard timeout
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer to prevent "stdout maxBuffer exceeded"
          env,
          signal // Pass abort signal
      });
      
      let output = stdout;
      let newCwd = this.cwd;
      
      // Parse output for CWD marker
      if (output.includes('__CWD__')) {
          const lines = output.split(/\r?\n/); // Handle Windows CRLF
          const markerIndex = lines.lastIndexOf('__CWD__');
          if (markerIndex !== -1 && markerIndex + 1 < lines.length) {
              const possibleCwd = lines[markerIndex + 1].trim();
              if (possibleCwd) {
                  newCwd = possibleCwd;
                  // Remove the marker and pwd output from displayed result
                  output = lines.slice(0, markerIndex).join('\n');
              }
          }
      }

      this.cwd = newCwd;

      if (stderr) {
          output += (output ? '\n--- STDERR ---\n' : '') + stderr;
      }
      
      return { output: output || '' }; 
    } catch (error: any) {
      // Check for timeout kill or abort
      if (error.signal === 'SIGTERM' || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
          return { output: '', error: 'Command aborted by user.' };
      }
      
      let errorMsg = error.message;
      if (error.code) {
          errorMsg += ` (Exit Code: ${error.code})`;
      }
      
      return { output: error.stdout || '', error: errorMsg + (error.stderr ? '\nSTDERR: ' + error.stderr : '') };
    }
  }

  // Helper to parse JSON allowing comments (JSONC)
  private parseJSON(text: string): any {
      // Strip comments: // ... and /* ... */
      // Be careful not to strip // inside strings
      // Regex: Replace strings with themselves, capture comments to empty string
      const json = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, c) => c ? "" : m);
      return JSON.parse(json);
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const target = this.resolvePath(filePath);
      
      // Check if target exists and is a directory
      try {
          const stat = await fs.stat(target);
          if (stat.isDirectory()) {
              return { output: '', error: `Error: The path '${filePath}' is a directory, not a file. Please specify a filename (e.g. ${filePath}/filename.ext).` };
          }
      } catch (e) {
          // File does not exist, which is good
      }

      await fs.mkdir(path.dirname(target), { recursive: true });

      // Safety: Validate JSON before writing
      if (target.endsWith('.json')) {
          try {
              this.parseJSON(content);
          } catch (e: any) {
              return { output: '', error: `Write failed: Invalid JSON content. ${e.message}` };
          }
      }

      await fs.writeFile(target, content);
      return { output: `File saved to ${filePath}` };
    } catch (error: any) {
      return { output: '', error: `Write failed: ${error.message}` };
    }
  }

  async editFile(filePath: string, search: string, replace: string): Promise<ToolResult> {
      try {
          const target = this.resolvePath(filePath);
          const content = await fs.readFile(target, 'utf8');
          
          // 1. Try Exact Match
          if (content.includes(search)) {
              const newContent = content.replace(search, replace);
              
              // Safety: Validate JSON
              if (target.endsWith('.json')) {
                  try {
                      this.parseJSON(newContent);
                  } catch (e: any) {
                      return { output: '', error: `Edit failed: Resulting content is invalid JSON. ${e.message}` };
                  }
              }

              await fs.writeFile(target, newContent);
              return { output: `Successfully edited ${filePath} (Exact Match)` };
          }

          // 2. Try Line-by-Line Fuzzy Match (Ignore indentation/whitespace differences)
          const contentLines = content.split(/\r?\n/);
          
          // Normalize helper: collapse internal whitespace to single space
          const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');
          
          const searchLines = search.split(/\r?\n/)
              .map(l => normalize(l))
              .filter(l => l.length > 0);
          
          if (searchLines.length === 0) {
             return { output: '', error: `Search block is empty or whitespace only.` };
          }

          let matchIndex = -1;
          let matchLength = 0;

          // Scan content lines
          for (let i = 0; i < contentLines.length; i++) {
              // Optimistic check: does this line match the first search line?
              if (normalize(contentLines[i]) === searchLines[0]) {
                  // Potential match start. Verify subsequent lines.
                  let isMatch = true;
                  let searchIdx = 1;
                  let contentIdx = i + 1;
                  
                  while (searchIdx < searchLines.length) {
                      if (contentIdx >= contentLines.length) {
                          isMatch = false;
                          break;
                      }
                      
                      // Skip empty lines in content if search block skips them
                      const cLineNorm = normalize(contentLines[contentIdx]);
                      if (cLineNorm === '') {
                          contentIdx++;
                          continue; // Skip empty lines in file
                      }
                      
                      if (cLineNorm !== searchLines[searchIdx]) {
                          isMatch = false;
                          break;
                      }
                      searchIdx++;
                      contentIdx++;
                  }
                  
                  if (isMatch) {
                      matchIndex = i;
                      matchLength = contentIdx - i; // Number of lines in content to replace
                      break;
                  }
              }
          }

          if (matchIndex !== -1) {
              // Found fuzzy match!
              // Replace lines [matchIndex, matchIndex + matchLength) with 'replace'
              // We just insert the raw 'replace' string.
              // Note: This replaces the entire block of lines.
              
              const before = contentLines.slice(0, matchIndex).join('\n');
              const after = contentLines.slice(matchIndex + matchLength).join('\n');
              
              // Handle newline gluing
              const newContent = (before ? before + '\n' : '') + replace + (after ? '\n' + after : '');
              
              // Safety: Validate JSON
              if (target.endsWith('.json')) {
                  try {
                      this.parseJSON(newContent);
                  } catch (e: any) {
                      return { output: '', error: `Edit failed: Resulting content is invalid JSON. ${e.message}` };
                  }
              }

              await fs.writeFile(target, newContent);
              return { output: `Successfully edited ${filePath} (Fuzzy Match)` };
          }

          return { output: '', error: `Search string not found in ${filePath}. Tried exact match and fuzzy line match.` };
      } catch (error: any) {
          return { output: '', error: `Edit failed: ${error.message}` };
      }
  }

  async readFile(filePath: string, startLine?: number, endLine?: number): Promise<ToolResult> {
    try {
      const target = this.resolvePath(filePath);
      const stats = await fs.stat(target);
      
      // Limit size to 100KB to prevent context explosion
      if (stats.size > 100 * 1024 && !startLine) {
          return { 
              output: '', 
              error: `File is too large (${Math.round(stats.size/1024)}KB). Please read specific lines using 'read:path:start-end' format (e.g. read:file.txt:1-50).` 
          };
      }

      const content = await fs.readFile(target, 'utf8');
      
      if (startLine && endLine) {
          const lines = content.split('\n');
          // 1-based indexing for user convenience
          const slice = lines.slice(startLine - 1, endLine).join('\n');
          return { output: slice };
      }

      return { output: content };
    } catch (error: any) {
      return { output: '', error: error.message };
    }
  }

  async treeView(dirPath: string = '.', depth: number = 2): Promise<ToolResult> {
      try {
          const root = this.resolvePath(dirPath);
          let output = '';
          
          const walk = async (currentPath: string, currentDepth: number, prefix: string) => {
              if (currentDepth > depth) return;
              
              const entries = await fs.readdir(currentPath, { withFileTypes: true });
              // Filter out node_modules, .git, etc.
              const filtered = entries.filter(e => !['node_modules', '.git', '.DS_Store', 'dist', 'build', 'coverage'].includes(e.name));
              
              for (let i = 0; i < filtered.length; i++) {
                  const entry = filtered[i];
                  const isLast = i === filtered.length - 1;
                  const marker = isLast ? '└── ' : '├── ';
                  const subPrefix = isLast ? '    ' : '│   ';
                  
                  output += `${prefix}${marker}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
                  
                  if (entry.isDirectory()) {
                      await walk(path.join(currentPath, entry.name), currentDepth + 1, prefix + subPrefix);
                  }
              }
          };
          
          output += `${path.basename(root)}/\n`;
          await walk(root, 1, '');
          
          return { output: output || '(empty directory)' };
      } catch (e: any) {
          return { output: '', error: `Tree failed: ${e.message}` };
      }
  }

  async searchSmart(query: string, dirPath: string = '.'): Promise<ToolResult> {
      try {
          const safeQuery = query.replace(/"/g, '\\"');
          
          // 1. Try git grep first (It's lightning fast and respects .gitignore)
          // We check if we are in a git repo first
          const gitCheck = await this.runCommand('git rev-parse --is-inside-work-tree');
          if (!gitCheck.error && gitCheck.output.trim() === 'true') {
              // Use git grep
              // -I: ignore binary
              // -n: line number
              // --break: print empty line between matches from different files (optional)
              // --heading: print filename above matches (optional)
              const cmd = `git grep -In "${safeQuery}" "${dirPath}" | head -n 100`;
              const res = await this.runCommand(cmd);
              // Check for exit code 1 explicitly
              if (!res.error || (res.error && res.error.includes('(Exit Code: 1)'))) { 
                  if (res.output) return res;
                  return { output: 'No matches found (git grep).' };
              }
          }

          // 2. Fallback to standard grep with heavy excludes
          // Common heavy folders to ignore
          const ignoreDirs = [
              'node_modules', '.git', '.svn', '.hg',
              'dist', 'build', 'out', 'target', 'bin', 'obj',
              'coverage', '.cache', '.npm', '.yarn', '.pnpm',
              'Library', 'Applications', 'System', 'tmp', 'temp',
              'vendor', 'venv', '.env', '.venv', 'env'
          ];
          
          const excludeArgs = ignoreDirs.map(d => `--exclude-dir="${d}"`).join(' ');
          
          // -r: recursive
          // -I: ignore binary files
          // -n: line number
          // -H: print filename
          const cmd = `grep -rInH "${safeQuery}" ${excludeArgs} "${dirPath}" | head -n 100`; 
          
          const res = await this.runCommand(cmd);
          if (res.error && res.error.includes('(Exit Code: 1)')) {
              return { output: 'No matches found.' };
          }
          return res;
      } catch (e: any) {
          return { output: '', error: `Search failed: ${e.message}` };
      }
  }

  async browserOpen(url: string): Promise<ToolResult> {
      try {
          const content = await this.browser.navigate(url);
          return { output: content };
      } catch (error: any) {
          return { output: '', error: error.message };
      }
  }

  async browserSearch(query: string): Promise<ToolResult> {
      try {
          // Fast search using DuckDuckGo HTML (no Puppeteer)
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await axios.get(url, {
              headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
              },
              timeout: 10000
          });
          
          const html = res.data;
          // Simple regex scraping for results
          // Look for <a class="result__a" href="...">Title</a>
          const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
          
          let match;
          let results = '';
          let count = 0;
          
          while ((match = regex.exec(html)) !== null && count < 5) {
              let link = match[1];
              const title = match[2].replace(/<[^>]+>/g, '').trim(); // Strip HTML tags
              const snippet = match[3].replace(/<[^>]+>/g, '').trim();
              
              // Handle DDG redirects
              if (link.includes('duckduckgo.com/l/?uddg=')) {
                  try {
                      const urlObj = new URL(link.startsWith('http') ? link : `https://${link}`);
                      const uddg = urlObj.searchParams.get('uddg');
                      if (uddg) link = decodeURIComponent(uddg);
                  } catch {}
              }

              if (link && !link.includes('duckduckgo.com')) { // Filter internal links
                  results += `### ${title}\nURL: ${link}\n${snippet}\n\n`;
                  count++;
              }
          }
          
          if (!results) {
              // Fallback to Puppeteer if regex fails (DuckDuckGo changes layout)
              const content = await this.browser.search(query);
              return { output: content };
          }
          
          return { output: `Search Results for "${query}" (Fast Mode):\n\n${results}` };
      } catch (error: any) {
          // Fallback to Puppeteer on error (e.g. 403 Forbidden)
          try {
              const content = await this.browser.search(query);
              return { output: content };
          } catch (e: any) {
              return { output: '', error: `Search failed: ${error.message} -> ${e.message}` };
          }
      }
  }

  async browserAct(action: string): Promise<ToolResult> {
      try {
          const parts = action.trim().split(' ');
          const cmd = parts[0];
          
          if (cmd === 'type') {
              // type selector text...
              const selector = parts[1];
              const text = parts.slice(2).join(' ');
              const res = await this.browser.type(selector, text);
              return { output: res };
          }
          
          if (cmd === 'click') {
              const selector = parts[1];
              const res = await this.browser.click(selector);
              return { output: res };
          }
          
          if (cmd === 'screenshot') {
              const p = parts[1];
              const target = this.resolvePath(p); // Resolve screenshot path too
              const res = await this.browser.screenshot(target);
              return { output: res };
          }
          
          return { output: '', error: 'Unknown browser action' };
      } catch (error: any) {
          return { output: '', error: error.message };
      }
  }

  async desktopScreenshot(filePath: string): Promise<ToolResult> {
      try {
          const target = this.resolvePath(filePath);
          await fs.mkdir(path.dirname(target), { recursive: true });

          if (process.platform === 'darwin') {
              // macOS
              await execAsync(`screencapture -x "${target}"`);
          } else if (process.platform === 'win32') {
              // Windows (PowerShell + .NET)
              const psScript = `
              Add-Type -AssemblyName System.Windows.Forms
              Add-Type -AssemblyName System.Drawing
              $screen = [System.Windows.Forms.Screen]::PrimaryScreen
              $bitmap = New-Object System.Drawing.Bitmap $screen.Bounds.Width, $screen.Bounds.Height
              $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
              $graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size)
              $bitmap.Save("${target}", [System.Drawing.Imaging.ImageFormat]::Png)
              $graphics.Dispose()
              $bitmap.Dispose()
              `;
              await execAsync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);
          } else {
             return { output: '', error: 'Screenshot not supported on this OS' };
          }

          return { output: `Screenshot saved to ${filePath}` };
      } catch (error: any) {
          return { output: '', error: `Screenshot failed: ${error.message}` };
      }
  }

  async desktopAct(action: string): Promise<ToolResult> {
      try {
          const parts = action.trim().split(' ');
          const cmd = parts[0];
          
          if (process.platform === 'darwin') {
              // macOS Implementation
              if (cmd === 'type') {
                  const text = parts.slice(1).join(' ');
                  const safeText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
                  await execAsync(`osascript -e 'tell application "System Events" to keystroke "${safeText}"'`);
                  return { output: `Typed "${text}"` };
              }

              if (cmd === 'key') {
                  const key = parts[1].toLowerCase();
                  await execAsync(`osascript -e 'tell application "System Events" to key code ${this.getKeyCode(key)}'`);
                  return { output: `Pressed key ${key}` };
              }
          } else if (process.platform === 'win32') {
              // Windows Implementation (SendKeys)
              if (cmd === 'type') {
                  const text = parts.slice(1).join(' ');
                  // Escape special chars for SendKeys if needed, but basic text usually works
                  // SendKeys is finicky with some chars like +, ^, %, ~, (, )
                  // Minimal escaping:
                  const safeText = text.replace(/([+^%~(){}])/g, '{$1}');
                  const psScript = `
                  Add-Type -AssemblyName System.Windows.Forms
                  [System.Windows.Forms.SendKeys]::SendWait("${safeText}")
                  `;
                  await execAsync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);
                  return { output: `Typed "${text}"` };
              }
              
              if (cmd === 'key') {
                  let key = parts[1].toLowerCase();
                  // Map some keys to SendKeys format
                  const keyMap: Record<string, string> = {
                      'enter': '{ENTER}', 'return': '{ENTER}',
                      'tab': '{TAB}', 'space': ' ', 
                      'backspace': '{BACKSPACE}', 'delete': '{DELETE}',
                      'escape': '{ESC}', 'esc': '{ESC}',
                      'left': '{LEFT}', 'right': '{RIGHT}', 'up': '{UP}', 'down': '{DOWN}'
                  };
                  const sendKey = keyMap[key] || key;
                  const psScript = `
                  Add-Type -AssemblyName System.Windows.Forms
                  [System.Windows.Forms.SendKeys]::SendWait("${sendKey}")
                  `;
                  await execAsync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);
                  return { output: `Pressed key ${key}` };
              }
          }

          return { output: '', error: 'Unknown desktop action or OS not supported' };
      } catch (error: any) {
           return { output: '', error: error.message };
      }
  }

  private getKeyCode(key: string): number {
      const codes: Record<string, number> = {
          'return': 36, 'enter': 36,
          'tab': 48,
          'space': 49,
          'delete': 51, 'backspace': 51,
          'escape': 53, 'esc': 53,
          'left': 123, 'right': 124, 'down': 125, 'up': 126
      };
      return codes[key] || 0;
  }
}
