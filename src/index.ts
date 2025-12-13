#!/usr/bin/env node
// House of Collective Intelligence — CLI
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { HistoryManager } from './history.js';
import { Council } from './council.js';
import { handleCommand, getCommandFromMenu } from './commands.js';
import * as ui from './ui.js';
import { t, setLanguage } from './i18n.js';
import { emitKeypressEvents } from 'node:readline';
import { exec } from 'node:child_process';
import util from 'node:util';

const execAsync = util.promisify(exec);

async function main() {
  const config = new ConfigManager();
  const history = new HistoryManager();
  const council = new Council(config, history);
  const ctx = { config, history, council };

  // Set language
  setLanguage(config.getLanguage());

  ui.initReadline();

  // Баннер
  printBanner();
  
  // Background update check
  checkUpdate().catch(() => {});

  printStatus(config);
  console.log(chalk.gray(`  ${t('input_placeholder')}\n`));

  // Основной цикл
  try {
      while (true) {
        const input = await ui.askSmart(
          chalk.cyan('> '),
          async () => await getCommandFromMenu(),
          () => getStatusBar(ctx)
        );
        const text = input.trim();

        if (!text) continue;

        // Команды
        if (text.startsWith('/')) {
          const result = await handleCommand(text, ctx);
          
          if (typeof result === 'string') {
              // It's a voice command result or similar -> process as prompt
              // fall through to askCouncil with this text
              // We override 'text' but we need to break out of this if block
              // Let's refactor slightly
          } else {
              const shouldExit = result;
              if (shouldExit) {
                console.log(chalk.gray(`\n  ${t('bye')}\n`));
                break;
              }
              continue;
          }
          
          // If we are here, result is string (transcribed text)
          // Execute as prompt
          await processPrompt(result as string, council, config);
          continue;
        }

        // Вопрос к совету
        const activeAgents = config.getAgents().filter(a => a.enabled);
        if (activeAgents.length === 0) {
            console.log(chalk.yellow(`\n  ⚠️  ${t('agents_empty')}`));
            console.log(chalk.gray(`  Use /agents or /login to setup.\n`));
            
            // Optional: Auto-redirect to agents management if truly empty
            if (config.getAgents().length === 0) {
                 const doSetup = await ui.select('Настроить агентов сейчас?', [
                     { label: 'Да', value: 'yes' },
                     { label: 'Нет', value: 'no' }
                 ]);
                 if (doSetup === 'yes') {
                     await handleCommand('/agents', ctx);
                     continue;
                 }
            }
            continue;
        }

        await processPrompt(text, council, config);
      }
  } catch (err: any) {
      if (err.message === 'SIGINT') {
          console.log(chalk.gray('\n  ' + t('bye')));
      } else {
          console.error('Unexpected error:', err);
      }
  } finally {
      await council.cleanup();
      ui.closeReadline();
      process.exit(0);
  }
}

async function processPrompt(text: string, council: Council, config: ConfigManager) {
    const controller = new AbortController();
    let isProcessing = true;

    // Use centralized cancellation waiter from UI
    // This ensures we don't conflict with readline's raw mode management
    const cleanupCancelListener = ui.waitForCancel(controller.signal, () => {
        if (isProcessing) {
             console.log(chalk.yellow(`\n  ${t('aborted')}`));
             controller.abort();
             isProcessing = false;
        }
    });

    try {
        await askCouncil(text, council, config, controller.signal);
    } catch (err: any) {
        if (err.message === 'Aborted' || err.name === 'AbortError') {
            // Already logged in handler or just suppress
        } else {
            console.error(chalk.red(`\n  ${t('error')}: ${err.message}`));
        }
    } finally {
        isProcessing = false;
        cleanupCancelListener();
    }
}

function printBanner() {
  console.log('');
  console.log(chalk.yellow('  ╔════════════════════════════════════════════════════╗'));
  console.log(chalk.yellow('  ║') + chalk.cyan.bold('  🏛  House of Collective Intelligence  — CLI   ') + chalk.yellow('║'));
  console.log(chalk.yellow('  ╚════════════════════════════════════════════════════╝'));
  console.log('');
}

function printStatus(config: ConfigManager) {
  const agents = config.getAgents();
  const chairId = config.getChairId();
  const chair = agents.find(a => a.id === chairId);

  // Председатель
  if (chair) {
      console.log(chalk.cyan(`  ${t('status_chair')}: `) + chalk.green(`${chair.name} (${chair.providerType}/${chair.model})`));
  } else {
      console.log(chalk.cyan(`  ${t('status_chair')}: `) + chalk.gray(t('status_chair_none')));
  }

  // Совет
  const active = agents.filter(a => a.enabled && a.id !== chairId);
  if (active.length > 0) {
    console.log(chalk.cyan(`  ${t('status_council')}:`));
    active.forEach(a => {
        console.log(chalk.blue(`    • ${a.name}`) + chalk.gray(` (${a.providerType}/${a.model})`));
    });
  } else {
    console.log(chalk.cyan(`  ${t('status_council')}: `) + chalk.gray(t('status_council_none')));
  }
  
  console.log('');
}

async function askCouncil(question: string, council: Council, config: ConfigManager, signal?: AbortSignal) {
  console.log('');
  const result = await council.ask(question, (msg) => {
    console.log(chalk.gray(`  ⏳ ${msg}`));
  }, signal, (res) => {
      // Callback for individual council responses
      if (config.getMuteMode()) return; // В тихом режиме не выводим ответы Совета

      if (!res.error) {
          const agent = config.getAgent(res.providerId);
          const name = agent ? agent.name : res.providerId;
          const model = agent ? agent.model : res.model;
          
          console.log(chalk.gray(`\n  ┌── [${name}] (${model})`));
          console.log(chalk.gray(`  │`));
          console.log(chalk.gray(res.text.split('\n').map(l => `  │ ${l}`).join('\n')));
          console.log(chalk.gray(`  └──────────────────────────────────────────`));
      } else {
          const agent = config.getAgent(res.providerId);
          const name = agent ? agent.name : res.providerId;
          console.log(chalk.red(`\n  [${name}] ✗ ${t('error')}: ${res.error}`));
      }
  });

  // Председатель
  console.log(chalk.cyan(`\n  ${t('status_chair')}`));
  if (result.chairResponse && !result.chairResponse.error) {
    console.log(result.chairResponse.text.split('\n').map(l => `  ${l}`).join('\n'));
  } else if (result.chairResponse?.error) {
    console.log(chalk.red(`  ✗ ${t('error')}: ${result.chairResponse.error}`));
  }

  console.log('');
}

function getStatusBar(ctx: { history: HistoryManager, config: ConfigManager, council: Council }) {
  const msgs = ctx.history.getMessages().length;
  const limit = 50; 
  const contextPct = Math.min(Math.round((msgs / limit) * 100), 100);
  
  return `${t('context')}: ${contextPct}%`;
}

async function checkUpdate() {
    try {
        const { stdout } = await execAsync('git fetch && git status -uno');
        if (!stdout.includes('Your branch is up to date') && !stdout.includes('up to date with')) {
             // Basic check: if git status says we are behind or have incoming commits
             // But 'Your branch is up to date' is the standard message when clean.
             // If we are behind, it usually says "Your branch is behind..."
             // Let's invert: if it DOESN'T say "up to date", we assume update available.
             console.log(chalk.green(`  ${t('update_available')} (${t('cmd_update')})\n`));
        }
    } catch {
        // Silent fail
    }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});