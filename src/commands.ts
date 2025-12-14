// Команды CLI
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import { HistoryManager } from './history.js';
import { Council } from './council.js';
import { testApiKey, getBalance, fetchModels, API_KEY_URLS } from './providers.js';
import { getPriceString, MODEL_PRICING } from './pricing.js';
import { ProviderType } from './types.js';
import * as ui from './ui.js';
import { t, setLanguage, getLanguage } from './i18n.js';
import { emitKeypressEvents } from 'readline';
import { exec } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = util.promisify(exec);

// Determine project root (assuming dist/commands.js -> project_root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

export interface CommandContext {
  config: ConfigManager;
  history: HistoryManager;
  council: Council;
}

export const COMMANDS = [
  { cmd: '/login', desc: 'cmd_login' },
  { cmd: '/agents', desc: 'cmd_agents' },
  { cmd: '/settings', desc: 'cmd_settings' },
  { cmd: '/stats', desc: 'cmd_stats' },
  { cmd: '/status', desc: 'cmd_status' },
  { cmd: '/update', desc: 'cmd_update' },
  { cmd: '/mute', desc: 'cmd_mute' },
  { cmd: '/compact', desc: 'cmd_compact' },
  { cmd: '/lang', desc: 'cmd_lang' },
  { cmd: '/new', desc: 'cmd_new' },
  { cmd: '/exit', desc: 'cmd_exit' },
];

export async function handleCommand(input: string, ctx: CommandContext): Promise<boolean | string> {
  const [cmd] = input.trim().split(/\s+/);

  switch (cmd) {
    case '/':
    case '/help':
    case '/menu':
      return await showMenu(ctx);
    
    case '/login':
      await cmdLogin(ctx);
      return false;
    
    case '/agents':
    case '/council': 
    case '/chair':
      await cmdAgents(ctx);
      return false;

    case '/settings':
      await cmdSettings(ctx);
      return false;

    case '/stats':
      await cmdStats(ctx);
      return false;

    case '/status':
      await cmdStatus(ctx);
      return false;

    case '/update':
      await cmdUpdate(ctx);
      return false;

    case '/mute':
      await cmdMute(ctx);
      return false;

    case '/compact':
      await cmdCompact(ctx);
      return false;

    case '/lang':
      await cmdLang(ctx);
      return false;
    
    case '/new':
      ctx.history.clear();
      ctx.council.resetStats();
      console.log(chalk.green(`\n  ${t('new_chat')}\n`));
      return false;
    
    case '/exit':
      return true;
    
    default:
      console.log(chalk.red(`\n  ${t('unknown_cmd')}: ${cmd}\n`));
      return false;
  }
}

export async function getCommandFromMenu(): Promise<string | null> {
  const choice = await ui.select(t('menu_header'), COMMANDS.map(c => ({
    label: `${c.cmd.padEnd(10)} ${chalk.gray(t(c.desc))}`,
    value: c.cmd
  })));
  return choice;
}

export async function showMenu(ctx: CommandContext): Promise<boolean | string> {
  const choice = await ui.select(t('menu_header'), COMMANDS.map(c => ({
    label: `${c.cmd.padEnd(10)} ${chalk.gray(t(c.desc))}`,
    value: c.cmd
  })));
  
  if (choice) {
    return await handleCommand(choice, ctx);
  }
  return false;
}

async function cmdLang(ctx: CommandContext) {
    const current = ctx.config.getLanguage();
    
    const choice = await ui.select(t('cmd_lang'), [
        { label: 'English', value: 'en' },
        { label: 'Русский', value: 'ru' }
    ]);

    if (choice && choice !== current) {
        ctx.config.setLanguage(choice as 'ru' | 'en');
        setLanguage(choice as 'ru' | 'en');
        console.log(chalk.green(`\n  ✓ ${t('lang_switched')}\n`));
    }
}

