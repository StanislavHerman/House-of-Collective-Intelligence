// UI функции — меню, ввод
import { createInterface, emitKeypressEvents } from 'node:readline';
import { PassThrough } from 'node:stream';
import chalk from 'chalk';
import { t } from './i18n.js';

// Singleton Readline Interface
let rl: ReturnType<typeof createInterface> | null = null;
let pasteProxy: any = null; // Deprecated, but keeping var for cleanup if needed

export function initReadline() {
  if (rl) return;
  
  // Enable Bracketed Paste Mode
  process.stdout.write('\x1b[?2004h');

  // Ensure stdin is flowing
  process.stdin.resume();

  // Robust Paste Interceptor using emit monkey-patch
  // This is safer than _ttyWrite because it captures the raw stream
  const originalEmit = process.stdin.emit;
  let inPasteMode = false;
  let pasteBuffer = '';
  let pasteTimeout: any = null;

  (process.stdin as any).emit = function(event: string, ...args: any[]) {
      if (event === 'data' && args[0]) {
          const chunk = args[0].toString();
          
          // Detect Paste Start
          if (chunk.includes('\x1b[200~')) {
              inPasteMode = true;
              pasteBuffer = '';
              // If start tag is followed by content in same chunk
              const parts = chunk.split('\x1b[200~');
              // parts[0] is pre-paste, parts[1] is content
              if (parts[1]) {
                  pasteBuffer += parts[1];
              }
              
              // Set fallback timeout (if end tag never comes)
              if (pasteTimeout) clearTimeout(pasteTimeout);
              pasteTimeout = setTimeout(() => {
                  if (inPasteMode) {
                      inPasteMode = false;
                      // Flush what we have, stripping newlines just in case
                      const safe = pasteBuffer.replace(/(\r\n|\n|\r)/g, ' ');
                      (originalEmit as any).call(process.stdin, 'data', Buffer.from(safe));
                      pasteBuffer = '';
                  }
              }, 500); // 500ms max for a paste operation
              
              return true; // Stop propagation
          }

          // Detect Paste End
          if (inPasteMode) {
              if (chunk.includes('\x1b[201~')) {
                  inPasteMode = false;
                  if (pasteTimeout) clearTimeout(pasteTimeout);

                  const parts = chunk.split('\x1b[201~');
                  pasteBuffer += parts[0]; // Content before end tag
                  
                  // SANITIZE: Replace newlines with spaces to prevent immediate submit
                  const sanitized = pasteBuffer.replace(/(\r\n|\n|\r)/g, ' ');
                  
                  // Emit sanitized paste
                  (originalEmit as any).call(process.stdin, 'data', Buffer.from(sanitized));
                  
                  // Emit any post-paste content (rare but possible)
                  if (parts[1]) {
                      (originalEmit as any).call(process.stdin, 'data', Buffer.from(parts[1]));
                  }
                  
                  pasteBuffer = '';
                  return true;
              } else {
                  // Still inside paste, just buffer
                  pasteBuffer += chunk;
                  return true;
              }
          }
      }
      
      return originalEmit.apply(process.stdin, arguments as any);
  };

  rl = createInterface({
    input: process.stdin, 
    output: process.stdout,
    terminal: true,
    historySize: 200
  });

  // Handle global SIGINT only if we are NOT in a question callback
  // (question callback handles it locally)
  rl.on('SIGINT', () => {
      // If we are idle, just exit
      // If we are in a prompt, the prompt's listener handles it
  });
}

export function closeReadline() {
  if (rl) {
      // Disable Bracketed Paste Mode
      process.stdout.write('\x1b[?2004l');
      rl.close();
      rl = null;
  }
}

