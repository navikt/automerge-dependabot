const { findMergeablePRs, extractMultipleDependencyInfo } = require('../src/pullRequests');
const core = require('@actions/core');
const { setupTestEnvironment, createMockPR } = require('./helpers/mockSetup');

// Mock dependencies
jest.mock('@actions/core');

describe('PullRequests Module', () => {
  let originalDate;
  let mockOctokit;
  
  beforeEach(() => {
    jest.clearAllMocks();
    core.info = jest.fn();
    core.debug = jest.fn();
    core.warning = jest.fn();
    
    // Store the original Date
    originalDate = global.Date;
    
    // Set up basic test environment
    const result = setupTestEnvironment({ mockResponses: false });
    mockOctokit = result.mockOctokit;
  });
  
  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
  });
  
  test('should filter PRs based on criteria', async () => {
    // Set up mock responses
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        }),
        createMockPR({
          number: 2,
          title: 'Some other PR',
          user: { login: 'user1' },
          head: { ref: 'feature/something', sha: 'def456' },
          created_at: '2025-05-12T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          user: { login: 'user1' }, // Not dependabot
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });
    
    const result = await findMergeablePRs(mockOctokit, 'owner', 'repo', 0);
    
    expect(result.length).toBe(0);
  });
  
  test('should filter out PRs with non-Dependabot commits', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [
        { sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } },
        { sha: 'def456abc789', author: { login: 'malicious-user' }, committer: { login: 'malicious-user' } }
      ]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456' }] // Missing author and committer information
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-11T10:00:00Z' // Just 1 day old, but test requires 2
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: false } // Not mergeable
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({
      data: { state: 'failure' } // Failing checks
    });
    
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
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          title: 'Bump lodash from 4.17.20 to 4.17.21',
          head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
          created_at: '2025-05-10T10:00:00Z'
        })
      ]
    });

    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, mergeable: true }
    });

    mockOctokit.rest.pulls.listCommits.mockResolvedValue({
      data: [{ sha: 'abc123def456', author: { login: 'dependabot[bot]' }, committer: { login: 'dependabot[bot]' } }]
    });

    mockOctokit.rest.pulls.listReviews.mockResolvedValue({
      data: [
        {
          user: { id: 123 },
          state: 'REQUEST_CHANGES',
          submitted_at: '2025-05-11T00:00:00Z'
        }
      ]
    });

    mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({ data: { state: 'success' } });
    
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

    test('should extract dependency info from real multi-dependency PR body', () => {
      const title = 'Bump cookie and express';
      const body = `Bumps [cookie](https://github.com/jshttp/cookie) and [express](https://github.com/expressjs/express). These dependencies needed to be updated together.
Updates \`cookie\` from 0.6.0 to 0.7.1
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/jshttp/cookie/releases">cookie's releases</a>.</em></p>
<blockquote>
<h2>0.7.1</h2>
<p><strong>Fixed</strong></p>
<ul>
<li>Allow leading dot for domain (<a href="https://redirect.github.com/jshttp/cookie/issues/174">#174</a>)
<ul>
<li>Although not permitted in the spec, some users expect this to work and user agents ignore the leading dot according to spec</li>
</ul>
</li>
<li>Add fast path for <code>serialize</code> without options, use <code>obj.hasOwnProperty</code> when parsing (<a href="https://redirect.github.com/jshttp/cookie/issues/172">#172</a>)</li>
</ul>
<p><a href="https://github.com/jshttp/cookie/compare/v0.7.0...v0.7.1">https://github.com/jshttp/cookie/compare/v0.7.0...v0.7.1</a></p>
<h2>0.7.0</h2>
<ul>
<li>perf: parse cookies ~10% faster (<a href="https://redirect.github.com/jshttp/cookie/issues/144">#144</a> by <a href="https://github.com/kurtextrem"><code>@​kurtextrem</code></a> and <a href="https://redirect.github.com/jshttp/cookie/issues/170">#170</a>)</li>
<li>fix: narrow the validation of cookies to match RFC6265 (<a href="https://redirect.github.com/jshttp/cookie/issues/167">#167</a> by <a href="https://github.com/bewinsnw"><code>@​bewinsnw</code></a>)</li>
<li>fix: add <code>main</code> to <code>package.json</code> for rspack (<a href="https://redirect.github.com/jshttp/cookie/issues/166">#166</a> by <a href="https://github.com/proudparrot2"><code>@​proudparrot2</code></a>)</li>
</ul>
<p><a href="https://github.com/jshttp/cookie/compare/v0.6.0...v0.7.0">https://github.com/jshttp/cookie/compare/v0.6.0...v0.7.0</a></p>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/jshttp/cookie/commit/72ac8733d273018748716d45e86e8684a6f41a25"><code>72ac873</code></a> Release 0.7.1</li>
<li><a href="https://github.com/jshttp/cookie/commit/0e5bb24f24942c1c457d28b9d973aaa055c5e7f2"><code>0e5bb24</code></a> Allow leading dot for domain</li>
<li><a href="https://github.com/jshttp/cookie/commit/794bbf0347bd4fc1be736a4770c7d7f6f429de37"><code>794bbf0</code></a> Fast path for serialize with no options</li>
<li><a href="https://github.com/jshttp/cookie/commit/4130b5a78aef94a4cc3caae48e0f6f30bbe12170"><code>4130b5a</code></a> Release 0.7.0</li>
<li><a href="https://github.com/jshttp/cookie/commit/d9e858bb52cc2bffddda1f2eb88931fe2f6ce86c"><code>d9e858b</code></a> deps: eslint-plugin-markdown@3.0.1</li>
<li><a href="https://github.com/jshttp/cookie/commit/83a6c8f50ff7ddf33c0a2839f9b4a2b43c91e0e7"><code>83a6c8f</code></a> build: support Node.js 22.x</li>
<li><a href="https://github.com/jshttp/cookie/commit/49c44bbf231f2a1f82f5a7f7c30f90e6e6c90ba9"><code>49c44bb</code></a> perf: parse cookies ~10% faster</li>
<li><a href="https://github.com/jshttp/cookie/commit/a7e742d7a4d3cd7af2cb55b9cda94c98ce232a32"><code>a7e742d</code></a> fix: narrow the validation of cookies to match RFC6265</li>
<li><a href="https://github.com/jshttp/cookie/commit/1a845a14e4a04e0becd5e80c44ee7afe744979af"><code>1a845a1</code></a> fix: add \`main\` to \`package.json\` for rspack</li>
<li><a href="https://github.com/jshttp/cookie/commit/d618f6a06f1d9040a3294f68e69db85ce88cb5f2"><code>d618f6a</code></a> docs: move repo to jshttp org</li>
<li>See full diff in <a href="https://github.com/jshttp/cookie/compare/v0.6.0...v0.7.1">compare view</a></li>
</ul>
</details>

Updates \`express\` from 4.19.0 to 4.20.0
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/expressjs/express/releases">express's releases</a>.</em></p>
<blockquote>
<h2>4.20.0</h2>
<ul>
<li>deps: cookie@0.7.1
<ul>
<li>Allow leading dot for domain</li>
<li>Add fast path for <code>serialize</code> without options</li>
</ul>
</li>
<li>deps: proxy-addr@2.0.7
<ul>
<li>deps: ipaddr.js@1.9.1</li>
</ul>
</li>
<li>deps: type-is@~1.6.19
<ul>
<li>deps: mime-types@~2.1.35</li>
</ul>
</li>
<li>deps: qs@6.12.0
<ul>
<li>Fix parsing a nested array with dot notation</li>
<li>Fix parsing a param with dot notation and blank arrays</li>
</ul>
</li>
<li>deps: send@0.19.0
<ul>
<li>Fix empty payload when 304 has cacheable headers</li>
<li>deps: mime@1.6.0</li>
<li>perf: remove argument reassignment</li>
</ul>
</li>
<li>deps: serve-static@1.17.0
<ul>
<li>deps: send@0.19.0</li>
</ul>
</li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/expressjs/express/commit/4193c9b88d876fceee29c1f41cacbe0a71384f0c"><code>4193c9b</code></a> 4.20.0</li>
<li><a href="https://github.com/expressjs/express/commit/ebce23a2cd41e27ba5da1c3efdc24c61bee57ea0"><code>ebce23a</code></a> deps: send@0.19.0</li>
<li><a href="https://github.com/expressjs/express/commit/12c61c94dac11d90a6f9b02202b25b6b89dfa7e4"><code>12c61c9</code></a> deps: serve-static@1.17.0</li>
<li><a href="https://github.com/expressjs/express/commit/8df5475f4c3e2cc0b5e053e6b69c7978aeddf6d7"><code>8df5475</code></a> deps: qs@6.12.0</li>
<li><a href="https://github.com/expressjs/express/commit/92a17b25d6b41a9a9dcf36ca1cf92c0241a4f142"><code>92a17b2</code></a> deps: cookie@0.7.1</li>
<li><a href="https://github.com/expressjs/express/commit/8f5cbb6a40c6d21cc26a6b3f82e2e0e8ef2bc3a5"><code>8f5cbb6</code></a> deps: proxy-addr@2.0.7</li>
<li><a href="https://github.com/expressjs/express/commit/39a07be4b8c4c9fa46ea7c060d090bab2a05cae2"><code>39a07be</code></a> deps: type-is@~1.6.19</li>
<li>See full diff in <a href="https://github.com/expressjs/express/compare/v4.19.0...v4.20.0">compare view</a></li>
</ul>
</details>
<br />

[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=cookie&package-manager=npm_and_yarn&previous-version=0.6.0&new-version=0.7.1)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting \`@dependabot rebase\`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)`;

      const result = extractMultipleDependencyInfo(title, body);

      expect(result).toHaveLength(2);
      
      // Verify cookie dependency details
      expect(result[0]).toEqual({
        name: 'cookie',
        fromVersion: '0.6.0',
        toVersion: '0.7.1',
        semverChange: 'minor'
      });
      
      // Verify express dependency details
      expect(result[1]).toEqual({
        name: 'express',
        fromVersion: '4.19.0',
        toVersion: '4.20.0',
        semverChange: 'minor'
      });
    });
  });
});