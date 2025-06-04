const core = require('@actions/core');
const github = require('@actions/github');

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
function setupGitHubContext(mockOctokit, overrides = {}) {
  const defaultContext = {
    repo: {
      owner: 'owner',
      repo: 'repo'
    },
    ref: 'refs/heads/main'
  };

  github.context = { ...defaultContext, ...overrides };
  github.getOctokit = jest.fn().mockReturnValue(mockOctokit);
}

/**
 * Sets up core mocks with default implementations
 */
function setupCoreMocks() {
  core.info = jest.fn();
  core.warning = jest.fn();
  core.debug = jest.fn();
  core.setFailed = jest.fn();
  
  core.summary = {
    addHeading: jest.fn().mockReturnThis(),
    addRaw: jest.fn().mockReturnThis(),
    write: jest.fn().mockResolvedValue({})
  };
}

/**
 * Sets up default input values for the action
 */
function setupDefaultInputs(customInputs = {}) {
  const defaultInputs = {
    "token": "test-token",
    "minimum-age-of-pr": "3",
    "blackout-periods": "",
    "ignored-dependencies": "",
    "always-allow": "",
    "ignored-versions": "",
    "semver-filter": "patch,minor",
    "merge-method": "merge"
  };

  const inputs = { ...defaultInputs, ...customInputs };
  
  core.getInput = jest.fn(name => inputs[name] || '');
}

/**
 * Sets up default mock responses for Octokit
 */
function setupDefaultMockResponses(mockOctokit) {
  // Default repos.get response for default branch check
  mockOctokit.rest.repos.get.mockResolvedValue({
    data: { default_branch: 'main' }
  });

  // Default PR details response
  mockOctokit.rest.pulls.get.mockResolvedValue({
    data: { 
      mergeable: true, 
      mergeable_state: 'clean' 
    }
  });

  // Default commits response
  mockOctokit.rest.pulls.listCommits.mockResolvedValue({
    data: [{ 
      author: { login: 'dependabot[bot]' }, 
      committer: { login: 'dependabot[bot]' } 
    }]
  });

  // Default status check response
  mockOctokit.rest.repos.getCombinedStatusForRef.mockResolvedValue({
    data: { state: 'success' }
  });

  // Default reviews response
  mockOctokit.rest.pulls.listReviews.mockResolvedValue({
    data: []
  });

  // Default merge response
  mockOctokit.rest.pulls.merge.mockResolvedValue({});

  // Default empty PR list
  mockOctokit.rest.pulls.list.mockResolvedValue({
    data: []
  });
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
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days old
    html_url: 'https://github.com/owner/repo/pull/1',
    body: 'Bumps lodash from 4.17.20 to 4.17.21'
  };

  return { ...defaultPR, ...overrides };
}

/**
 * Complete setup function that sets up everything needed for most tests
 */
function setupTestEnvironment(options = {}) {
  const {
    contextOverrides = {},
    inputOverrides = {},
    mockResponses = true
  } = options;

  // Clear all mocks
  jest.clearAllMocks();

  // Create mock objects
  const mockOctokit = createMockOctokit();
  
  // Setup mocks
  setupGitHubContext(mockOctokit, contextOverrides);
  setupCoreMocks();
  setupDefaultInputs(inputOverrides);
  
  if (mockResponses) {
    setupDefaultMockResponses(mockOctokit);
  }

  return { mockOctokit };
}

module.exports = {
  createMockOctokit,
  setupGitHubContext,
  setupCoreMocks,
  setupDefaultInputs,
  setupDefaultMockResponses,
  createMockPR,
  setupTestEnvironment
};
