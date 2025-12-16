
import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Define temp path without importing os
const tempHome = `/tmp/council-test-sec-${Date.now()}`;

// Mock node:os
jest.unstable_mockModule('node:os', () => ({
    __esModule: true,
    default: {
        homedir: () => tempHome,
        platform: () => 'darwin',
        release: () => '1.0.0',
        arch: () => 'x64',
        tmpdir: () => '/tmp'
    }
}));

describe('ConfigManager Secretary Fix', () => {
    let ConfigManager: any;
    let config: any;

    beforeAll(async () => {
        // Create temp home
        if (!fs.existsSync(tempHome)) {
            fs.mkdirSync(tempHome, { recursive: true });
        }
        
        // Import module under test
        const module = await import('../src/config.js');
        ConfigManager = module.ConfigManager;
    });

    afterAll(() => {
        try {
            fs.rmSync(tempHome, { recursive: true, force: true });
        } catch {}
    });

    test('removes secretaryAgentId when api key is deleted', () => {
        // Setup config manually
        const configDir = path.join(tempHome, '.council-ai');
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        
        const initialConfig = {
            apiKeys: { 'openai': 'sk-test' },
            agents: [
                { id: 'sec', name: 'Secretary', providerType: 'openai', model: 'gpt-3.5', enabled: true }
            ],
            secretaryAgentId: 'sec',
            permissions: {}
        };
        fs.writeFileSync(path.join(configDir, 'config_v2.json'), JSON.stringify(initialConfig));

        // Load config
        config = new ConfigManager();
        
        // Check initial state
        expect(config.getSecretaryId()).toBe('sec');
        
        // Delete key
        config.setApiKey('openai', '');
        
        // Verify fix
        expect(config.getSecretaryId()).toBeUndefined();
    });
});
