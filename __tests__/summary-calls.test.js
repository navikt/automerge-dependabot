const mockAddWorkflowSummary = jest.fn().mockResolvedValue({});

// Mock the summary module before anything else
jest.mock('../src/summary', () => ({
  addWorkflowSummary: mockAddWorkflowSummary,
  getSummaryContent: jest.fn()
}));

// Now that our mock is in place, import other modules
const core = require('@actions/core');
const github = require('@actions/github');
const summaryModule = require('../src/summary');
const { run } = require('../src/index');

// Mock external dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');

describe('workflow summary calls', () => {
  const mockOctokit = {
    rest: {
      pulls: {
        merge: jest.fn(),
        list: jest.fn(),
        get: jest.fn(),
        listCommits: jest.fn(),
        listReviews: jest.fn()
      },
      repos: {
        getCombinedStatusForRef: jest.fn()
      }
    }
  };

  // Set up the GitHub context
  github.context = {
    repo: {
      owner: 'owner',
      repo: 'repo'
    }
  };

  // Set up the GitHub getOctokit function
  github.getOctokit = jest.fn().mockReturnValue(mockOctokit);

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Set up core info and warning mocks to avoid console output in tests
    core.info = jest.fn();
    core.warning = jest.fn();
    
    // Set up core.summary mock to avoid GitHub Actions summary errors
    core.summary = {
      addHeading: jest.fn().mockReturnThis(),
      addRaw: jest.fn().mockReturnThis(),
      write: jest.fn().mockResolvedValue({})
    };
    
    // Set up input values for the action
    core.getInput = jest.fn(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "express,react",
        "always-allow": "",
        "ignored-versions": "",
        "semver-filter": "patch,minor",
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Mock PR list with one eligible PR
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [{ 
        number: 1, 
        title: 'Bump lodash from 4.17.20 to 4.17.21',
        user: { login: 'dependabot[bot]' },
        created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days old
        head: { sha: 'abc123' },
        html_url: 'https://github.com/owner/repo/pull/1'
      }]
    });

    // Set up other required mocks
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { mergeable: true, mergeable_state: 'clean' }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({
      data: { state: 'success' }
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.pulls.merge.mockResolvedValue({});
  });
  
  // Override jest's default timeout for async tests
  jest.setTimeout(10000);

  // Test when PRs are found
  it('should call addWorkflowSummary exactly once when PRs are found', async () => {
    // Call the run function
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
  });

  // Test when no PRs are found
  it('should call addWorkflowSummary exactly once when no PRs are found', async () => {
    // Mock that no PRs are found
    mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
    
    // Call the run function
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
  });

  // Test during blackout periods
  it('should call addWorkflowSummary exactly once during blackout periods', async () => {
    // Set a current blackout period (1 hour ago to 1 hour from now)
    const now = new Date();
    const startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    
    // Override the blackout periods input
    core.getInput.mockImplementation(name => {
      if (name === 'blackout-periods') {
        return `${startTime}/${endTime}`;
      }
      
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "ignored-dependencies": "express,react",
        "always-allow": "",
        "ignored-versions": "",
        "semver-filter": "patch,minor",
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Call the run function
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
  });
});
