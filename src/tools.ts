import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { BrowserManager } from './browser.js';
import os from 'node:os';
import axios from 'axios';

const execAsync = util.promisify(exec);

export interface ToolResult {
  output: string;
  error?: string;
}

export const TOOLS_DEF = `
Доступные инструменты (используй их, если нужно выполнить действие):

1. run_command
   - Описание: Выполнить команду оболочки (bash). Используй для git, установки пакетов, листинга файлов и т.д.
   - Формат вызова: 
     \`\`\`bash
     <команда>
     \`\`\`

2. write_file
   - Описание: Создать или перезаписать файл.
   - ВАЖНО: Ты должен использовать этот блок, чтобы файл реально создался. Если ты просто напишешь код в чат, он НЕ сохранится.
   - Формат вызова:
     \`\`\`file:<путь/к/файлу>
     <содержимое>
     \`\`\`

3. read_file
   - Описание: Прочитать содержимое файла.
   - Формат вызова:
     \`\`\`read:<путь/к/файлу>\`\`\`

4. browser_open
   - Описание: Открыть сайт в браузере и получить его текстовое содержимое.
   - Формат вызова:
     \`\`\`browser:open <url>\`\`\`

5. browser_search
   - Описание: Поиск в Google/DuckDuckGo.
   - Формат вызова:
     \`\`\`browser:search <запрос>\`\`\`

6. browser_act
   - Описание: Выполнить действие на текущей странице (type, click, screenshot).
   - Формат вызова:
     \`\`\`browser:act
     type <selector> <text>
     // ИЛИ
     click <selector>
     // ИЛИ
     screenshot <path>
     \`\`\`

7. desktop_screenshot
   - Описание: Сделать скриншот всего экрана монитора (macOS).
   - Формат вызова:
     \`\`\`desktop:screenshot <путь/к/файлу.png>\`\`\`

8. desktop_act
   - Описание: Управление клавиатурой (macOS). Полезно для ввода текста в открытые окна (например, Xcode).
   - Формат вызова:
     \`\`\`desktop:act type <текст>\`\`\`
     // ИЛИ
     \`\`\`desktop:act key <название_клавиши> (enter, return, tab, space, escape, backspace, left, right, up, down)\`\`\`
`;

export class ToolManager {
  private browser = new BrowserManager();

  constructor(private cwd: string = process.cwd()) {}

  async close() {
      await this.browser.close();
  }

  // Helper to resolve paths with ~ support
  private resolvePath(filePath: string): string {
      if (filePath.startsWith('~/')) {
          return path.join(os.homedir(), filePath.slice(2));
      }
      return path.resolve(this.cwd, filePath);
  }

  async runCommand(cmd: string): Promise<ToolResult> {
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
          // Bash wrapper
          wrappedCmd = `${cmd} && echo "__CWD__" && pwd`;
          shell = '/bin/bash';
      }
      
      // 30s timeout for commands to prevent hanging
      const { stdout, stderr } = await execAsync(wrappedCmd, { cwd: this.cwd, shell, timeout: 30000 });
      
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
      // Check for timeout kill
      if (error.signal === 'SIGTERM') {
          return { output: '', error: 'Command timed out (30s limit). Process killed.' };
      }
      return { output: error.stdout || '', error: error.message + (error.stderr ? '\nSTDERR: ' + error.stderr : '') };
    }
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
      await fs.writeFile(target, content);
      return { output: `File saved to ${filePath}` };
    } catch (error: any) {
      return { output: '', error: `Write failed: ${error.message}` };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const target = this.resolvePath(filePath);
      const content = await fs.readFile(target, 'utf8');
      return { output: content };
    } catch (error: any) {
      return { output: '', error: error.message };
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
              const link = match[1];
              const title = match[2].replace(/<[^>]+>/g, '').trim(); // Strip HTML tags
              const snippet = match[3].replace(/<[^>]+>/g, '').trim();
              
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
