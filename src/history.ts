// Управление историей диалога ~/.council-ai/history.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Message } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.council-ai');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');

export class HistoryManager {
  private messages: Message[] = [];

  constructor() {
    // Не загружаем историю автоматически при старте, чтобы каждая сессия была новой.
    // this.load();
  }

  public load() {
    try {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      this.messages = JSON.parse(raw);
    } catch {
      this.messages = [];
    }
  }

  private save() {
    const tempFile = HISTORY_FILE + '.tmp';
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(tempFile, JSON.stringify(this.messages, null, 2));
    fs.renameSync(tempFile, HISTORY_FILE);
  }

  getMessages(): Message[] {
    return this.messages;
  }

  getLast(n: number): Message[] {
    return this.messages.slice(-n);
  }

  add(msg: Message) {
    this.messages.push(msg);
    this.save();
  }

  clear() {
    this.messages = [];
    this.save();
  }

  compact(keepCount: number = 10) {
    if (this.messages.length > keepCount) {
      this.messages = this.messages.slice(-keepCount);
      this.save();
    }
  }
}
