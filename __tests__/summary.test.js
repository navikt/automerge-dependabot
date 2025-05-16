// Mock modules before requiring the code under test
const mockSummary = {
  addHeading: jest.fn().mockReturnThis(),
  addRaw: jest.fn().mockReturnThis(),
  write: jest.fn().mockResolvedValue(undefined)
};

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  summary: mockSummary,
  getInput: jest.fn().mockImplementation(name => name === 'blackout-periods' ? '' : '')
}));

// Import after mocking
const core = require('@actions/core');
const { addWorkflowSummary } = require('../src/summary');

// Mock the filters module
jest.mock('../src/filters', () => ({
  getFilterReasons: jest.fn().mockImplementation(prNumber => {
    if (prNumber === 2) {
      return [
        { dependency: 'react', reason: 'Dependency "react" is in ignored list' }
      ];
    }
    return null;
  })
}));

// Mock the timeUtils module
jest.mock('../src/timeUtils', () => ({
  shouldRunAtCurrentTime: jest.fn().mockReturnValue(true)
}));

describe('addWorkflowSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should include all PRs in the overview table with correct status', async () => {
    // Sample PR data
    const allPRs = [
      {
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        dependencyInfo: {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21',
          semverChange: 'patch'
        }
      },
      {
        number: 2,
        html_url: 'https://github.com/owner/repo/pull/2',
        dependencyInfo: {
          name: 'react',
          fromVersion: '17.0.1',
          toVersion: '18.0.0',
          semverChange: 'major'
        }
      },
      {
        number: 3,
        html_url: 'https://github.com/owner/repo/pull/3',
        dependencyInfoList: [
          {
            name: 'axios',
            fromVersion: '0.21.1',
            toVersion: '0.21.4',
            semverChange: 'patch'
          },
          {
            name: 'express',
            fromVersion: '4.17.1',
            toVersion: '4.17.2',
            semverChange: 'patch'
          }
        ]
      }
    ];

    // Only the first and third PR will be merged
    const prsToMerge = [allPRs[0], allPRs[2]];

    const filters = {
      ignoredDependencies: ['react'],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor']
    };

    await addWorkflowSummary(allPRs, prsToMerge, filters);

    // Check that summary.addRaw was called with the correct PR overview information
    // We're checking that all PRs are included
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Check number of calls to addRaw
    expect(mockSummary.addRaw).toHaveBeenCalledTimes(7);

    // Verify the overview status for PRs
    const allCalls = mockSummary.addRaw.mock.calls;
    let overviewTableContent = null;
    for (const call of allCalls) {
      const content = call[0];
      if (content.includes('PR | Dependency | Status')) {
        overviewTableContent = content;
        break;
      }
    }

    // Check that overview table includes all PRs with correct status
    expect(overviewTableContent).not.toBeNull();
    expect(overviewTableContent).toContain('[#1]');
    expect(overviewTableContent).toContain('lodash@4.17.21');
    expect(overviewTableContent).toContain('✅ Will merge');
    expect(overviewTableContent).toContain('[#2]');
    expect(overviewTableContent).toContain('react@18.0.0');
    expect(overviewTableContent).toContain('❌ Filtered out');
    expect(overviewTableContent).toContain('[#3]');
    expect(overviewTableContent).toContain('axios@0.21.4');
    expect(overviewTableContent).toContain('✅ Will merge');
    expect(overviewTableContent).toContain('express@4.17.2');
    expect(overviewTableContent).toContain('✅ Will merge');

    // Verify that details for filtered out PRs are shown in the details section
    let filteredDetailsContent = null;
    for (const call of mockSummary.addRaw.mock.calls) {
      const content = call[0];
      if (content.includes('PR | Dependency | Reason')) {
        filteredDetailsContent = content;
        break;
      }
    }

    // Check filtered details section
    expect(filteredDetailsContent).not.toBeNull();
    expect(filteredDetailsContent).toContain('[#2]');
    expect(filteredDetailsContent).toContain('react');
    expect(filteredDetailsContent).toContain('Dependency "react" is in ignored list');

    // Verify the summary was written
    expect(core.summary.write).toHaveBeenCalled();
  });

  test('should handle PRs with no dependencyInfo', async () => {
    // Sample PR data with missing dependency info
    const allPRs = [
      {
        number: 4,
        html_url: 'https://github.com/owner/repo/pull/4',
        // No dependencyInfo
      }
    ];

    const prsToMerge = []; // No PRs to merge

    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor']
    };

    await addWorkflowSummary(allPRs, prsToMerge, filters);

    // Check that summary.addRaw was called
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Verify the summary was written
    expect(mockSummary.write).toHaveBeenCalled();
  });
});
