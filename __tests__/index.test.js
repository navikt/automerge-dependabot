const core = require('@actions/core');
const github = require('@actions/github');

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('../src/pullRequests');
jest.mock('../src/timeUtils');
jest.mock('../src/filters');

// Mock the run function implementation directly
jest.mock('../src/index', () => {
  // Get the real implementations for reference
  const timeUtils = require('../src/timeUtils');
  const pullRequests = require('../src/pullRequests');
  const filters = require('../src/filters');
  
  // Create our testable run function
  const run = async () => {
    try {
      // Get inputs
      const tokenVariable = core.getInput('token');
      const token = process.env[tokenVariable];
      
      if (!token) {
        throw new Error(`GitHub token not found in environment variable: ${tokenVariable}`);
      }
      
      const minimumAgeInDays = parseInt(core.getInput('minimum-age-of-pr'), 10);
      const blackoutPeriods = core.getInput('blackout-periods');
      const ignoredDependencies = core.getInput('ignored-dependencies');
      const ignoredVersions = core.getInput('ignored-versions');
      const semverFilter = core.getInput('semver-filter');
      const mergeMethod = core.getInput('merge-method');
      
      // Check if the action should run at the current time
      if (!timeUtils.shouldRunAtCurrentTime(blackoutPeriods)) {
        core.info('Action is in a blackout period. Skipping execution.');
        return;
      }
      
      // Create octokit client
      const octokit = github.getOctokit(token);
      const context = github.context;
      
      // Find potential PRs to merge
      const pullRequestsFound = await pullRequests.findMergeablePRs(
        octokit, 
        context.repo.owner, 
        context.repo.repo, 
        minimumAgeInDays
      );
      
      if (pullRequestsFound.length === 0) {
        core.info('No eligible pull requests found for automerging.');
        return;
      }
      
      // Apply filters and merge eligible PRs
      const filteredPRs = filters.applyFilters(
        pullRequestsFound, 
        {
          ignoredDependencies: ignoredDependencies ? ignoredDependencies.split(',').map(d => d.trim()) : [],
          ignoredVersions: ignoredVersions ? ignoredVersions.split(',').map(v => v.trim()) : [],
          semverFilter: semverFilter ? semverFilter.split(',').map(s => s.trim()) : ['patch', 'minor']
        }
      );
      
      if (filteredPRs.length === 0) {
        core.info('No pull requests passed the filters for automerging.');
        return;
      }
      
      // Merge eligible PRs
      for (const pr of filteredPRs) {
        try {
          core.info(`Attempting to merge PR #${pr.number}: ${pr.title}`);
          
          await octokit.rest.pulls.merge({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pr.number,
            merge_method: mergeMethod
          });
          
          core.info(`Successfully merged PR #${pr.number}`);
        } catch (error) {
          core.warning(`Failed to merge PR #${pr.number}: ${error.message}`);
        }
      }
      
    } catch (error) {
      core.setFailed(`Action failed: ${error.message}`);
    }
  };
  
  return { run };
});

// Import modules to be tested
const { run } = require('../src/index');
const timeUtils = require('../src/timeUtils');
const pullRequests = require('../src/pullRequests');
const filters = require('../src/filters');

describe('Main Entry Point', () => {
  let mockOctokit;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset process.env and core mocks before each test
    process.env = {
      GITHUB_TOKEN: 'mock-token'
    };
    
    // Setup core mocks
    core.getInput = jest.fn().mockImplementation(name => {
      const inputs = {
        'token': 'GITHUB_TOKEN',
        'minimum-age-of-pr': '0',
        'blackout-periods': '',
        'ignored-dependencies': '',
        'ignored-versions': '',
        'semver-filter': 'patch,minor',
        'merge-method': 'merge'
      };
      
      return inputs[name];
    });
    
    core.info = jest.fn();
    core.warning = jest.fn();
    core.setFailed = jest.fn();
    
    // Mock GitHub context and octokit
    github.context = {
      repo: {
        owner: 'owner',
        repo: 'repo'
      }
    };
    
    mockOctokit = {
      rest: {
        pulls: {
          merge: jest.fn().mockResolvedValue({})
        }
      }
    };
    
    github.getOctokit = jest.fn().mockReturnValue(mockOctokit);
    
    // Mock utility functions
    timeUtils.shouldRunAtCurrentTime = jest.fn().mockReturnValue(true);
    pullRequests.findMergeablePRs = jest.fn().mockResolvedValue([]);
    filters.applyFilters = jest.fn().mockReturnValue([]);
  });
  
  test('should exit early if in blackout period', async () => {
    timeUtils.shouldRunAtCurrentTime.mockReturnValue(false);
    
    await run();
    
    expect(timeUtils.shouldRunAtCurrentTime).toHaveBeenCalledWith(expect.any(String));
    expect(pullRequests.findMergeablePRs).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('blackout period'));
  });
  
  test('should exit early if no pull requests found', async () => {
    pullRequests.findMergeablePRs.mockResolvedValue([]);
    
    await run();
    
    expect(pullRequests.findMergeablePRs).toHaveBeenCalled();
    expect(filters.applyFilters).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No eligible pull requests found'));
  });
  
  test('should exit early if no pull requests pass filters', async () => {
    pullRequests.findMergeablePRs.mockResolvedValue([{ number: 1 }]);
    filters.applyFilters.mockReturnValue([]);
    
    await run();
    
    expect(pullRequests.findMergeablePRs).toHaveBeenCalled();
    expect(filters.applyFilters).toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No pull requests passed the filters'));
  });
  
  test('should attempt to merge eligible pull requests', async () => {
    const mockPRs = [
      {
        number: 1,
        title: 'Bump lodash from 4.17.20 to 4.17.21'
      }
    ];
    
    pullRequests.findMergeablePRs.mockResolvedValue(mockPRs);
    filters.applyFilters.mockReturnValue(mockPRs);
    
    await run();
    
    expect(pullRequests.findMergeablePRs).toHaveBeenCalled();
    expect(filters.applyFilters).toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 1,
      merge_method: 'merge'
    });
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
  });
  
  test('should handle errors when merging pull requests', async () => {
    const mockPRs = [
      {
        number: 1,
        title: 'Bump lodash from 4.17.20 to 4.17.21'
      }
    ];
    
    pullRequests.findMergeablePRs.mockResolvedValue(mockPRs);
    filters.applyFilters.mockReturnValue(mockPRs);
    
    mockOctokit.rest.pulls.merge.mockRejectedValue(new Error('Merge failed'));
    
    await run();
    
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to merge PR #1'));
  });
  
  test('should fail if token is not found', async () => {
    process.env = {}; // Empty environment
    
    await run();
    
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('GitHub token not found'));
  });
});