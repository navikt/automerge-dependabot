// Define mocks before imports
const mockAddWorkflowSummary = jest.fn().mockResolvedValue({});

// Mock modules
jest.mock('../src/summary', () => ({
  addWorkflowSummary: mockAddWorkflowSummary,
  getSummaryContent: jest.fn()
}));
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('path', () => {
  const originalPath = jest.requireActual('path');
  return {
    ...originalPath,
    join: jest.fn((...args) => originalPath.join(...args)),
    resolve: jest.fn((...args) => originalPath.resolve(...args))
  };
});
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    readFileSync: jest.fn((path) => {
      // Return mock content for the PR files
      if (path.includes('pr11.md')) {
        return originalFs.readFileSync('__tests__/data/pr11.md', 'utf8');
      }
      if (path.includes('pr12.md')) {
        return originalFs.readFileSync('__tests__/data/pr12.md', 'utf8');
      }
      if (path.includes('pr13.md')) {
        return originalFs.readFileSync('__tests__/data/pr13.md', 'utf8');
      }
      if (path.includes('pr14.md')) {
        return originalFs.readFileSync('__tests__/data/pr14.md', 'utf8');
      }
      return originalFs.readFileSync(path);
    })
  };
});

// Now import modules
const core = require('@actions/core');
const { run } = require('../src/index');
const { setupTestEnvironment, createMockPR } = require('./helpers/mockSetup');
const fs = require('fs');

describe('Multiple PR filtering scenario', () => {
  let mockOctokit;

  beforeEach(() => {
    // Set up test environment with filtering configuration
    const result = setupTestEnvironment({
      inputOverrides: {
        "ignored-dependencies": "path-to-regexp@*,express,react@19.1.0,react-dom@19.1.0",
        "always-allow": "gradle/actions",
        "ignored-versions": "react-scripts@4.0.0",
        "semver-filter": "minor,patch"
      }
    });
    mockOctokit = result.mockOctokit;
  });

  test('should correctly filter PRs based on dependencies', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    
    // Create mock PRs using data from the test files
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          number: 11,
          title: "Bump cookie and express in /my-app",
          body: fs.readFileSync('__tests__/data/pr11.md', 'utf8'),
          created_at: fourDaysAgo,
          head: { sha: 'sha11' },
          html_url: 'https://github.com/owner/repo/pull/11'
        }),
        createMockPR({
          number: 12,
          title: "Bump gradle/actions from 3.1.0 to 4.3.1 in the github group",
          body: fs.readFileSync('__tests__/data/pr12.md', 'utf8'),
          created_at: fourDaysAgo,
          head: { sha: 'sha12' },
          html_url: 'https://github.com/owner/repo/pull/12'
        }),
        createMockPR({
          number: 13,
          title: "Bumps the maven group in /app with 3 updates",
          body: fs.readFileSync('__tests__/data/pr13.md', 'utf8'),
          created_at: fourDaysAgo,
          head: { sha: 'sha13' },
          html_url: 'https://github.com/owner/repo/pull/13'
        }),
        createMockPR({
          number: 14,
          title: "Bump the npm group in /my-app with 7 updates",
          body: fs.readFileSync('__tests__/data/pr14.md', 'utf8'),
          created_at: fourDaysAgo,
          head: { sha: 'sha14' },
          html_url: 'https://github.com/owner/repo/pull/14'
        })
      ]
    });

    // Run the action
    await run();
    
    // Verify workflow summary was generated
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
    
    // PR #11 contains 'express' which is in ignored-dependencies
    // PR #14 contains react-scripts@4.0.0 which is in ignored-versions
    // PR #13 contains org.springframework.boot:spring-boot-starter-web major upgrade from 2.8.0 to 3.4.5
    // Only PR #12 should be merged
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        pull_number: 12, // Only PR #12 should be merged
        owner: 'owner',
        repo: 'repo',
        merge_method: 'merge'
      })
    );

    // Verify that PR #11 was filtered out due to express
    expect(core.debug).toHaveBeenCalledWith(
      expect.stringContaining('PR #11: Dependency validation failed - Dependency "express" is in ignored list')
    );

    // PR #13 contains a major upgrade in the springframework dependency
    expect(core.debug).toHaveBeenCalledWith(
      expect.stringContaining('PR #13: Dependency validation failed - Semver change "major" for "org.springframework.boot:spring-boot-starter-web" is not in allowed list')
    );
    
    // PR #14 is failing due to a major semver change
    expect(core.debug).toHaveBeenCalledWith(
      expect.stringContaining('PR #14: Dependency validation failed - Semver change "major" for "@testing-library/jest-dom" is not in allowed list')
    );
    
    // Logging should mention processing 4 PRs
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Finding eligible pull requests'));
  });
});
