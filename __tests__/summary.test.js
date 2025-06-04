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

    await addWorkflowSummary(allPRs, prsToMerge, filters, allPRs);

    // Check that summary.addRaw was called with the correct PR overview information
    // We're checking that all PRs are included
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Check that addRaw is called - we don't need to check exact count as the implementation 
    // might change based on how many sections are displayed
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Verify PRs to be merged table - since we're adding rows individually now, 
    // we need to check across multiple addRaw calls
    const allCalls = mockSummary.addRaw.mock.calls;
    const mergeCallContents = allCalls.map(call => call[0]);
    
    // Check header call
    const headerCall = mergeCallContents.find(content => 
      content.includes('| PR | Dependency | Version |') && 
      content.includes('| --- | --- | --- |'));
    expect(headerCall).toBeTruthy();
    
    // Check individual PR rows
    const pr1Call = mergeCallContents.find(content => 
      content.includes('[#1]') && 
      content.includes('lodash') && 
      content.includes('4.17.21'));
    expect(pr1Call).toBeTruthy();
    
    const pr3AxiosCall = mergeCallContents.find(content => 
      content.includes('[#3]') && 
      content.includes('axios') && 
      content.includes('0.21.4'));
    expect(pr3AxiosCall).toBeTruthy();
    
    const pr3ExpressCall = mergeCallContents.find(content => 
      content.includes('[#3]') && 
      content.includes('express') && 
      content.includes('4.17.2'));
    expect(pr3ExpressCall).toBeTruthy();
    
    // PR #2 should NOT be in the merge section - find if there's any row that has PR #2
    // and is listed under the Pull Requests to Merge section
    const mergeTableLabel = mergeCallContents.find(content => 
      content.includes('Pull Requests to Merge'));
    
    // Only check this if we found the merge section label
    if (mergeTableLabel) {
      // Find the index of the merge section label
      const mergeSectionIndex = mergeCallContents.indexOf(mergeTableLabel);
      
      // Check in rows after the merge section header but before the filtered section
      const filteredSectionLabel = mergeCallContents.find(content => 
        content.includes('Filtered Out Dependencies'));
      const filteredSectionIndex = filteredSectionLabel ? 
        mergeCallContents.indexOf(filteredSectionLabel) : mergeCallContents.length;
      
      // Look for PR #2 between merge section and filtered section
      let pr2InMergeSection = false;
      for (let i = mergeSectionIndex; i < filteredSectionIndex; i++) {
        if (mergeCallContents[i].includes('[#2]') && mergeCallContents[i].includes('react')) {
          pr2InMergeSection = true;
          break;
        }
      }
      
      expect(pr2InMergeSection).toBeFalsy();
    }

    // Verify that filtered out dependencies are shown in the filtered section
    const filteredSectionLabel = mergeCallContents.find(content => 
      content.includes('Filtered Out Dependencies'));
    
    // Check that we found the filtered section header
    expect(filteredSectionLabel).toBeTruthy();
    
    // Find the index of the filtered section
    if (filteredSectionLabel) {
      const filteredSectionIndex = mergeCallContents.indexOf(filteredSectionLabel);
      
      // Check header for filtered section
      const filteredHeader = mergeCallContents.find((content, index) => 
        index > filteredSectionIndex && 
        content.includes('| PR | Dependency | Version | Reason for Filtering |') &&
        content.includes('| --- | --- | --- | --- |'));
      expect(filteredHeader).toBeTruthy();
      
      // Check if PR #2 is in the filtered section rows
      let filteredPr2Found = false;
      for (let i = filteredSectionIndex; i < mergeCallContents.length; i++) {
        if (mergeCallContents[i].includes('[#2]') && 
            mergeCallContents[i].includes('react') && 
            mergeCallContents[i].includes('18.0.0') && 
            mergeCallContents[i].includes('Dependency "react" is in ignored list')) {
          filteredPr2Found = true;
          break;
        }
      }
      expect(filteredPr2Found).toBeTruthy();
    }

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

    await addWorkflowSummary(allPRs, prsToMerge, filters, allPRs);

    // Check that summary.addRaw was called
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Verify the summary was written
    expect(mockSummary.write).toHaveBeenCalled();
  });

  test('should show PRs filtered during basic criteria phase', async () => {
    // Sample PRs that were filtered out during basic criteria
    const initialPRs = [
      {
        number: 5,
        html_url: 'https://github.com/owner/repo/pull/5',
        title: 'Bump lodash from 4.17.20 to 4.17.21'
      },
      {
        number: 6,
        html_url: 'https://github.com/owner/repo/pull/6',
        title: 'Bump react from 17.0.1 to 18.0.0'
      }
    ];

    // All PRs were filtered out during basic criteria (none passed)
    const allPRs = [];
    const prsToMerge = [];

    // Mock the getFilterReasons to return basic criteria reasons
    const { getFilterReasons } = require('../src/filters');
    getFilterReasons.mockImplementation(prNumber => {
      if (prNumber === 5) {
        return [{ dependency: 'general', reason: 'PR is not mergeable' }];
      }
      if (prNumber === 6) {
        return [{ dependency: 'general', reason: 'PR is too recent (less than minimum age)' }];
      }
      return null;
    });

    const filters = {
      ignoredDependencies: [],
      alwaysAllow: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor']
    };

    await addWorkflowSummary(allPRs, prsToMerge, filters, initialPRs);

    // Check that summary was called with content
    expect(mockSummary.addRaw).toHaveBeenCalled();

    // Get all the calls to addRaw to verify content
    const allCalls = mockSummary.addRaw.mock.calls;
    const summaryContent = allCalls.map(call => call[0]).join('');

    // Should include section about PRs filtered during basic criteria
    expect(summaryContent).toContain('Pull Requests Filtered Out (Basic Criteria)');

    // Should show the message that PRs were found but none met basic criteria
    expect(summaryContent).toContain('Found 2 open pull request(s), but none met the basic criteria');

    // Should show the table with specific reasons
    expect(summaryContent).toContain('[#5]');
    expect(summaryContent).toContain('PR is not mergeable');
    expect(summaryContent).toContain('[#6]');
    expect(summaryContent).toContain('PR is too recent');

    // Verify the summary was written
    expect(mockSummary.write).toHaveBeenCalled();
  });
});
