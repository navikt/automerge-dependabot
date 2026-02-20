import { jest } from '@jest/globals';

/**
 * Creates a standard mockOctokit object with all required methods
 */
function createMockOctokit() {
  return {
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
}

/**
 * Sets up GitHub context with default values
 */
function setupGitHubContext(github, mockOctokit, overrides = {}) {
  const defaultContext = {
    repo: { owner: 'owner', repo: 'repo' },
    ref: 'refs/heads/main'
  };

  Object.assign(github.context, defaultContext, overrides);
  github.getOctokit.mockReturnValue(mockOctokit);
}

/**
 * Sets up core mocks with default implementations
 */
function setupCoreMocks(core) {
  core.summary.addHeading.mockReturnThis();
  core.summary.addRaw.mockReturnThis();
  core.summary.write.mockResolvedValue({});
}

/**
 * Sets up default input values for the action
 */
function setupDefaultInputs(core, customInputs = {}) {
  const defaultInputs = {
    'token': 'test-token',
    'minimum-age-of-pr': '3',
    'blackout-periods': '',
    'ignored-dependencies': '',
    'always-allow': '',
    'ignored-versions': '',
    'semver-filter': 'patch,minor',
    'merge-method': 'merge',
    'retry-delay-ms': '100'
  };

  const inputs = { ...defaultInputs, ...customInputs };
  core.getInput.mockImplementation(name => inputs[name] || '');
}

/**
 * Sets up default mock responses for Octokit
 */
function setupDefaultMockResponses(mockOctokit) {
  mockOctokit.rest.repos.get.mockResolvedValue({
    data: { default_branch: 'main' }
  });

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
  mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
}

/**
 * Creates a mock PR object with sensible defaults
 */
function createMockPR(overrides = {}) {
  const defaultPR = {
    number: 1,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    user: { login: 'dependabot[bot]' },
    head: { ref: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'abc123' },
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    html_url: 'https://github.com/owner/repo/pull/1',
    body: 'Bumps lodash from 4.17.20 to 4.17.21'
  };

  return { ...defaultPR, ...overrides };
}

/**
 * Complete setup function that sets up everything needed for most tests
 */
function setupTestEnvironment(core, github, options = {}) {
  const {
    contextOverrides = {},
    inputOverrides = {},
    mockResponses = true
  } = options;

  const mockOctokit = createMockOctokit();

  if (github) {
    setupGitHubContext(github, mockOctokit, contextOverrides);
  }
  setupCoreMocks(core);
  setupDefaultInputs(core, inputOverrides);

  if (mockResponses) {
    setupDefaultMockResponses(mockOctokit);
  }

  return { mockOctokit };
}

export {
  createMockOctokit,
  setupGitHubContext,
  setupCoreMocks,
  setupDefaultInputs,
  setupDefaultMockResponses,
  createMockPR,
  setupTestEnvironment
};

