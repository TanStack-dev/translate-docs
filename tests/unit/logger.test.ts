import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/logger';

describe('logger', () => {
  // Spy on console methods
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    // Reset verbose mode after each test
    logger.setVerbose(false);
  });
  
  describe('log levels', () => {
    it('should log info messages', () => {
      logger.info('Test info message');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Test info message');
    });
    
    it('should log success messages', () => {
      logger.success('Test success message');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[SUCCESS]');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Test success message');
    });
    
    it('should log warning messages', () => {
      logger.warn('Test warning message');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[WARN]');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Test warning message');
    });
    
    it('should log error messages', () => {
      logger.error('Test error message');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[ERROR]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Test error message');
    });
  });
  
  describe('debug logging', () => {
    it('should not log debug messages when verbose is false', () => {
      logger.setVerbose(false);
      logger.debug('Test debug message');
      
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
    
    it('should log debug messages when verbose is true', () => {
      logger.setVerbose(true);
      logger.debug('Test debug message');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Test debug message');
    });
  });
  
  describe('divider', () => {
    it('should log a divider line', () => {
      logger.divider();
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('='.repeat(80));
    });
  });
  
  describe('progress', () => {
    it('should display progress bar with percentage', () => {
      logger.progress(50, 100, 'Processing items');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Processing items:');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('50/100');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('(50%)');
    });
    
    it('should include action message when provided', () => {
      logger.progress(25, 100, 'Processing items', 'Processing item 25');
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Processing items:');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('25/100');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Processing item 25');
    });
  });
});