async function cmdSettings(ctx: CommandContext) {
    while (true) {
        const perms = ctx.config.getPermissions();
        
        console.log(chalk.cyan(`\n  ${t('settings_title')}`));
        console.log(chalk.gray(`  ${t('settings_desc')}\n`));

        const getLabel = (key: string, val: boolean) => {
            const status = val ? chalk.green(`[${t('settings_on')}]`) : chalk.red(`[${t('settings_off')}]`);
            return `${t(key).padEnd(40)} ${status}`;
        };

        const choice = await ui.select('', [
            { label: getLabel('perm_browser', !!perms.allow_browser), value: 'browser' },
            { label: getLabel('perm_desktop', !!perms.allow_desktop), value: 'desktop' },
            { label: getLabel('perm_command', !!perms.allow_command), value: 'command' },
            { label: getLabel('perm_file_read', !!perms.allow_file_read), value: 'read' },
            { label: getLabel('perm_file_write', !!perms.allow_file_write), value: 'write' },
            { label: t('settings_back'), value: 'back' }
        ]);

        if (!choice || choice === 'back') break;

        if (choice === 'browser') perms.allow_browser = !perms.allow_browser;
        if (choice === 'desktop') perms.allow_desktop = !perms.allow_desktop;
        if (choice === 'command') perms.allow_command = !perms.allow_command;
        if (choice === 'read') perms.allow_file_read = !perms.allow_file_read;
        if (choice === 'write') perms.allow_file_write = !perms.allow_file_write;

        ctx.config.setPermissions(perms);
    }
}

async function cmdLogin(ctx: CommandContext) {
  const types: ProviderType[] = ['openai', 'anthropic', 'deepseek', 'grok', 'gemini', 'perplexity', 'openrouter'];
  
  const choice = await ui.select(t('login_title'), types.map(t => {
      const key = ctx.config.getApiKey(t);
      return { label: `${t} ${key ? chalk.green('✓') : chalk.red('✗')}`, value: t };
  }));
  
  if (!choice) return;
  
  const currentKey = ctx.config.getApiKey(choice);
  const keyUrl = API_KEY_URLS[choice];
  
  if (keyUrl) console.log(chalk.gray(`\n  ${t('login_get_key')}: ${chalk.underline(keyUrl)}`));
  
  if (currentKey) {
      console.log(chalk.gray(`  (${t('login_key_set')})`));
  }
  
  const apiKey = await ui.password(`${t('login_prompt')} ${choice}`);
  
  if (!apiKey) return;
  
  if (apiKey === 'DELETE') {
      ctx.config.setApiKey(choice, '');
      console.log(chalk.yellow(`\n  ${t('login_deleted')}`));
      return;
  }
  
  console.log(chalk.gray(`  ${t('login_checking')}`));
  const res = await testApiKey(choice, apiKey);
  
  if (!res.valid) {
      console.log(chalk.red(`  ✗ ${t('error')}: ${res.error}\n`));
      return;
  }
  
  ctx.config.setApiKey(choice, apiKey);
  console.log(chalk.green(`  ${t('login_valid')}\n`));
  
  if (ctx.config.getAgents().length === 0) {
      const create = await ui.select(t('login_create_agent'), [
          { label: t('login_yes'), value: true },
          { label: t('login_no'), value: false }
      ]);
      if (create) {
          await createAgent(ctx, choice);
      }
  }
}

async function cmdAgents(ctx: CommandContext) {
    while (true) {
        const agents = ctx.config.getAgents();
        const chairId = ctx.config.getChairId();
        const secretaryId = ctx.config.getSecretaryId();
        
        console.log(chalk.cyan(`\n  ${t('agents_title')}`));
        if (agents.length === 0) {
            console.log(chalk.gray(`  ${t('agents_empty')}`));
        } else {
            agents.forEach(a => {
                let status = a.enabled ? chalk.blue(t('agents_council')) : chalk.gray(t('agents_off'));
                if (a.id === chairId) status = chalk.green(t('agents_chair'));
                if (a.id === secretaryId) status = chalk.magenta(t('agents_secretary'));
                
                console.log(`  ${a.name.padEnd(20)} [${a.providerType}/${a.model}]  ${status}`);
            });
        }
        console.log('');

        const action = await ui.select(t('agents_action'), [
            { label: t('agents_add_chair'), value: 'add_chair' },
            { label: t('agents_add_secretary'), value: 'add_secretary' },
            { label: t('agents_add_council'), value: 'add_council' },
            { label: t('agents_edit'), value: 'edit' },
            { label: t('agents_back'), value: 'back' }
        ]);
        
        if (!action || action === 'back') break;
        
        if (action === 'add_chair') await createAgent(ctx, undefined, 'chair');
        if (action === 'add_secretary') await createAgent(ctx, undefined, 'secretary');
        if (action === 'add_council') await createAgent(ctx, undefined, 'council');
        if (action === 'edit') await editAgent(ctx);
    }
}

