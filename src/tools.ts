import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { BrowserManager } from './browser.js';

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

  async runCommand(cmd: string): Promise<ToolResult> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: this.cwd });
      let output = stdout;
      if (stderr) {
          output += (output ? '\n--- STDERR ---\n' : '') + stderr;
      }
      return { output: output || '' }; 
    } catch (error: any) {
      return { output: error.stdout || '', error: error.message + (error.stderr ? '\nSTDERR: ' + error.stderr : '') };
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const target = path.resolve(this.cwd, filePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
      return { output: `File saved to ${filePath}` };
    } catch (error: any) {
      return { output: '', error: `Write failed: ${error.message}` };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const target = path.resolve(this.cwd, filePath);
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
          const content = await this.browser.search(query);
          return { output: content };
      } catch (error: any) {
          return { output: '', error: error.message };
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
              const res = await this.browser.screenshot(p);
              return { output: res };
          }
          
          return { output: '', error: 'Unknown browser action' };
      } catch (error: any) {
          return { output: '', error: error.message };
      }
  }

  async desktopScreenshot(filePath: string): Promise<ToolResult> {
      try {
          // macOS specific: screencapture -x (silent) <path>
          const target = path.resolve(this.cwd, filePath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await execAsync(`screencapture -x "${target}"`);
          return { output: `Screenshot saved to ${filePath}` };
      } catch (error: any) {
          return { output: '', error: `Screenshot failed: ${error.message}` };
      }
  }

  async desktopAct(action: string): Promise<ToolResult> {
      try {
          const parts = action.trim().split(' ');
          const cmd = parts[0];
          
          if (cmd === 'type') {
              // desktop:act type Hello World
              const text = parts.slice(1).join(' ');
              // Escape quotes for AppleScript
              const safeText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
              await execAsync(`osascript -e 'tell application "System Events" to keystroke "${safeText}"'`);
              return { output: `Typed "${text}"` };
          }

          if (cmd === 'key') {
              // desktop:act key enter
              const key = parts[1].toLowerCase();
              await execAsync(`osascript -e 'tell application "System Events" to key code ${this.getKeyCode(key)}'`);
              return { output: `Pressed key ${key}` };
          }

          return { output: '', error: 'Unknown desktop action' };
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