export async function askSmart(
  prompt: string, 
  onMenuTrigger: () => Promise<string | null>,
  statusCallback?: () => string
): Promise<string> {
  // Ensure we have an active readline interface
  if (!rl) initReadline();

  // Create a "Transient Prompt"
  // We will show: [Status] > Input
  // After Enter: > Input (Status removed from history)
  let displayPrompt = prompt;
  let statusStr = '';
  if (statusCallback) {
      statusStr = `[${statusCallback()}] `;
      displayPrompt = `${chalk.gray(statusStr)}${prompt}`;
  }

  return new Promise<string>((resolve, reject) => {
    // We handle SIGINT (Ctrl+C) specifically for the prompt
    const onSigInt = () => {
        rl?.close();
        rl = null;
        reject(new Error('SIGINT'));
    };

    rl?.on('SIGINT', onSigInt);

    // Dynamic '/' trigger for menu
    const onKeypress = async (str: string, key: any) => {
        if (!rl) return;

        const isSlash = str === '/' || (key && key.name === 'slash');
        
        // Readline might have already processed the key (since it binds listeners first)
        // So line might be empty OR it might already be "/"
        const isStart = rl.line.length === 0 || (rl.line === '/' && rl.cursor === 1);

        if (isSlash && isStart) {
            // Detach listeners immediately to prevent double-fire
            cleanup();
            
            // Close current RL to switch context
            rl.close();
            rl = null;

            // Clear the '/' that might have been echoed
            // Move cursor to start, clear line
            process.stdout.write('\r\x1B[K');

            // Trigger Menu
            const command = await onMenuTrigger();

            if (command) {
                resolve(command);
            } else {
                // Cancelled -> restart prompt
                resolve(await askSmart(prompt, onMenuTrigger, statusCallback));
            }
        }
    };

    // Attach keypress listener
    if (process.stdin.isTTY) {
        if (!(process.stdin as any).isKeypressEventsEmitted) {
            emitKeypressEvents(process.stdin);
        }
    }
    process.stdin.on('keypress', onKeypress);

    const cleanup = () => {
        rl?.removeListener('SIGINT', onSigInt);
        process.stdin.removeListener('keypress', onKeypress);
    };

    rl!.question(displayPrompt, (answer) => {
        cleanup();
        
        if (statusStr) {
            const width = process.stdout.columns || 80;
            // Calculate total length of prompt + answer
            // Note: strip ansi for length calculation
            const fullText = statusStr + prompt + answer;
            const cleanText = fullText.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
            
            // Calculate number of lines occupied
            // We need to account for terminal wrapping
            const rows = Math.ceil(cleanText.length / width) || 1;
            
            // Move up
            process.stdout.write(`\x1B[${rows}A`);
            // Clear everything below
            process.stdout.write('\x1B[J');
            // Print clean version
            console.log(`${prompt}${answer}`);
        }

        // Close readline to free up stdin for other parts of the app (like processPrompt)
        rl?.close();
        rl = null;
        
        resolve(answer);
    });
  });
}

