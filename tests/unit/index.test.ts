import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { getConfig } from '../../src/config';
import { logger } from '../../src/logger';
import { main } from '../../src/main';

// Mock dependencies
vi.mock('commander', () => {
  const mockCommand = {
    name: vi.fn().mockReturnThis(),
    description: vi.fn().mockReturnThis(),
    version: vi.fn().mockReturnThis(),
    option: vi.fn().mockReturnThis(),
    action: vi.fn(cb => {
      // Store the callback for tests to access
      (mockCommand as any)._actionCallback = cb;
      return mockCommand;
    }),
    parse: vi.fn().mockReturnThis(),
    // Add this helper property to access the stored callback
    _actionCallback: null,
  };
  return {
    Command: vi.fn(() => mockCommand),
  };
});

vi.mock('../../src/config', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../../src/logger', () => ({
  logger: {
    setVerbose: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/main', () => ({
  main: vi.fn(),
}));

describe('index/CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset modules to get a fresh command instance for each test
    vi.resetModules();
  });
  
  it('should configure the CLI with correct options', async () => {
    // Import the module to trigger the CLI configuration
    await import('../../src/index');
    
    const mockCommand = new Command();
    
    // Verify basic command configuration
    expect(mockCommand.name).toHaveBeenCalledWith('tanstack-translation');
    expect(mockCommand.description).toHaveBeenCalledWith('Translate tanstack docs');
    expect(mockCommand.version).toHaveBeenCalled();
    
    // Verify all options are registered
    expect(mockCommand.option).toHaveBeenCalledWith('-c, --config <path>', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('--verbose', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('-p, --pattern <pattern>', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('-y, --copy-path <pattern>', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('-d, --docs-path <pattern>', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('-l, --list-only', expect.any(String));
    expect(mockCommand.option).toHaveBeenCalledWith('-t, --target-language <language>', expect.any(String));
    
    // Verify action is registered
    expect(mockCommand.action).toHaveBeenCalledWith(expect.any(Function));
    expect(mockCommand.parse).toHaveBeenCalled();
  });
  
  it('should call main function with correct configuration', async () => {
    // Import to trigger CLI setup
    await import('../../src/index');
    
    // Get the stored action callback
    const mockCommand = new Command();
    const actionCallback = (mockCommand as any)._actionCallback;
    
    // Mock config result
    const mockConfig = {
      langs: { fr: { name: 'French' } },
      docsRoot: '/docs',
      docsContext: 'Test context',
    };
    vi.mocked(getConfig).mockResolvedValue(mockConfig);
    
    // Execute the action callback with CLI options
    await actionCallback({
      verbose: true,
      pattern: '**/*.md',
      copyPath: 'examples/**',
      targetLanguage: 'fr',
    });
    
    // Verify logger.setVerbose was called for verbose option
    expect(logger.setVerbose).toHaveBeenCalledWith(true);
    
    // Verify getConfig was called
    expect(getConfig).toHaveBeenCalledWith(expect.objectContaining({
      verbose: true,
      pattern: '**/*.md',
      copyPath: 'examples/**',
      targetLanguage: 'fr',
    }));
    
    // Verify main was called with merged config
    expect(main).toHaveBeenCalledWith({
      ...mockConfig,
      pattern: '**/*.md',
      copyPath: 'examples/**',
      targetLanguage: 'fr',
    });
    
    // Verify success message
    expect(logger.success).toHaveBeenCalledWith('Process completed successfully');
  });
  
  it('should handle array of configs', async () => {
    // Import to trigger CLI setup
    await import('../../src/index');
    
    // Get the stored action callback
    const mockCommand = new Command();
    const actionCallback = (mockCommand as any)._actionCallback;
    
    // Mock multiple configs
    const mockConfigs = [
      {
        langs: { fr: { name: 'French' } },
        docsRoot: '/docs/project1',
        docsContext: 'Project 1 context',
      },
      {
        langs: { es: { name: 'Spanish' } },
        docsRoot: '/docs/project2',
        docsContext: 'Project 2 context',
      }
    ];
    vi.mocked(getConfig).mockResolvedValue(mockConfigs);
    
    // Execute the action callback
    await actionCallback({
      listOnly: true,
    });
    
    // Verify main was called for each config
    expect(main).toHaveBeenCalledTimes(2);
    expect(main).toHaveBeenNthCalledWith(1, expect.objectContaining({
      docsRoot: '/docs/project1',
      listOnly: true,
    }));
    expect(main).toHaveBeenNthCalledWith(2, expect.objectContaining({
      docsRoot: '/docs/project2',
      listOnly: true,
    }));
  });
});