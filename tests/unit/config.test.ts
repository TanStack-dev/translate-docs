import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../../src/config';
import { cosmiconfig } from 'cosmiconfig';

// Mock the cosmiconfig module
vi.mock('cosmiconfig', () => ({
  cosmiconfig: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('config', () => {
  // Common mocks
  const mockLoad = vi.fn();
  const mockSearch = vi.fn();
  const mockExplorer = { load: mockLoad, search: mockSearch };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup the default cosmiconfig mock
    (cosmiconfig as any).mockReturnValue(mockExplorer);
  });

  describe('getConfig', () => {
    it('should load config from specific file when provided', async () => {
      // Setup the mock to return a valid config
      const configFile = 'custom.config.mjs';
      const mockConfig = { project: 'test', languages: ['fr', 'es'] };
      mockLoad.mockResolvedValue({ config: mockConfig, filepath: configFile });

      // Call the function with a specific config file
      const result = await getConfig({ config: configFile });

      // Assertions
      expect(cosmiconfig).toHaveBeenCalledWith('translation', expect.any(Object));
      expect(mockLoad).toHaveBeenCalledWith(configFile);
      expect(result).toEqual(mockConfig);
    });

    it('should search for config when no specific file is provided', async () => {
      // Setup the mock to return a valid config
      const mockConfig = { project: 'test', languages: ['fr', 'es'] };
      mockSearch.mockResolvedValue({
        config: mockConfig,
        filepath: 'translation.config.mjs',
      });

      // Call the function without a specific config file
      const result = await getConfig({});

      // Assertions
      expect(cosmiconfig).toHaveBeenCalledWith('translation', expect.any(Object));
      expect(mockSearch).toHaveBeenCalled();
      expect(result).toEqual(mockConfig);
    });

    it('should return empty config when no config file is found', async () => {
      // Setup the mock to return null (no config found)
      mockSearch.mockResolvedValue(null);

      // Call the function
      const result = await getConfig({});

      // Assertions
      expect(result).toEqual({});
    });

    it('should handle errors when loading config file', async () => {
      // Setup the mock to throw an error
      const configFile = 'broken.config.mjs';
      const error = new Error('Config file not found');
      mockLoad.mockRejectedValue(error);

      // Mock process.exit to prevent the test from actually exiting
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(vi.fn() as any);

      // Call the function with a specific config file that will error
      await getConfig({ config: configFile });

      // Assertions
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