async function createAgent(ctx: CommandContext, preselectedType?: ProviderType, role?: 'chair' | 'council' | 'secretary') {
    const types: ProviderType[] = ['openai', 'anthropic', 'deepseek', 'grok', 'gemini', 'perplexity', 'openrouter'];
    
    let type = preselectedType;
    if (!type) {
        const typeChoice = await ui.select(t('agents_select_type'), types.map(provider => {
            const hasKey = !!ctx.config.getApiKey(provider);
            const indicator = hasKey ? chalk.green('✓') : chalk.red('✗');
            return { label: `${provider} ${indicator}`, value: provider }; 
        }));
        if (!typeChoice) return;
        type = typeChoice;
    }
    
    console.log(chalk.gray(`  ${t('agents_loading_models')} ${type}...`));
    const apiKey = ctx.config.getApiKey(type!);
    let model = '';
    
    if (apiKey) {
        const models = await fetchModels(type!, apiKey);
        if (models.length > 0) {
             let filteredModels = models;

             // Special filter for OpenRouter
             if (type === 'openrouter') {
                 const filter = await ui.select(t('agents_select_filter'), [
                     { label: t('agents_filter_all'), value: 'all' },
                     { label: t('agents_filter_free'), value: 'free' },
                     { label: t('agents_filter_paid'), value: 'paid' }
                 ]);

                 if (filter === 'free') {
                     filteredModels = models.filter(m => {
                         const price = MODEL_PRICING[m];
                         return price && price.in === 0 && price.out === 0;
                     });
                 } else if (filter === 'paid') {
                     filteredModels = models.filter(m => {
                         const price = MODEL_PRICING[m];
                         return !price || price.in > 0 || price.out > 0;
                     });
                 }
             }

             const modelChoice = await ui.select(t('agents_select_model'), [
                 ...filteredModels.map(m => {
                     const p = getPriceString(m);
                     return { label: `${m} ${chalk.gray(p)}`, value: m };
                 }),
                 { label: t('agents_manual'), value: '__manual__' }
             ]);
             
             if (modelChoice === '__manual__') {
                 model = await ui.input(t('agents_input_model'));
             } else if (modelChoice) {
                 model = modelChoice;
             }
        } else {
            model = await ui.input(`${t('agents_input_model')} (${t('error')})`);
        }
    } else {
        console.log(chalk.yellow('  (No key, list unavailable)'));
        model = await ui.input(t('agents_input_model_manual'));
    }
    
    if (!model) return;
    
    const name = model; 
    
    const newAgent = ctx.config.addAgent({ name, providerType: type!, model, enabled: true });
    
    if (role === 'chair') {
        ctx.config.setChairId(newAgent.id);
        console.log(chalk.green(`  ${t('agents_created_chair').replace('Агент', name)}\n`));
    } else if (role === 'secretary') {
        ctx.config.setSecretaryId(newAgent.id);
        // Secretary is usually NOT in the council to avoid noise, but strictly speaking "enabled" just means it exists.
        // We probably want to disable it for council voting, but keep it active.
        // For now, enabled=true is fine, but we will filter it out of council list in council.ts
        console.log(chalk.green(`  ${t('agents_created_secretary').replace('Агент', name)}\n`));
    } else if (role === 'council') {
        console.log(chalk.green(`  ${t('agents_created_council').replace('Агент', name)}\n`));
    } else {
        if (ctx.config.getAgents().length === 1) {
             ctx.config.setChairId(newAgent.id);
             console.log(chalk.green(`  ${t('agents_created_chair').replace('Агент', name)}\n`));
        } else {
             console.log(chalk.green(`  ${t('agents_created').replace('Агент', name)}\n`));
        }
    }
}

