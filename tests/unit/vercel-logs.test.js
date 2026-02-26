/**
 * Vercel Logs API Client Tests
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

let vercelLogs;

beforeEach(() => {
  jest.resetModules();
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.VERCEL_TEAM_ID;
  vercelLogs = require('../../api/lib/vercel-logs');
});

afterEach(() => {
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.VERCEL_TEAM_ID;
});

describe('Vercel Logs', () => {
  describe('isConfigured', () => {
    it('should return false when no env vars set', () => {
      expect(vercelLogs.isConfigured()).toBe(false);
    });

    it('should return false when only token is set', () => {
      process.env.VERCEL_TOKEN = 'test-token';
      jest.resetModules();
      vercelLogs = require('../../api/lib/vercel-logs');
      expect(vercelLogs.isConfigured()).toBe(false);
    });

    it('should return false when only project ID is set', () => {
      process.env.VERCEL_PROJECT_ID = 'prj_123';
      jest.resetModules();
      vercelLogs = require('../../api/lib/vercel-logs');
      expect(vercelLogs.isConfigured()).toBe(false);
    });

    it('should return true when both token and project ID are set', () => {
      process.env.VERCEL_TOKEN = 'test-token';
      process.env.VERCEL_PROJECT_ID = 'prj_123';
      jest.resetModules();
      vercelLogs = require('../../api/lib/vercel-logs');
      expect(vercelLogs.isConfigured()).toBe(true);
    });
  });

  describe('fetchRuntimeLogs', () => {
    it('should throw when not configured', async () => {
      await expect(vercelLogs.fetchRuntimeLogs()).rejects.toThrow('VERCEL_TOKEN not configured');
    });
  });

  describe('listDeployments', () => {
    it('should throw when not configured', async () => {
      await expect(vercelLogs.listDeployments()).rejects.toThrow('VERCEL_TOKEN not configured');
    });
  });

  describe('getLatestDeployment', () => {
    it('should throw when not configured', async () => {
      await expect(vercelLogs.getLatestDeployment()).rejects.toThrow('VERCEL_TOKEN not configured');
    });
  });

  describe('Module exports', () => {
    it('should export all expected functions', () => {
      expect(typeof vercelLogs.isConfigured).toBe('function');
      expect(typeof vercelLogs.fetchRuntimeLogs).toBe('function');
      expect(typeof vercelLogs.listDeployments).toBe('function');
      expect(typeof vercelLogs.getLatestDeployment).toBe('function');
    });
  });
});
