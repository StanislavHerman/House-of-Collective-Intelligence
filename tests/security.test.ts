import { jest, describe, test, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';

// Define the mock factory outside
const mockSendToProvider = jest.fn<any>();

// Use unstable_mockModule for ESM mocking
jest.unstable_mockModule('../src/providers', () => ({
  sendToProvider: mockSendToProvider,
  estimateTokens: (t: string) => Math.ceil(t.length / 2.5), // Simple mock
  // Add other exports if needed by Council
}));

describe('Security Permissions', () => {
  let Council: any;
  let ConfigManager: any;
  let HistoryManager: any;
  let council: any;
  let config: any;
  let history: any;

  beforeAll(async () => {
    // Dynamic import AFTER mocking
    const councilModule = await import('../src/council');
    Council = councilModule.Council;
    const configModule = await import('../src/config');
    ConfigManager = configModule.ConfigManager;
    const historyModule = await import('../src/history');
    HistoryManager = historyModule.HistoryManager;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock ConfigManager loading
    jest.spyOn(ConfigManager.prototype, 'load').mockImplementation(() => {});
    jest.spyOn(HistoryManager.prototype, 'load').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    
    config = new ConfigManager();
    history = new HistoryManager();
    council = new Council(config, history);
    
    // Mock Agent config
    jest.spyOn(config, 'getAgents').mockReturnValue([
        { id: 'chair', name: 'Chair', providerType: 'openai', model: 'gpt-4', enabled: true }
    ]);
    jest.spyOn(config, 'getChairId').mockReturnValue('chair');
    jest.spyOn(config, 'getApiKey').mockReturnValue('sk-mock');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('blocks system_diagnostics when command permission is disabled', async () => {
    // Disable command permission
    jest.spyOn(config, 'getPermissions').mockReturnValue({
        allow_command: false
    });

    // Mock provider response to try calling system_diagnostics
    // First call returns tool
    // Second call (after error loop) returns clean exit
    jest.mocked(mockSendToProvider)
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: '```system_diagnostics```'
        })
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: 'Acknowledged error.'
        });

    const onProgress = jest.fn();
    await council.ask('run diagnostics', onProgress);

    // Verify error was reported
    expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ 
            type: 'error', 
            message: 'Permission denied (diagnostics)' 
        })
    );
  });

  test('blocks ios_config when file edit permission is disabled', async () => {
    // Disable file edit permission
    jest.spyOn(config, 'getPermissions').mockReturnValue({
        allow_file_edit: false
    });

    // Mock provider response
    jest.mocked(mockSendToProvider)
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: '```ios:config list project.pbxproj```'
        })
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: 'Acknowledged error.'
        });

    const onProgress = jest.fn();
    await council.ask('config ios', onProgress);

    // Verify error was reported
    expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ 
            type: 'error', 
            message: 'Permission denied (ios_config)' 
        })
    );
  });

  test('allows system_diagnostics when permission enabled', async () => {
    jest.spyOn(config, 'getPermissions').mockReturnValue({
        allow_command: true
    });

    mockSendToProvider
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: '```system_diagnostics```'
        })
        .mockResolvedValueOnce({
            providerId: 'chair',
            model: 'gpt-4',
            text: 'Diagnostics complete.'
        });

    // Mock tool execution to avoid real side effects
    // 'tools' is private, accessing via index signature or cast
    const runDiagSpy = jest.spyOn((council as any).tools, 'runDiagnostics')
        .mockResolvedValue({ output: 'Diag OK' });

    const onProgress = jest.fn();
    await council.ask('run diagnostics', onProgress);

    // Verify it was called (checking tool start event)
    expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'tool_start' })
    );
    expect(runDiagSpy).toHaveBeenCalled();
  });
});