async function editAgent(ctx: CommandContext) {
    const agents = ctx.config.getAgents();
    if (agents.length === 0) return;
    
    const choice = await ui.select(t('agents_select_agent'), agents.map(a => ({
        label: `${a.name} (${a.model})`, value: a.id
    })));
    
    if (!choice) return;
    const agent = ctx.config.getAgent(choice)!;
    
    const action = await ui.select(`${t('agents_action_with')} ${agent.name}`, [
        { label: agent.enabled ? t('agents_toggle_exclude') : t('agents_toggle_include'), value: 'toggle' },
        { label: t('agents_delete'), value: 'delete' },
        { label: t('agents_cancel'), value: 'cancel' }
    ]);
    
    if (action === 'toggle') {
        ctx.config.updateAgent(agent.id, { enabled: !agent.enabled });
        console.log(chalk.green(`  ${t('agents_updated')}`));
    }
    
    if (action === 'delete') {
        ctx.config.removeAgent(agent.id);
        console.log(chalk.yellow(`  ${t('agents_deleted')}`));
    }
}

async function selectChair(ctx: CommandContext) {
    const agents = ctx.config.getAgents();
    if (agents.length === 0) return;
    
    const choice = await ui.select(t('chair_select_new'), agents.map(a => ({
        label: a.name, value: a.id
    })));
    
    if (choice) {
        ctx.config.setChairId(choice);
        console.log(chalk.green(`  ${t('chair_assigned')}`));
    }
}

async function cmdStatus(ctx: CommandContext) {
    const agents = ctx.config.getAgents();
    const chairId = ctx.config.getChairId();
    const chair = agents.find(a => a.id === chairId);
    
    const activeAgents = agents.filter(a => a.enabled);
    const usedProviders = new Set(activeAgents.map(a => a.providerType));
    const balances: Record<string, string> = {};

    process.stdout.write(chalk.gray(`  ${t('status_loading')} `));
    
    await Promise.all(Array.from(usedProviders).map(async (type) => {
        const key = ctx.config.getApiKey(type);
        if (key) {
            const bal = await getBalance(type, key);
            if (bal) balances[type] = bal;
        }
    }));
    
    process.stdout.write('\r' + ' '.repeat(30) + '\r');

    console.log('');
    if (chair) {
        const bal = balances[chair.providerType] || '';
        const balStr = bal ? chalk.yellow(` [${bal}]`) : '';
        console.log(chalk.cyan(`  ${t('status_chair')}: `) + chalk.green(`${chair.name} (${chair.providerType}/${chair.model})`) + balStr);
    } else {
        console.log(chalk.cyan(`  ${t('status_chair')}: `) + chalk.gray(t('status_chair_none')));
    }
    
    // Secretary
    const secretaryId = ctx.config.getSecretaryId();
    const secretary = agents.find(a => a.id === secretaryId);
    if (secretary) {
        const bal = balances[secretary.providerType] || '';
        const balStr = bal ? chalk.yellow(` [${bal}]`) : '';
        console.log(chalk.cyan(`  ${t('status_secretary')}: `) + chalk.magenta(`${secretary.name} (${secretary.providerType}/${secretary.model})`) + balStr);
    }

    const council = agents.filter(a => a.enabled && a.id !== chairId && a.id !== secretaryId);
    if (council.length > 0) {
        console.log(chalk.cyan(`  ${t('status_council')}:`));
        council.forEach(a => {
            const bal = balances[a.providerType] || '';
            const balStr = bal ? chalk.yellow(` [${bal}]`) : '';
            console.log(chalk.blue(`    • ${a.name}`) + chalk.gray(` (${a.providerType}/${a.model})`) + balStr);
        });
    } else {
        console.log(chalk.cyan(`  ${t('status_council')}: `) + chalk.gray(t('status_council_none')));
    }
    console.log('');
}

