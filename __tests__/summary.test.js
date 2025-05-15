const core = require('@actions/core');
const { addWorkflowSummary, getSummaryContent } = require('../src/summary');

// Mock filters.js
jest.mock('../src/filters', () => ({
  getFilterReasons: jest.fn().mockImplementation((prNumber) => {
    if (prNumber === 102) {
      return {
        reasons: ['Semver change "major" is not in allowed list: patch, minor']
      };
    }
    return null;
  }),
  resetFilterReasons: jest.fn()
}));

// Mock pullRequests.js
jest.mock('../src/pullRequests', () => ({
  getEarlyFilterReasons: jest.fn().mockImplementation(() => {
    const reasons = new Map();
    reasons.set(103, { reasons: ['Too recent (created 1 day ago, needs to be at least 2 days old)'] });
    reasons.set(104, { reasons: ['Not in mergeable state'] });
    return reasons;
  })
}));

// Test the summary module
describe('Summary Module Tests', () => {
  // Store original environment
  let originalEnv;
  
  // Mock summary object
  const mockSummary = {
    addHeading: jest.fn().mockReturnThis(),
    addRaw: jest.fn().mockReturnThis(),
    write: jest.fn().mockResolvedValue(undefined)
  };
  
  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Mock core functions
    jest.spyOn(core, 'info').mockImplementation(() => {});
    jest.spyOn(core, 'warning').mockImplementation(() => {});
    
    // Replace core.summary with our mock
    jest.spyOn(core, 'summary', 'get').mockReturnValue(mockSummary);
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });
  
  test('should handle an empty PRs array gracefully', async () => {
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor']
    };
    
    const result = await addWorkflowSummary([], [], filters);
    
    // Verify the summary was created properly
    expect(result).toBeTruthy();
    expect(result.title).toBe('Dependabot Automerge Summary');
    expect(result.prCount.eligible).toBe(0);
    expect(result.prCount.toMerge).toBe(0);
    expect(result.prsToMerge).toEqual([]);
    expect(result.prsFilteredOut).toEqual([]);
    
    // Verify that the core summary was used
    expect(core.summary.addHeading).toHaveBeenCalledWith('Dependabot Automerge Summary');
    expect(core.summary.addRaw).toHaveBeenCalled();
    expect(core.summary.write).toHaveBeenCalled();
    
    // Verify that info was logged
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Added workflow summary'));
  });
  
  test('should show specific filter reasons for filtered out PRs', async () => {
    // Test data
    const eligiblePRs = [
      {
        number: 101,
        html_url: 'https://github.com/owner/repo/pull/101',
        title: 'Bump lodash from 4.17.20 to 4.17.21',
        dependencyInfo: {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21',
          semverChange: 'patch'
        }
      },
      {
        number: 102,
        html_url: 'https://github.com/owner/repo/pull/102',
        title: 'Bump axios from 0.21.0 to 1.0.0',
        dependencyInfo: {
          name: 'axios',
          fromVersion: '0.21.0',
          toVersion: '1.0.0',
          semverChange: 'major'
        }
      }
    ];
    
    const filteredPRs = [eligiblePRs[0]]; // Only first PR will be merged (patch update)
    
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor'] // Major updates are filtered out
    };
    
    const result = await addWorkflowSummary(eligiblePRs, filteredPRs, filters);
    
    // Verify the filter reasons are used
    expect(result.prsFilteredOut.length).toBe(1);
    expect(result.prsFilteredOut[0].reason).toContain('Semver change');
    
    // Check the summary content
    const content = getSummaryContent();
    expect(content).toContain('Semver change');
  });
  
  test('should process PRs with single dependencies', async () => {
    // Test data
    const eligiblePRs = [
      {
        number: 101,
        html_url: 'https://github.com/owner/repo/pull/101',
        title: 'Bump lodash from 4.17.20 to 4.17.21',
        dependencyInfo: {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21',
          semverChange: 'patch'
        }
      },
      {
        number: 102,
        html_url: 'https://github.com/owner/repo/pull/102',
        title: 'Bump axios from 0.21.0 to 1.0.0',
        dependencyInfo: {
          name: 'axios',
          fromVersion: '0.21.0',
          toVersion: '1.0.0',
          semverChange: 'major'
        }
      }
    ];
    
    const filteredPRs = [eligiblePRs[0]]; // Only first PR will be merged (patch update)
    
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor'] // Major updates are filtered out
    };
    
    const result = await addWorkflowSummary(eligiblePRs, filteredPRs, filters);
    
    // Verify the structured result
    expect(result.prCount.eligible).toBe(2);
    expect(result.prCount.toMerge).toBe(1);
    
    // Verify PRs to merge
    expect(result.prsToMerge.length).toBe(1);
    expect(result.prsToMerge[0].prNumber).toBe(101);
    expect(result.prsToMerge[0].dependency).toBe('lodash');
    expect(result.prsToMerge[0].semverChange).toBe('patch');
    
    // Verify filtered out PRs
    expect(result.prsFilteredOut.length).toBe(1);
    expect(result.prsFilteredOut[0].prNumber).toBe(102);
    expect(result.prsFilteredOut[0].dependency).toBe('axios');
    expect(result.prsFilteredOut[0].semverChange).toBe('major');
    expect(result.prsFilteredOut[0].reason).toContain('Semver change');
    
    // Check summary content was generated
    const summaryText = getSummaryContent();
    expect(summaryText).toContain('Dependabot Automerge Summary');
    expect(summaryText).toContain('lodash');
    expect(summaryText).toContain('axios');
  });
  
  test('should process PRs with multiple dependencies', async () => {
    // Test data for a group PR
    const eligiblePRs = [
      {
        number: 103,
        html_url: 'https://github.com/owner/repo/pull/103',
        title: 'Bump the npm group with 3 updates',
        dependencyInfoList: [
          {
            name: 'lodash',
            fromVersion: '4.17.20',
            toVersion: '4.17.21',
            semverChange: 'patch'
          },
          {
            name: 'express',
            fromVersion: '4.17.1',
            toVersion: '4.17.2',
            semverChange: 'patch'
          },
          {
            name: 'react',
            fromVersion: '17.0.1',
            toVersion: '18.0.0',
            semverChange: 'major'
          }
        ]
      }
    ];
    
    const filteredPRs = []; // No PRs will be merged because one dep is major
    
    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor'] // Major updates are filtered out
    };
    
    const result = await addWorkflowSummary(eligiblePRs, filteredPRs, filters);
    
    // Verify the structured result
    expect(result.prCount.eligible).toBe(1);
    expect(result.prCount.toMerge).toBe(0);
    
    // Verify no PRs to merge
    expect(result.prsToMerge.length).toBe(0);
    
    // Verify filtered out PRs - should include all three dependencies
    expect(result.prsFilteredOut.length).toBe(3);
    
    // The react dependency should be marked as major
    const reactDep = result.prsFilteredOut.find(dep => dep.dependency === 'react');
    expect(reactDep).toBeTruthy();
    expect(reactDep.semverChange).toBe('major');
    expect(reactDep.reason).toContain('Semver change');
    
    // Check summary content was generated
    const summaryText = getSummaryContent();
    expect(summaryText).toContain('Dependabot Automerge Summary');
    expect(summaryText).toContain('lodash');
    expect(summaryText).toContain('express');
    expect(summaryText).toContain('react');
  });
  
  test('should handle errors gracefully', async () => {
    // Mock write to throw an error
    core.summary.write.mockRejectedValueOnce(new Error('Test error'));
    
    const result = await addWorkflowSummary([], [], {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: []
    });
    
    // Verify warning was logged
    expect(core.warning).toHaveBeenCalledWith('Failed to add workflow summary: Test error');
    expect(result).toBeNull();
  });
});