export async function select<T>(
  title: string,
  items: { label: string; value: T }[]
): Promise<T | null> {
    // Reuse the simple ask approach for now or the previous implementation?
    // The previous implementation used raw mode manual handling which conflicts with readline.
    // Let's implement a simpler select using readline or robust raw mode switch.
    
    // To be safe against "glitches", we should PAUSE readline before going raw.
    if (rl) {
        rl.pause(); 
        // We don't close it, just pause it so it doesn't fight for stdin data
    }

    // ... (Use previous raw mode logic but ensure we resume RL after) ...
    // Actually, to fix the user's issue 100%, let's stick to standard input where possible.
    // But 'select' needs arrow keys.
    
    // Let's copy the raw mode logic but Wrap it in a "Safe Raw Mode" block
    const result = await runRawMode(async (stdin, stdout) => {
        // ... (Original select logic) ...
        // We need to re-implement it here briefly
        if (!(stdin as any).isKeypressEventsEmitted) {
            emitKeypressEvents(stdin);
        }

        let index = 0;
        const pageSize = 15;
        let scrollTop = 0;
        let needsCleanupLines = 0;

        const printMenu = () => {
            for (let i = 0; i < needsCleanupLines; i++) {
                stdout.write('\x1B[1A\x1B[K');
            }
            console.log(chalk.cyan(`\n  ${title}`));

            if (index < scrollTop) scrollTop = index;
            if (index >= scrollTop + pageSize) scrollTop = index - pageSize + 1;

            const visibleItems = items.slice(scrollTop, scrollTop + pageSize);
            if (scrollTop > 0) console.log(chalk.gray('  ↑ ...'));

            visibleItems.forEach((item, i) => {
                const actualIndex = scrollTop + i;
                const prefix = actualIndex === index ? chalk.green('❯ ') : '  ';
                const label = actualIndex === index ? chalk.green(item.label) : item.label;
                console.log(`${prefix}${label}`);
            });

            if (scrollTop + pageSize < items.length) console.log(chalk.gray('  ↓ ...'));
            console.log(chalk.gray(`  (↑/↓ - select, Enter - confirm, Esc - cancel)`));

            let lines = 2; // Title + header
            if (scrollTop > 0) lines++;
            lines += visibleItems.length;
            if (scrollTop + pageSize < items.length) lines++;
            lines++; // Footer
            needsCleanupLines = lines;
        };

        printMenu();
        stdout.write('\x1B[?25l'); // Hide cursor

        return new Promise<T | null>(resolve => {
            const onKeypress = (_str: string, key: any) => {
                if (!key) return;
                if (key.name === 'up') {
                    index = (index > 0) ? index - 1 : items.length - 1;
                    printMenu();
                } else if (key.name === 'down') {
                    index = (index < items.length - 1) ? index + 1 : 0;
                    printMenu();
                } else if (key.name === 'return') {
                    cleanup();
                    resolve(items[index].value);
                } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
                    cleanup();
                    resolve(null);
                }
            };

            const cleanup = () => {
                stdout.write('\x1B[?25h'); // Show cursor
                stdin.removeListener('keypress', onKeypress);
                for (let i = 0; i < needsCleanupLines; i++) {
                    stdout.write('\x1B[1A\x1B[K');
                }
            };

            stdin.on('keypress', onKeypress);
        });
    });

    if (rl) rl.resume();
    return result;
}

// Wrapper to safely run code that needs raw stdin, ensuring RL is paused
async function runRawMode<T>(fn: (stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) => Promise<T>): Promise<T> {
    if (rl) rl.pause();
    
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    try {
        return await fn(process.stdin, process.stdout);
    } finally {
        process.stdin.setRawMode(false);
        // Do NOT pause stdin here, as RL needs it. 
        // But RL.resume() will call stdin.resume() anyway.
    }
}

// New: Wait for cancellation (ESC/Ctrl+C) while task is running
export function waitForCancel(signal: AbortSignal, onCancel: () => void): () => void {
    if (rl) rl.pause();
    
    // Setup raw mode listener
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    if (!(process.stdin as any).isKeypressEventsEmitted) {
        emitKeypressEvents(process.stdin);
    }

    const onKey = (_str: string, key: any) => {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
            onCancel();
        }
    };

    process.stdin.on('keypress', onKey);

    // Return cleanup function
    return () => {
        process.stdin.removeListener('keypress', onKey);
        process.stdin.setRawMode(false);
        if (rl) rl.resume();
    };
}

