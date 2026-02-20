import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import * as github from '../__fixtures__/github.js';

const mockAddWorkflowSummary = jest.fn().mockResolvedValue({});

jest.unstable_mockModule('../src/summary.js', () => ({
  addWorkflowSummary: mockAddWorkflowSummary
}));
jest.unstable_mockModule('@actions/core', () => core);
jest.unstable_mockModule('@actions/github', () => github);

const { run } = await import('../src/index.js');
const { setupTestEnvironment, createMockPR } = await import('./helpers/mockSetup.js');

describe('Handle when base ref changes after merging first PR', () => {
  let mockOctokit;

  beforeEach(() => {
    // Set up test environment with filtering configuration
    const result = setupTestEnvironment(core, github, {
      inputOverrides: {
        "retry-delay-ms": "20" // Fast retry for testing
      }
    });
    mockOctokit = result.mockOctokit;
  });

  test('should successfully merge three PRs with head ref changes triggering retries', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    
    // Set up three PRs for testing
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({
          number: 1,
          title: "Bump lodash from 4.17.20 to 4.17.21",
          created_at: fourDaysAgo,
          head: { sha: 'sha1' }
        }),
        createMockPR({
          number: 2,
          title: "Bump axios from 0.21.1 to 0.21.4", 
          created_at: fourDaysAgo,
          head: { sha: 'sha2' }
        }),
        createMockPR({
          number: 3,
          title: "Bump express from 4.17.1 to 4.17.2",
          created_at: fourDaysAgo,
          head: { sha: 'sha3' }
        })
      ]
    });

    // Track merge call counts
    let mergeCallCount = 0;

    // Mock the merge attempts - PR 1 succeeds, PR 2 fails once then succeeds, PR 3 fails once then succeeds
    mockOctokit.rest.pulls.merge.mockImplementation(({ pull_number }) => {
      mergeCallCount++;
      
      if (pull_number === 1) {
        // PR 1 merges successfully on first try
        return Promise.resolve();
      } else if (pull_number === 2) {
        if (mergeCallCount === 2) {
          // First attempt at PR 2 fails with base branch modified error
          throw new Error('Base branch was modified. Review and try the merge again.');
        } else {
          // Retry succeeds (mergeCallCount === 3)
          return Promise.resolve();
        }
      } else if (pull_number === 3) {
        if (mergeCallCount === 4) {
          // First attempt at PR 3 fails with base branch modified error  
          throw new Error('Base branch was modified. Review and try the merge again.');
        } else {
          // Retry succeeds (mergeCallCount === 5)
          return Promise.resolve();
        }
      }
      
      return Promise.resolve();
    });

    // Run the action
    await run();

    // All PRs should be merged:
    // - PR 1: merges successfully on first try (1 call)
    // - PR 2: fails with base branch modification, gets re-verified and retried successfully (2 calls)
    // - PR 3: fails with base branch modification, gets re-verified and retried successfully (2 calls)
    // Total: 5 merge calls
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(5);

    // Verify merge calls for all PRs
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 1, merge_method: 'merge' })
    );
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 2, merge_method: 'merge' })
    );
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 3, merge_method: 'merge' })
    );

    // Verify re-verification was called for PR 2 and PR 3 (each gets called once in findMergeablePRs + once in retry = 2)
    const getPR2Calls = mockOctokit.rest.pulls.get.mock.calls.filter(c => c[0].pull_number === 2).length;
    const getPR3Calls = mockOctokit.rest.pulls.get.mock.calls.filter(c => c[0].pull_number === 3).length;
    expect(getPR2Calls).toBe(2);
    expect(getPR3Calls).toBe(2);

    // Verify success messages were logged for all merged PRs
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #2 on retry'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #3 on retry'));

    // Verify base branch modification warnings were logged for PR 2 and PR 3
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('PR #2 failed due to base branch modification. Re-verifying mergeability and retrying...')
    );
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('PR #3 failed due to base branch modification. Re-verifying mergeability and retrying...')
    );

    // Verify retry info messages were logged
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Retrying merge for PR #2 after re-verification'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Retrying merge for PR #3 after re-verification'));

    // Verify workflow summary was called
    expect(mockAddWorkflowSummary).toHaveBeenCalledTimes(1);
  });
});
