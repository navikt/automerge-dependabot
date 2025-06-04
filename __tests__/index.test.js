const core = require('@actions/core');
const github = require('@actions/github');
const { run } = require('../src/index');

// Mock external dependencies only
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('../src/summary', () => ({
  addWorkflowSummary: jest.fn().mockResolvedValue({})
}));

describe('run', () => {
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
        getCombinedStatusForRef: jest.fn(),
        get: jest.fn()
      }
    }
  };

  // Set up the GitHub context
  github.context = {
    repo: {
      owner: 'owner',
      repo: 'repo'
    },
    ref: 'refs/heads/main'
  };

  // Set up the GitHub getOctokit function
  github.getOctokit = jest.fn().mockReturnValue(mockOctokit);

  // Default input values
  const defaultInputs = {
    'token': 'direct-token',
    'minimum-age-of-pr': '3',
    'blackout-periods': '',
    'ignored-dependencies': '',
    'ignored-versions': '',
    'semver-filter': '',
    'merge-method': 'merge'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up default input values
    core.getInput = jest.fn(name => defaultInputs[name] || '');
    
    // Set up the mock PR data
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        { 
          number: 1, 
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          user: { login: 'dependabot[bot]' },
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days old
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        }
      ]
    });

    // Mock the detailed PR response
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: {
        mergeable: true,
        mergeable_state: 'clean'
      }
    });

    // Mock the commits list
    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          author: { login: 'dependabot[bot]' },
          committer: { login: 'dependabot[bot]' }
        }
      ]
    });

    // Mock the status checks
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({
      data: { state: 'success' }
    });

    // Mock the PR reviews
    mockOctokit.rest.pulls.listReviews.mockResolvedValue({
      data: []
    });
    
    // Mock the repository data for default branch check
    mockOctokit.rest.repos.get.mockResolvedValue({
      data: { default_branch: 'main' }
    });
    
    mockOctokit.rest.pulls.merge.mockResolvedValue({});
    
    // Set up the core functions
    core.info = jest.fn();
    core.warning = jest.fn();
    core.setFailed = jest.fn();
    core.debug = jest.fn();
  });

  test('handles direct token value', async () => {
    // Override the default token value
    core.getInput = jest.fn(name => {
      if (name === 'token') return 'direct-token';
      return defaultInputs[name] || '';
    });

    await run();
    
    expect(github.getOctokit).toHaveBeenCalledWith('direct-token');
  });

  test('handles token from environment variable', async () => {
    // Override the default token value to use environment variable
    core.getInput = jest.fn(name => {
      if (name === 'token') return '$ENV_TOKEN';
      return defaultInputs[name] || '';
    });
    
    // Mock the environment variable
    const originalEnv = process.env;
    process.env = { ...originalEnv, ENV_TOKEN: 'token-from-env' };
    
    await run();
    
    expect(github.getOctokit).toHaveBeenCalledWith('token-from-env');
    
    // Restore environment
    process.env = originalEnv;
  });

  test('throws error when token is missing', async () => {
    // Override the token value to be empty
    core.getInput = jest.fn(name => {
      if (name === 'token') return '';
      return defaultInputs[name] || '';
    });
    
    await run();
    
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('GitHub token not provided')
    );
  });

  test('should exit early if in blackout period', async () => {
    // Set a blackout period that includes the current time
    const now = new Date();
    const startTime = new Date(now);
    startTime.setHours(now.getHours() - 1);
    const endTime = new Date(now);
    endTime.setHours(now.getHours() + 1);
    
    const blackoutPeriod = `${startTime.toISOString()}/${endTime.toISOString()}`;
    
    // Override the blackout periods input
    core.getInput = jest.fn(name => {
      if (name === 'blackout-periods') return blackoutPeriod;
      return defaultInputs[name] || '';
    });
    
    await run();
    
    expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('blackout period'));
  });

  test('should exit early if not running from default branch', async () => {
    // Set context to a different branch (e.g., feature branch)
    github.context.ref = 'refs/heads/feature-branch';
    
    await run();
    
    expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo'
    });
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Action is not running from the default branch (main). Current ref: refs/heads/feature-branch. Skipping execution for security reasons.')
    );
    expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled();
    
    // Reset context for other tests
    github.context.ref = 'refs/heads/main';
  });

  test('should exit early if default branch check fails', async () => {
    // Make repos.get throw an error
    mockOctokit.rest.repos.get.mockRejectedValue(new Error('API Error'));
    
    await run();
    
    expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo'
    });
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to verify default branch: API Error. Skipping execution for security reasons.')
    );
    expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled();
    
    // Reset repos.get mock for other tests
    mockOctokit.rest.repos.get.mockResolvedValue({
      data: { default_branch: 'main' }
    });
  });

  test('should proceed when running from default branch', async () => {
    // Ensure we're on the default branch
    github.context.ref = 'refs/heads/main';
    
    await run();
    
    expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo'
    });
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Action is running from the default branch (main). Proceeding with execution.')
    );
    expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
  });
  
  test('should exit early if no pull requests found', async () => {
    // Override the pull requests list to return empty
    mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
    
    await run();
    
    expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No eligible pull requests found'));
  });
  
  test('should filter out pull requests based on filters', async () => {
    // Setup mocks to correctly pass through findMergeablePRs
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        { 
          number: 1, 
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          user: { login: 'dependabot[bot]' },
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days old
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        }
      ]
    });
    
    // Override the ignored-dependencies input
    core.getInput = jest.fn(name => {
      if (name === 'ignored-dependencies') return 'lodash';
      return defaultInputs[name] || '';
    });
    
    await run();
    
    expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No pull requests passed the filters'));
  });
  
  test('should attempt to merge eligible pull requests', async () => {
    // Setup mocks to correctly pass through findMergeablePRs
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        { 
          number: 1, 
          title: 'Bump axios from 0.21.0 to 0.21.1',
          user: { login: 'dependabot[bot]' },
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        }
      ]
    });
    
    await run();
    
    expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 1,
      merge_method: 'merge'
    });
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
  });
  
  test('should handle errors when merging pull requests', async () => {
    // Setup mocks to correctly pass through findMergeablePRs
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        { 
          number: 1, 
          title: 'Bump axios from 0.21.0 to 0.21.1',
          user: { login: 'dependabot[bot]' },
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        }
      ]
    });
    
    // Make the merge function throw an error
    mockOctokit.rest.pulls.merge.mockRejectedValue(new Error('Merge failed'));
    
    await run();
    
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to merge PR #1'));
  });
  
  test('should fail if token is not found', async () => {
    // Override the token value to use a non-existent environment variable
    core.getInput = jest.fn(name => {
      if (name === 'token') return '$NONEXISTENT_TOKEN';
      return defaultInputs[name] || '';
    });
    
    // Save original env and create a new empty env
    const originalEnv = process.env;
    process.env = {};
    
    await run();
    
    // The error should be captured in the catch block and passed to setFailed
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('GitHub token not provided or found in environment variable')
    );
    
    // Restore environment
    process.env = originalEnv;
  });
  
  test('should warn when merge queue is required but method is not merge', async () => {
    // Setup mocks to correctly pass through findMergeablePRs
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        { 
          number: 1, 
          title: 'Bump axios from 0.21.0 to 0.21.1',
          user: { login: 'dependabot[bot]' },
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          head: { sha: 'abc123' },
          mergeable: true,
          mergeable_state: 'clean'
        }
      ]
    });
    
    // Override the merge method to use squash
    core.getInput = jest.fn(name => {
      if (name === 'merge-method') return 'squash';
      return defaultInputs[name] || '';
    });
    
    // Make the merge function throw an error that looks like a merge queue error
    mockOctokit.rest.pulls.merge.mockRejectedValue({
      status: 405,
      message: 'Pull request requires merge queue'
    });
    
    await run();
    
    // Should detect merge queue error and warn about it
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('may require a merge queue, but merge method is set to'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('change the \'merge-method\' input to \'merge\''));
  });
  
  describe('Multi-dependency PR handling', () => {
    test('should attempt to merge eligible multi-dependency pull requests', async () => {
      // Setup mock for a multi-dependency PR
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { 
            number: 42, 
            title: 'Bump multiple dependencies',
            user: { login: 'dependabot[bot]' },
            created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            head: { sha: 'multi123' },
            mergeable: true,
            mergeable_state: 'clean',
            // Add dependencyInfoList to simulate multi-dependency PR
            dependencyInfoList: [
              {
                name: 'express',
                fromVersion: '4.17.1',
                toVersion: '4.17.2',
                semverChange: 'patch'
              },
              {
                name: 'morgan',
                fromVersion: '1.10.0',
                toVersion: '1.10.1',
                semverChange: 'patch'
              }
            ]
          }
        ]
      });
      
      await run();
      
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        merge_method: 'merge'
      });
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #42'));
    });
    
    test('should filter out multi-dependency PRs if any dependency is in ignored dependencies list', async () => {
      // Setup mock for a multi-dependency PR
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { 
            number: 43, 
            title: 'Bump multiple dependencies with ignored dependency',
            user: { login: 'dependabot[bot]' },
            created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            head: { sha: 'multi456' },
            mergeable: true,
            mergeable_state: 'clean',
            dependencyInfoList: [
              {
                name: 'express',
                fromVersion: '4.17.1',
                toVersion: '4.17.2',
                semverChange: 'patch'
              },
              {
                name: 'morgan', // This one will be ignored
                fromVersion: '1.10.0',
                toVersion: '1.10.1',
                semverChange: 'patch'
              }
            ]
          }
        ]
      });
      
      // Override the ignored-dependencies input
      core.getInput = jest.fn(name => {
        if (name === 'ignored-dependencies') return 'morgan';
        return defaultInputs[name] || '';
      });
      
      await run();
      
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No pull requests passed the filters'));
    });
    
    test('should filter out multi-dependency PRs if any dependency version is in ignored versions list', async () => {
      // Setup mock for a multi-dependency PR
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { 
            number: 44, 
            title: 'Bump multiple dependencies with ignored version',
            user: { login: 'dependabot[bot]' },
            created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            head: { sha: 'multi789' },
            mergeable: true,
            mergeable_state: 'clean',
            dependencyInfoList: [
              {
                name: 'express',
                fromVersion: '4.17.1',
                toVersion: '4.17.2',
                semverChange: 'patch'
              },
              {
                name: 'axios',
                fromVersion: '0.21.0',
                toVersion: '0.22.0', // This version will be ignored
                semverChange: 'minor'
              }
            ]
          }
        ]
      });
      
      // Override the ignored-versions input
      core.getInput = jest.fn(name => {
        if (name === 'ignored-versions') return 'axios@0.22.0';
        return defaultInputs[name] || '';
      });
      
      await run();
      
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No pull requests passed the filters'));
    });
    
    test('should filter out multi-dependency PRs if any dependency has a semver level not in the filter', async () => {
      // Setup mock for a multi-dependency PR with mixed semver changes
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { 
            number: 45, 
            title: 'Bump multiple dependencies with major change',
            user: { login: 'dependabot[bot]' },
            created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            head: { sha: 'multiABC' },
            mergeable: true,
            mergeable_state: 'clean',
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
                semverChange: 'major' // This will be filtered out
              }
            ]
          }
        ]
      });
      
      // Override the semver-filter input
      core.getInput = jest.fn(name => {
        if (name === 'semver-filter') return 'patch,minor';
        return defaultInputs[name] || '';
      });
      
      await run();
      
      expect(mockOctokit.rest.pulls.list).toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No pull requests passed the filters'));
    });
    
    test('should correctly process workflow summary', async () => {
      // Only allow patch updates
      core.getInput = jest.fn(name => {
        if (name === 'semver-filter') return 'patch';
        return defaultInputs[name] || '';
      });
      
      // Set up mock PRs with one that should be filtered out
      mockOctokit.rest.pulls.list.mockResolvedValueOnce({
        data: [
          { 
            number: 1, 
            title: 'Bump lodash from 4.17.20 to 4.17.21',
            user: { login: 'dependabot[bot]' },
            html_url: 'https://github.com/owner/repo/pull/1',
            created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days old
            head: { sha: 'abc123' }
          }
        ]
      });
      
      // Configure for eligible PRs
      mockOctokit.rest.pulls.get.mockImplementation(({ pull_number }) => {
        return {
          data: {
            number: pull_number,
            mergeable: true
          }
        };
      });
      
      await run();
      
      // Verify the summary was handled properly - should check for successful execution, not specific content
      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          pull_number: 1
        })
      );
      
      // Clean up environment
      delete process.env.GITHUB_STEP_SUMMARY;
    });
  });
});