// Capture multiline input until EOF (Ctrl+D)
export async function readMultiline(prompt: string): Promise<string | null> {
    if (rl) rl.pause();

    console.log(prompt);
    console.log(chalk.gray('  (Type or Paste text. Press Ctrl+D to send, Ctrl+C to cancel)'));
    process.stdout.write(chalk.cyan('  > '));

    return runRawMode(async (stdin, stdout) => {
        let buffer = '';
        
        return new Promise<string | null>(resolve => {
            const onData = (data: Buffer) => {
                const str = data.toString();
                
                // Ctrl+C
                if (str.includes('\u0003')) {
                    stdout.write('\n' + chalk.red('Cancelled') + '\n');
                    resolve(null);
                    return;
                }

                // Ctrl+D (EOF)
                if (str.includes('\u0004')) {
                    stdout.write('\n');
                    resolve(buffer.trim());
                    return;
                }

                // Handle Backspace (Basic)
                if (str === '\u007f' || str === '\b') {
                    if (buffer.length > 0) {
                        buffer = buffer.slice(0, -1);
                        // Erase char from screen
                        stdout.write('\b \b');
                    }
                    return;
                }

                // Normal input
                buffer += str;
                stdout.write(str);
            };

            stdin.on('data', onData);
            
            // Cleanup listener is handled by runRawMode's finally, 
            // but runRawMode waits for the promise to resolve.
            // We need to detach THIS listener manually? 
            // runRawMode doesn't know about our specific 'data' listener.
            // Actually runRawMode wrapper doesn't remove listeners attached inside fn.
            // We should remove it before resolving.
            const originalResolve = resolve;
            resolve = (val) => {
                stdin.removeListener('data', onData);
                originalResolve(val);
            };
        });
    }).finally(() => {
        if (rl) rl.resume();
    });
}

export async function password(prompt: string): Promise<string> {
    if (!rl) initReadline();
    // Use simplified masked input or the old one wrapped in runRawMode
    // Using runRawMode is safer to avoid conflict
    const result = await runRawMode(async (stdin, stdout) => {
        stdout.write(`  ${prompt}: `);
        let input = '';
        return new Promise<string>(resolve => {
            const onData = (data: Buffer) => {
                const str = data.toString();
                if (str === '\r' || str === '\n') {
                    stdin.removeListener('data', onData);
                    stdout.write('\n');
                    resolve(input);
                } else if (str === '\x7f' || str === '\b') {
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                        stdout.write('\b \b');
                    }
                } else if (str === '\x03') { // Ctrl+C
                    stdin.removeListener('data', onData);
                    stdout.write('\n');
                    resolve('');
                } else {
                    input += str;
                    stdout.write('*');
                }
            };
            stdin.on('data', onData);
        });
    });
    if (rl) rl.resume();
    return result;
}

export async function input(prompt: string, defaultVal?: string): Promise<string> {
    if (!rl) initReadline();
    const hint = defaultVal ? ` [${defaultVal}]` : '';
    // Use rl.question directly
    return new Promise(resolve => {
        rl!.question(`  ${prompt}${hint}: `, (ans) => {
            resolve(ans.trim() || defaultVal || '');
        });
    });
}

// Simple ask wrapper
export function ask(prompt: string): Promise<string> {
    if (!rl) initReadline();
    return new Promise(resolve => {
        rl!.question(prompt, resolve);
    });
}

// Multi-select wrapper using select
export async function multiSelect(
  title: string,
  items: { label: string; value: string; checked?: boolean }[]
): Promise<string[]> {
    // Basic implementation that relies on ask for comma-separated
    console.log(chalk.cyan(`\n  ${title}\n`));
    for (let i = 0; i < items.length; i++) {
        const check = items[i].checked ? chalk.green('[x]') : '[ ]';
        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${check} ${items[i].label}`);
    }
    const current = items.filter(i => i.checked).map((_, idx) => idx + 1).join(',');
    console.log(chalk.gray(`\n  ${t('ui_multiselect_hint')}\n`));
    
    const answer = await ask(chalk.cyan(`  ${t('ui_selection')} [${current || t('ui_none')}]: `));
    
    if (!answer.trim()) {
        return items.filter(i => i.checked).map(i => i.value);
    }
    
    const nums = answer.split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    return nums.filter((n: number) => n >= 1 && n <= items.length).map((n: number) => items[n - 1].value);
}