async function cmdUpdate(ctx: CommandContext) {
    console.log(chalk.cyan(`\n  🔄 ${t('update_checking')}`));
    
    try {
        // 1. Check for updates
        const { stdout: status } = await execAsync('git fetch && git status -uno', { cwd: projectRoot });
        
        if (status.includes('Your branch is up to date')) {
            console.log(chalk.green(`  ${t('update_up_to_date')}\n`));
            return;
        }

        console.log(chalk.green(`  ${t('update_available')}`));
        
        const confirm = await ui.select(t('update_confirm'), [
            { label: t('login_yes'), value: 'yes' },
            { label: t('login_no'), value: 'no' }
        ]);

        if (confirm !== 'yes') return;

        // 2. Pull
        console.log(chalk.gray(`  ${t('update_downloading')}`));
        await execAsync('git pull', { cwd: projectRoot });

        // 3. Install
        console.log(chalk.gray(`  ${t('update_installing')}`));
        await execAsync('npm install', { cwd: projectRoot });

        // 4. Build
        console.log(chalk.gray(`  ${t('update_building')}`));
        await execAsync('npm run build', { cwd: projectRoot });

        console.log(chalk.green(`\n  ${t('update_success')}\n`));
        process.exit(0);

    } catch (err: any) {
        if (err.message.includes('not a git repository')) {
            console.error(chalk.yellow(`\n  ⚠️  ${t('update_no_git')}`));
            console.error(chalk.gray(`  ${t('update_git_hint')}\n`));
        } else {
            console.error(chalk.red(`\n  ✗ ${t('update_error')}: ${err.message}\n`));
        }
    }
}

async function cmdMute(ctx: CommandContext) {
    const current = ctx.config.getMuteMode();
    const newValue = !current;
    ctx.config.setMuteMode(newValue);
    
    if (newValue) {
        console.log(chalk.green(`\n  ${t('mute_on')}\n`));
    } else {
        console.log(chalk.green(`\n  ${t('mute_off')}\n`));
    }
}

async function cmdCompact(ctx: CommandContext) {
    const before = ctx.history.getMessages().length;
    ctx.history.compact(10); 
    const after = ctx.history.getMessages().length;
    
    console.log(chalk.green(`\n  ${t('compact_done')}: ${Math.max(0, before - after)}`));
    console.log(chalk.gray(`  (${t('compact_left')}: ${after})\n`));
}

async function cmdStats(ctx: CommandContext) {
    const agents = ctx.config.getAgents();
    console.log(chalk.cyan(`\n  📊 ${t('stats_title')}\n`));
    
    if (agents.length === 0) {
        console.log(chalk.gray(`  ${t('stats_no_data')}`));
        return;
    }

    console.log(chalk.gray('  ' + t('stats_header')));
    console.log(chalk.gray('  ' + '-'.repeat(105)));

    agents.forEach(a => {
        const stats = ctx.council.getStats(a.id);
        const total = stats.totalSuggestions;
        
        let efficiency = 0;
        if (total > 0) {
            const score = stats.acceptedSuggestions + (stats.partiallyAcceptedSuggestions * 0.5);
            efficiency = Math.round((score / total) * 100);
        }

        const effStr = total > 0 ? `${efficiency}%` : '-';
        let effColor = chalk.gray;
        if (total > 0) {
            if (efficiency >= 75) effColor = chalk.green;
            else if (efficiency >= 40) effColor = chalk.yellow;
            else effColor = chalk.red;
        }

        console.log(
            '  ' + 
            a.name.padEnd(20) + ' ' + 
            chalk.gray(`${a.providerType}/${a.model}`.padEnd(25)) + ' ' + 
            total.toString().padEnd(8) + ' ' + 
            chalk.green(stats.acceptedSuggestions.toString().padEnd(10)) + ' ' + 
            chalk.yellow(stats.partiallyAcceptedSuggestions.toString().padEnd(10)) + ' ' + 
            chalk.red(stats.rejectedSuggestions.toString().padEnd(10)) + ' ' + 
            effColor(effStr)
        );
    });
    console.log('');
}