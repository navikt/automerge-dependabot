const { shouldAlwaysAllowByLabel } = require('../src/filters');

describe('Label Filtering', () => {
  describe('shouldAlwaysAllowByLabel', () => {
    test('should return true when PR has a matching label', () => {
      const prLabels = [
        { name: 'automerge' },
        { name: 'dependencies' }
      ];
      const alwaysAllowLabels = ['automerge'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(true);
    });

    test('should return true when PR has one of multiple allowed labels', () => {
      const prLabels = [
        { name: 'security' },
        { name: 'dependencies' }
      ];
      const alwaysAllowLabels = ['automerge', 'security', 'critical'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(true);
    });

    test('should return false when PR has no matching labels', () => {
      const prLabels = [
        { name: 'bug' },
        { name: 'enhancement' }
      ];
      const alwaysAllowLabels = ['automerge', 'security'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should return false when PR has no labels', () => {
      const prLabels = [];
      const alwaysAllowLabels = ['automerge'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should return false when always-allow-labels list is empty', () => {
      const prLabels = [
        { name: 'automerge' }
      ];
      const alwaysAllowLabels = [];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should be case-insensitive when matching labels', () => {
      const prLabels = [
        { name: 'AutoMerge' }
      ];
      const alwaysAllowLabels = ['automerge'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(true);
    });

    test('should handle undefined PR labels', () => {
      const prLabels = undefined;
      const alwaysAllowLabels = ['automerge'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should handle null PR labels', () => {
      const prLabels = null;
      const alwaysAllowLabels = ['automerge'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should handle undefined always-allow-labels', () => {
      const prLabels = [
        { name: 'automerge' }
      ];
      const alwaysAllowLabels = undefined;
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should handle null always-allow-labels', () => {
      const prLabels = [
        { name: 'automerge' }
      ];
      const alwaysAllowLabels = null;
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(false);
    });

    test('should match multiple PR labels against allowed list', () => {
      const prLabels = [
        { name: 'dependencies' },
        { name: 'security' },
        { name: 'critical' }
      ];
      const alwaysAllowLabels = ['critical'];
      
      expect(shouldAlwaysAllowByLabel(prLabels, alwaysAllowLabels)).toBe(true);
    });
  });
});
