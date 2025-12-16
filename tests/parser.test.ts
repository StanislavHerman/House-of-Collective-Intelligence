import { Council } from '../src/council';
import { ConfigManager } from '../src/config';
import { HistoryManager } from '../src/history';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

describe('Council Tool Parser', () => {
  let council: Council;

  beforeEach(() => {
    // Spy on I/O methods to prevent file access during tests
    jest.spyOn(ConfigManager.prototype, 'load' as any).mockImplementation(() => {});
    jest.spyOn(HistoryManager.prototype, 'load' as any).mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    // Create instance
    const config = new ConfigManager();
    const history = new HistoryManager();
    council = new Council(config, history);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('parses bash commands', () => {
    const text = 'Here is a command:\n```bash\nls -la\n```';
    const tools = council.parseTools(text);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('command');
    expect(tools[0].content).toBe('ls -la');
  });

  test('parses file write', () => {
    const text = '```file:test.txt\nhello world\n```';
    const tools = council.parseTools(text);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('file');
    expect(tools[0].arg).toBe('test.txt');
    expect(tools[0].content).toBe('hello world');
  });

  test('parses edit file', () => {
    const text = '```edit:src/main.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>>\n```';
    const tools = council.parseTools(text);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('edit');
    expect(tools[0].arg).toBe('src/main.ts');
    expect(tools[0].content).toContain('<<<<<<< SEARCH');
  });

  test('parses multiple tools in order', () => {
    const text = `
First list the files:
\`\`\`bash
ls
\`\`\`

Now read the file:
\`\`\`read:data.txt
\`\`\`
`;
    const tools = council.parseTools(text);
    // console.log('DEBUG TOOLS:', JSON.stringify(tools, null, 2));
    expect(tools).toHaveLength(2);
    expect(tools[0].type).toBe('command');
    expect(tools[1].type).toBe('read');
  });

  test('ignores placeholder paths', () => {
    const text = 'Use ```read:path/to/file``` as example.';
    const tools = council.parseTools(text);
    expect(tools).toHaveLength(0);
  });
});
