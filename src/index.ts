#!/usr/bin/env node
// House of Collective Intelligence — CLI
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from './config.js';
import { HistoryManager } from './history.js';
import { Council } from './council.js';
import { handleCommand, getCommandFromMenu } from './commands.js';
import * as ui from './ui.js';
import { t, setLanguage } from './i18n.js';
import { emitKeypressEvents } from 'node:readline';
import { exec } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { CouncilEvent } from './types.js';

const execAsync = util.promisify(exec);

// Determine project root (assuming dist/index.js -> project_root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

async function main() {
  const config = new ConfigManager();
  const history = new HistoryManager();
  
  // Set language FIRST to ensure UI strings are correct
  setLanguage(config.getLanguage());

  // Init UI early for the check
  ui.initReadline();

  const council = new Council(config, history);
  
  // Check for previous session (History Persistence)
  // We check if history has messages. Since history is NOT loaded by default in constructor anymore (or load is empty),
  // we need to peek or try loading. Actually, HistoryManager constructor does NOT load now.
  // We can call load() and see if it has messages.
  history.load(); 
  const hasHistory = history.getMessages().length > 0;
  
  if (hasHistory) {
      const choice = await ui.select(t('resume_session_title'), [
          { label: t('resume_session_yes'), value: 'yes' },
          { label: t('resume_session_no'), value: 'no' }
      ]);
      
      if (choice === 'yes') {
          // Already loaded. Keep stats as is (loaded in Council constructor).
          console.log(chalk.green(`  ${t('history_loaded')}\n`));
      } else {
          // Clear
          history.clear();
          council.resetStats(); // Start fresh
          console.log(chalk.green(`  ${t('new_chat')}\n`));
      }
  } else {
      // No history, ensure stats are reset for clean start
      council.resetStats();
  }
  
  const ctx = { config, history, council };

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
            console.log(chalk.gray(`  ${t('setup_needed_hint')}\n`));
            
            // Optional: Auto-redirect to agents management if truly empty
            if (config.getAgents().length === 0) {
                 const doSetup = await ui.select(t('setup_now_prompt'), [
                     { label: t('yes'), value: 'yes' },
                     { label: t('no'), value: 'no' }
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
        const msg = (err.message || '').toLowerCase();
        if (msg === 'aborted' || err.name === 'AbortError' || msg.includes('canceled')) {
            // Suppress "aborted" errors as they are user-initiated
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

  // Секретарь
  const secretaryId = config.getSecretaryId();
  const secretary = agents.find(a => a.id === secretaryId);
  if (secretary) {
      console.log(chalk.cyan(`  ${t('status_secretary')}: `) + chalk.magenta(`${secretary.name} (${secretary.providerType}/${secretary.model})`));
  }

  // Совет
  const active = agents.filter(a => a.enabled && a.id !== chairId && a.id !== secretaryId);
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
  
  try {
    const result = await council.ask(question, (event: CouncilEvent) => {
        if (config.getMuteMode()) return;

        switch (event.type) {
            case 'step':
                logger.step(event.message || '');
                break;
            case 'tool_start':
                if (event.payload) {
                    logger.action(event.payload.tool, event.payload.input);
                }
                break;
            case 'tool_result':
                // Optional: log result success/fail if needed
                break;
            case 'agent_thinking':
                if (event.payload) {
                    const { agent, estimatedTokens } = event.payload;
                    logger.subAction(`${agent.name} (${agent.model}): ${t('thinking')} (~${Math.round(estimatedTokens/1000)}k tok)`);
                }
                break;
            case 'agent_response':
                if (event.payload) {
                    const { agent, duration } = event.payload;
                    logger.subAction(`${agent.name} (${agent.model}): ${t('answer_received')} (${duration}s)`);
                }
                break;
            case 'info':
                logger.info(event.message || '');
                break;
            case 'error':
                logger.error(event.message || '');
                break;
            case 'success':
                logger.success(event.message || '');
                break;
        }
    }, signal, (res) => {
        // Callback for individual council responses (Detailed View)
        if (config.getMuteMode()) return;

        if (!res.error) {
            const agent = config.getAgent(res.providerId);
            const name = agent ? agent.name : res.providerId;
            const model = agent ? agent.model : res.model;
            
            logger.agent(name, model);
            
            // Display reasoning for council members if available
            if (res.reasoning) {
                logger.agentLine(`💭 ${t('reasoning') || 'Reasoning'}:`);
                res.reasoning.split('\n').forEach(line => {
                    logger.agentLine(`  ${chalk.italic(line)}`);
                });
            }

            logger.agentLine('');
            res.text.split('\n').forEach(l => logger.agentLine(l));
            logger.agentEnd();
        } else {
            const agent = config.getAgent(res.providerId);
            const name = agent ? agent.name : res.providerId;
            logger.error(`[${name}] ${t('error')}: ${res.error}`);
        }
    });

    // Председатель
    console.log(chalk.cyan(`\n  ${t('status_chair')}`));
    if (result.chairResponse && !result.chairResponse.error) {
      // Reasoning block for Chair
      if (result.chairResponse.reasoning) {
          console.log(chalk.gray(`\n  💭 ${chalk.bold('Reasoning')}:`));
          console.log(chalk.gray(result.chairResponse.reasoning.split('\n').map(l => `  ${chalk.italic(l)}`).join('\n')));
          console.log(chalk.gray('  ' + '─'.repeat(40))); // Separator line
          console.log('');
      }

      console.log(result.chairResponse.text.split('\n').map(l => `  ${l}`).join('\n'));
    } else if (result.chairResponse?.error) {
      console.log(chalk.red(`  ✗ ${t('error')}: ${result.chairResponse.error}`));
    }
  } catch (err: any) {
      logger.error(`${t('error')}: ${err.message}`);
      throw err;
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
        await execAsync('git fetch', { cwd: projectRoot });
        const { stdout } = await execAsync('git status -uno --porcelain=v2 --branch', { cwd: projectRoot });
        // Check if behind count is > 0
        // Format: # branch.ab +0 -0
        const match = stdout.match(/# branch\.ab \+\d+ -(\d+)/);
        if (match && parseInt(match[1], 10) > 0) {
             console.log(chalk.green(`  ${t('update_available')} (${t('cmd_update')})\n`));
        }
    } catch {
        // Silent fail
    }
}

// Global Error Handlers to prevent crash
process.on('uncaughtException', (err) => {
    if (err.message === 'Aborted' || err.message === 'aborted') return;
    console.error(chalk.red(`\n  💥 Uncaught Exception: ${err.message}`));
    // Don't exit, try to recover
});

process.on('unhandledRejection', (reason: any) => {
    if (reason?.message === 'Aborted' || reason?.message === 'aborted') return;
    // console.error(chalk.red(`\n  💥 Unhandled Rejection: ${reason?.message || reason}`));
});

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});