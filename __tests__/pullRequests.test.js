const { findMergeablePRs, extractDependencyInfo, extractMultipleDependencyInfo } = require('../src/pullRequests');
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

  test('should handle PRs with multiple dependency updates', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump dependency-A and dependency-B in /my-group',
                body: `Bumps [dependency-A](https://github.com/org/dependency-A) and [dependency-B](https://github.com/org/dependency-B).
      
Updates dependency-A from 1.2.3 to 1.3.0
- [Release notes](https://github.com/org/dependency-A/releases)
      
Updates dependency-B from 2.1.0 to 3.0.0
- [Release notes](https://github.com/org/dependency-B/releases)`,
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/npm_and_yarn/my-group/dependency-A-dependency-B', sha: 'abc123' },
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
    expect(result[0].dependencyInfoList).toBeDefined();
    expect(result[0].dependencyInfoList.length).toBe(2);
    expect(result[0].dependencyInfoList[0].name).toBe('dependency-A');
    expect(result[0].dependencyInfoList[0].semverChange).toBe('minor');
    expect(result[0].dependencyInfoList[1].name).toBe('dependency-B');
    expect(result[0].dependencyInfoList[1].semverChange).toBe('major');
  });

  test('should handle PRs with dependency group updates', async () => {
    // Mock GitHub API client and responses
    const mockOctokit = {
      rest: {
        pulls: {
          list: jest.fn().mockResolvedValue({
            data: [
              {
                number: 1,
                title: 'Bump the maven group across / with 6 updates',
                body: `Bumps the maven group with 6 updates in the / directory:

| Package | From | To |
| --- | --- | --- |
| org.flywaydb:flyway-database-postgresql | \`11.8.0\` | \`11.8.2\` |
| [org.verapdf:validation-model](https://github.com/veraPDF/veraPDF-validation) | \`1.26.5\` | \`1.28.1\` |
| [org.jetbrains.kotlin:kotlin-stdlib-jdk8](https://github.com/JetBrains/kotlin) | \`2.1.20\` | \`2.1.21\` |
| [org.jetbrains.kotlin:kotlin-test](https://github.com/JetBrains/kotlin) | \`2.1.20\` | \`2.1.21\` |
| org.jetbrains.kotlin:kotlin-maven-allopen | \`2.1.20\` | \`2.1.21\` |
| org.jetbrains.kotlin:kotlin-maven-plugin | \`2.1.20\` | \`2.1.21\` |`,
                user: { login: 'dependabot[bot]' },
                head: { ref: 'dependabot/maven/maven-group', sha: 'abc123' },
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
    expect(result[0].dependencyInfoList).toBeDefined();
    expect(result[0].dependencyInfoList.length).toBe(6);
    expect(result[0].dependencyInfoList[0].name).toBe('org.flywaydb:flyway-database-postgresql');
    expect(result[0].dependencyInfoList[0].semverChange).toBe('patch');
    expect(result[0].dependencyInfoList[1].name).toBe('org.verapdf:validation-model');
    expect(result[0].dependencyInfoList[1].semverChange).toBe('minor');
  });

  describe('extractMultipleDependencyInfo', () => {
    test('should extract information from "Bump A and B in directory" format', () => {
      const title = 'Bump dependency-A and dependency-B in /my-group';
      const body = `Bumps [dependency-A](https://github.com/org/dependency-A) and [dependency-B](https://github.com/org/dependency-B).
      
Updates dependency-A from 1.2.3 to 1.3.0
- [Release notes](https://github.com/org/dependency-A/releases)
      
Updates dependency-B from 2.1.0 to 3.0.0
- [Release notes](https://github.com/org/dependency-B/releases)`;

      const result = extractMultipleDependencyInfo(title, body);
      expect(result.length).toBe(2);
      
      expect(result[0].name).toBe('dependency-A');
      expect(result[0].fromVersion).toBe('1.2.3');
      expect(result[0].toVersion).toBe('1.3.0');
      expect(result[0].semverChange).toBe('minor');
      
      expect(result[1].name).toBe('dependency-B');
      expect(result[1].fromVersion).toBe('2.1.0');
      expect(result[1].toVersion).toBe('3.0.0');
      expect(result[1].semverChange).toBe('major');
    });

    test('should extract information from table format', () => {
      const title = 'Bump the maven group across / with 6 updates';
      const body = `Bumps the maven group with 6 updates in the / directory:

| Package | From | To |
| --- | --- | --- |
| org.flywaydb:flyway-database-postgresql | \`11.8.0\` | \`11.8.2\` |
| [org.verapdf:validation-model](https://github.com/veraPDF/veraPDF-validation) | \`1.26.5\` | \`1.28.1\` |
| [org.jetbrains.kotlin:kotlin-stdlib-jdk8](https://github.com/JetBrains/kotlin) | \`2.1.20\` | \`2.1.21\` |
| [org.jetbrains.kotlin:kotlin-test](https://github.com/JetBrains/kotlin) | \`2.1.20\` | \`2.1.21\` |
| org.jetbrains.kotlin:kotlin-maven-allopen | \`2.1.20\` | \`2.1.21\` |
| org.jetbrains.kotlin:kotlin-maven-plugin | \`2.1.20\` | \`2.1.21\` |`;

      const result = extractMultipleDependencyInfo(title, body);
      expect(result.length).toBe(6);
      
      expect(result[0].name).toBe('org.flywaydb:flyway-database-postgresql');
      expect(result[0].fromVersion).toBe('11.8.0');
      expect(result[0].toVersion).toBe('11.8.2');
      expect(result[0].semverChange).toBe('patch');
      
      expect(result[1].name).toBe('org.verapdf:validation-model');
      expect(result[1].fromVersion).toBe('1.26.5');
      expect(result[1].toVersion).toBe('1.28.1');
      expect(result[1].semverChange).toBe('minor');
      
      // Check the package with markdown links
      expect(result[2].name).toBe('org.jetbrains.kotlin:kotlin-stdlib-jdk8');
      
      // Check the last package
      expect(result[5].name).toBe('org.jetbrains.kotlin:kotlin-maven-plugin');
      expect(result[5].fromVersion).toBe('2.1.20');
      expect(result[5].toVersion).toBe('2.1.21');
      expect(result[5].semverChange).toBe('patch');
    });

    test('should return empty array for non-matching title', () => {
      const title = 'This is not a Dependabot PR title';
      const body = 'This is not a Dependabot PR body';
      
      const result = extractMultipleDependencyInfo(title, body);
      expect(result).toEqual([]);
    });
    
    test('should handle case where body does not contain expected information', () => {
      const title = 'Bump dependency-A and dependency-B in /my-group';
      const body = 'This body does not contain the expected dependency information';
      
      const result = extractMultipleDependencyInfo(title, body);
      expect(result).toEqual([]);
    });
  });
});