const { applyFilters, shouldAlwaysAllow, getFilterReasons, resetFilterReasons, getAllFilterReasons, recordFilterReason } = require('../src/filters');
const core = require('@actions/core');

// Mock core module
jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn()
}));

describe('Filters Reasons Tracking', () => {
  beforeEach(() => {
    resetFilterReasons();
    jest.clearAllMocks(); // Clear all mock calls between tests
  });
  
  test('should track reasons for filtering out PRs not created by dependabot', () => {
    const nonDependabotPR = {
      number: 1,
      user: { login: 'user' },
      title: 'Some PR'
    };
    
    applyFilters([nonDependabotPR], {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(1);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Not created by Dependabot');
  });
  
  test('should track reasons for filtering out ignored dependencies', () => {
    const pr = {
      number: 1,
      user: { login: 'dependabot[bot]' },
      title: 'Bump test-dep from 1.0.0 to 1.1.0',
      dependencyInfo: {
        name: 'test-dep',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        semverChange: 'minor'
      }
    };
    
    applyFilters([pr], {
      ignoredDependencies: ['test-dep'],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(1);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Dependency "test-dep" is in ignored list');
  });
  
  test('should track reasons for filtering out ignored versions', () => {
    const pr = {
      number: 1,
      user: { login: 'dependabot[bot]' },
      title: 'Bump test-dep from 1.0.0 to 1.1.0',
      dependencyInfo: {
        name: 'test-dep',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        semverChange: 'minor'
      }
    };
    
    applyFilters([pr], {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: ['test-dep@1.1.0'],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(1);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Version "test-dep@1.1.0" is in ignored list');
  });
  
  test('should track reasons for filtering out based on semver level', () => {
    const pr = {
      number: 1,
      user: { login: 'dependabot[bot]' },
      title: 'Bump test-dep from 1.0.0 to 2.0.0',
      dependencyInfo: {
        name: 'test-dep',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        semverChange: 'major'
      }
    };
    
    applyFilters([pr], {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(1);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Semver change "major" is not in allowed list');
  });
  
  test('should track reasons for filtering out multi-dependency PRs', () => {
    const multiDependencyPR = {
      number: 2,
      user: { login: 'dependabot[bot]' },
      title: 'Bump multiple dependencies',
      dependencyInfoList: [
        {
          name: 'express',
          fromVersion: '4.17.1',
          toVersion: '4.17.2',
          semverChange: 'patch'
        },
        {
          name: 'react',
          fromVersion: '17.0.2',
          toVersion: '18.0.0',
          semverChange: 'major'
        }
      ]
    };
    
    applyFilters([multiDependencyPR], {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(2);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Semver change "major" for "react" is not in allowed list');
  });
  
  test('should record reasons for multi-dependency PRs when a dependency is in ignored list', () => {
    const multiDependencyPR = {
      number: 3,
      user: { login: 'dependabot[bot]' },
      title: 'Bump multiple dependencies',
      dependencyInfoList: [
        {
          name: 'express',
          fromVersion: '4.17.1',
          toVersion: '4.17.2',
          semverChange: 'patch'
        },
        {
          name: 'ignored-dep',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          semverChange: 'minor'
        }
      ]
    };
    
    applyFilters([multiDependencyPR], {
      ignoredDependencies: ['ignored-dep'],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['minor', 'patch']
    });
    
    // Check that a reason was recorded
    const reasons = getFilterReasons(3);
    expect(reasons).not.toBeNull();
    expect(reasons.reasons[0]).toContain('Dependency "ignored-dep" is in ignored list');
  });
  
  test('should properly reset all filter reasons', () => {
    // First add some filter reasons manually
    recordFilterReason(1, 'Test reason 1');
    recordFilterReason(2, 'Test reason 2');
    
    // Verify reasons exist
    expect(getFilterReasons(1)).not.toBeNull();
    expect(getFilterReasons(2)).not.toBeNull();
    
    // Reset reasons
    resetFilterReasons();
    
    // Verify reasons are cleared
    expect(getFilterReasons(1)).toBeNull();
    expect(getFilterReasons(2)).toBeNull();
  });
  
  test('should return all filter reasons', () => {
    // First add some filter reasons manually
    recordFilterReason(1, 'Test reason 1');
    recordFilterReason(2, 'Test reason 2');
    
    // Get all reasons
    const allReasons = getAllFilterReasons();
    
    // Verify map structure
    expect(allReasons).toBeInstanceOf(Map);
    expect(allReasons.size).toBe(2);
    expect(allReasons.has(1)).toBe(true);
    expect(allReasons.has(2)).toBe(true);
    
    // Verify reason content
    expect(allReasons.get(1).reasons[0]).toBe('Test reason 1');
    expect(allReasons.get(2).reasons[0]).toBe('Test reason 2');
  });
});
