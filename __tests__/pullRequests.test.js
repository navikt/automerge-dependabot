const { findMergeablePRs } = require('../src/pullRequests');
const core = require('@actions/core');

// Mock dependencies
jest.mock('@actions/core');

describe('PullRequests Module', () => {
  let originalDate;
  
  beforeEach(() => {
    jest.clearAllMocks();
    core.info = jest.fn();
    core.debug = jest.fn();
    core.warning = jest.fn();
    
    // Store the original Date
    originalDate = global.Date;
  });
  
  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
  });
  
  test('should filter PRs based on criteria', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              },
              {
                number: 2,
                title: 'Some other PR',
                user: { login: 'user1' },
                head: { ref: 'feature/something', sha: 'def456' },
                created_at: '2025-05-12T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Mock current date to ensure deterministic age comparisons
    const mockDate = new Date('2025-05-12T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 1);
    
    expect(result.length).toBe(1);
    expect(result[0].number).toBe(1);
    expect(result[0].dependencyInfo.name).toBe('lodash');
  });
  
  test('should filter out PRs that are not from Dependabot', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'user1' }, // Not dependabot
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          })
        }
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
  });
  
  test('should filter out PRs with non-Dependabot commits', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              },
              {
                sha: 'def456abc789',
                author: { login: 'malicious-user' }, // Not dependabot
                committer: { login: 'malicious-user' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Use a date that ensures PRs are old enough
    const mockDate = new Date('2025-05-15T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('contains commits from authors other than Dependabot'));
  });
  
  test('should filter out PRs with missing commit author information', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                // Missing author and committer information
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Use a date that ensures PRs are old enough
    const mockDate = new Date('2025-05-15T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('contains commits from authors other than Dependabot'));
  });
  
  test('should filter out PRs that are too recent', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-11T10:00:00Z' // Just 1 day old, but test requires 2
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Set a current date that makes the PR too recent (only 1 day old)
    const mockDate = new Date('2025-05-12T10:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 2);
    
    expect(result.length).toBe(0);
  });
  
  test('should filter out PRs that are not mergeable', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: false // Not mergeable
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Use a date that ensures PRs are old enough
    const mockDate = new Date('2025-05-15T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
  });
  
  test('should filter out PRs with failing status checks', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: []
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'failure' } // Failing checks
          })
        }
      }
    };
    
    // Use a date that ensures PRs are old enough
    const mockDate = new Date('2025-05-15T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
  });
  
  test('should filter out PRs with blocking reviews', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump lodash from 4.17.20 to 4.17.21',
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
                created_at: '2025-05-10T10:00:00Z'
              }
            ]
          }),
          get: jest.fn().mockResolvedValue({
            data: {
              number: 1,
              mergeable: true
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [
              {
                sha: 'abc123def456',
                author: { login: 'dependabot[bot]' },
                committer: { login: 'dependabot[bot]' }
              }
            ]
          }),
          listReviews: jest.fn().mockResolvedValue({
            data: [
              {
                user: { id: 123 },
                state: 'REQUEST_CHANGES',
                submitted_at: '2025-05-11T00:00:00Z'
              }
            ]
          })
        },
        repos: {
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: { state: 'success' }
          })
        }
      }
    };
    
    // Use a date that ensures PRs are old enough
    const mockDate = new Date('2025-05-15T00:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      }
    };
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
  });
});