import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeInBatches } from '../../src/batch';

// Mock the logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeInBatches', () => {
    it('should process all items with specified concurrency', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        return item * 2;
      });

      const results = await executeInBatches(items, processor, 2);

      // Check that all items were processed
      expect(processor).toHaveBeenCalledTimes(items.length);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle empty items array', async () => {
      const items: number[] = [];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        return item * 2;
      });

      const results = await executeInBatches(items, processor, 2);

      // Verify processor was never called and results is empty
      expect(processor).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('should continue processing remaining items when some fail', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 3) {
          throw new Error('Test error');
        }
        return item * 2;
      });

      // Mock console.error to prevent it from printing to the console during tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await executeInBatches(items, processor, 2);

      // Verify all items were processed (or attempted)
      expect(processor).toHaveBeenCalledTimes(items.length);
      // Items 1, 2, 4, 5 succeeded (item 3 failed)
      expect(results).toEqual([2, 4, 8, 10]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      // Restore the original console.error
      consoleErrorSpy.mockRestore();
    });

    it('should respect concurrency limits', async () => {
      const items = [1, 2, 3, 4, 5, 6];
      const maxConcurrent = 2;
      const inProgress = new Set();
      let maxObservedConcurrent = 0;

      const processor = vi.fn().mockImplementation(async (item: number) => {
        // Record this item as in progress
        inProgress.add(item);

        // Track maximum observed concurrency
        maxObservedConcurrent = Math.max(maxObservedConcurrent, inProgress.size);

        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Mark item as complete
        inProgress.delete(item);

        return item * 2;
      });

      const results = await executeInBatches(items, processor, maxConcurrent);

      // Verify concurrency limit was respected
      expect(maxObservedConcurrent).toBeLessThanOrEqual(maxConcurrent);
      // Verify all items were processed
      expect(results.length).toBe(items.length);
      // Verify results are correct
      expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    });
  });
});
