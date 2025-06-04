// Define mocks before imports
const mockAddWorkflowSummary = jest.fn().mockResolvedValue({});

// Mock modules
jest.mock('../src/summary', () => ({
  addWorkflowSummary: mockAddWorkflowSummary,
  getSummaryContent: jest.fn()
}));
jest.mock('@actions/core');
jest.mock('@actions/github');

// Now import modules
const core = require('@actions/core');
const { run } = require('../src/index');
const { setupTestEnvironment, createMockPR } = require('./helpers/mockSetup');

describe('npm group dependency updates', () => {
  let mockOctokit;

  // PR group body template with proper markdown table format
  const prBody = `Bumps the npm group with 7 updates:

| Package | From | To |
| --- | --- | --- |
| [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) | \`5.17.0\` | \`6.6.3\` |
| [@testing-library/react](https://github.com/testing-library/react-testing-library) | \`13.4.0\` | \`16.3.0\` |
| [@testing-library/user-event](https://github.com/testing-library/user-event) | \`13.5.0\` | \`14.6.1\` |
| [react](https://github.com/facebook/react/tree/HEAD/packages/react) | \`18.3.1\` | \`19.1.0\` |
| [react-dom](https://github.com/facebook/react/tree/HEAD/packages/react-dom) | \`18.3.1\` | \`19.1.0\` |
| [react-scripts](https://github.com/facebook/create-react-app/tree/HEAD/packages/react-scripts) | \`5.0.1\` | \`4.0.0\` |
| [web-vitals](https://github.com/GoogleChrome/web-vitals) | \`2.1.4\` | \`5.0.1\` |`;

  beforeEach(() => {
    // Set up test environment with default configuration
    const result = setupTestEnvironment({
      inputOverrides: {
        "ignored-dependencies": "react-scripts", // Ignore react-scripts, which has a version downgrade
        "semver-filter": "patch,minor"
      }
    });
    mockOctokit = result.mockOctokit;
    
    // Mock PR list with one eligible group PR
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({
        title: "Bump the npm group with 7 updates",
        body: prBody
      })]
    });
  });
  
  test('correctly filter out major updates and handle group PRs', async () => {
    // Run the action
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
    
    // The PR should not be merged because it contains major updates
    // and we've set semver-filter to only allow patch,minor
    expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
  });

  test('merge group PRs when always-allow is used for all dependencies', async () => {
    // Override input to always allow all dependencies in the group
    core.getInput.mockImplementation(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "", 
        "always-allow": "*", // Use wildcard to allow all dependencies
        "ignored-versions": "", // Don't ignore any versions
        "semver-filter": "patch,minor,major,unknown", // Allow all semver changes including unknown
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Reset PR list mock
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({
        title: "Bump the npm group with 7 updates",
        body: prBody
      })]
    });
    
    // Run the action
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
    
    // The PR should be merged because we've allowed all dependencies with wildcard
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('not merge when all dependencies in the group are ignored', async () => {
    // Override input to ignore all dependencies in the group
    core.getInput.mockImplementation(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "@testing-library/jest-dom,@testing-library/react,@testing-library/user-event,react,react-dom,react-scripts,web-vitals",
        "always-allow": "",
        "ignored-versions": "",
        "semver-filter": "patch,minor,major", // Allow all updates
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Run the action
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
    
    // The PR should not be merged because all dependencies are ignored
    expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
  });

  test('merge when specific versions are allowed via always-allow', async () => {
    // Override input to always allow specific versions
    core.getInput.mockImplementation(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "", // Don't ignore any dependencies
        "always-allow": "*@*", // Always allow all versions with wildcard
        "ignored-versions": "",
        "semver-filter": "patch,minor,major,unknown", // Allow all semver changes including unknown
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Reset PR list mock with specific title
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({
        title: "Bump the npm group with 7 updates",
        body: prBody
      })]
    });
    
    // Run the action
    await run();
    
    // Check that addWorkflowSummary was called exactly once
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
    
    // The PR should be merged because we've allowed all versions
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('handle dependency downgrades correctly', async () => {
    // Add debugging to see how the semver change is determined
    core.debug.mockImplementation(message => {
      console.log(message);
    });

    // Check the semver change detection function directly
    const { determineSemverChange } = require('../src/pullRequests');
    const fromVersion = '5.0.1';  // react-scripts original version
    const toVersion = '4.0.0';    // react-scripts downgraded version
    const semverChangeType = determineSemverChange(fromVersion, toVersion);
    console.log(`Semver change type for downgrade ${fromVersion} -> ${toVersion}: ${semverChangeType}`);
    
    // Verify the downgrade is detected as 'unknown' semver change
    expect(semverChangeType).toBe('unknown');
    
    // Override the PR list mock with a title indicating an npm group update with proper format
    const downgradeBody = `
Bumps the npm group with downgrade.

| Package | From | To |
| --- | --- | --- |
| [react-scripts](https://github.com/facebook/create-react-app/tree/HEAD/packages/react-scripts) | \`5.0.1\` | \`4.0.0\` |
| [@testing-library/jest-dom](https://github.com/testing-library/jest-dom) | \`5.16.4\` | \`5.16.5\` |
        `;

    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({
        number: 2,
        title: "Bump the npm group with downgrade",
        body: downgradeBody,
        head: { sha: 'def456' },
        html_url: 'https://github.com/owner/repo/pull/2'
      })]
    });
    
    // Use always-allow to explicitly allow the downgrade
    core.getInput.mockImplementation(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "", 
        "always-allow": "react-scripts", // Always allow react-scripts updates including downgrades
        "ignored-versions": "", 
        "semver-filter": "patch,minor,major", // Don't include unknown in the filter
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Run the action
    await run();
    
    // The PR should be merged because we're explicitly allowing react-scripts via always-allow
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('handle PR with title "Bump the npm group in with 7 updates"', async () => {
    // Override the PR list mock with the specific title requested
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({
        title: "Bump the npm group in with 7 updates",
        body: prBody
      })]
    });

    // Set up core.getInput with the specific configuration to allow all dependencies
    core.getInput.mockImplementation(name => {
      const inputs = {
        "token": "test-token",
        "minimum-age-of-pr": "3",
        "blackout-periods": "",
        "ignored-dependencies": "", // Don't ignore any dependencies
        "always-allow": "*", // Allow all dependencies with wildcard 
        "ignored-versions": "", 
        "semver-filter": "patch,minor,major,unknown", // Allow all semver changes
        "merge-method": "merge"
      };
      return inputs[name] || '';
    });
    
    // Run the action
    await run();
    
    // The PR should be merged with our configuration
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
    
    // Verify logs about the processing
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Finding eligible pull requests"));
    
    // Verify that the workflow summary was added
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
  });
});
