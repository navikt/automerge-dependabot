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

const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Builds a full sequence of mockResolvedValueOnce calls on pulls.get for
 * `count` PRs that all start as mergeable. The `extraCalls` array is appended
 * after the initial checks and models what GitHub returns when mergeability is
 * re-checked after a "base branch was modified" failure.
 */
function setupPullsGet(mockOctokit, prNumbers, extraCalls = []) {
  let mock = mockOctokit.rest.pulls.get;
  for (const number of prNumbers) {
    mock = mock.mockResolvedValueOnce({
      data: { number, mergeable: true, mergeable_state: 'clean', head: { sha: `sha${number}` } }
    });
  }
  for (const data of extraCalls) {
    mock = mock.mockResolvedValueOnce({ data });
  }
}

describe('Merging multiple PRs when base branch changes', () => {
  let mockOctokit;

  beforeEach(() => {
    const result = setupTestEnvironment(core, github, {
      inputOverrides: { 'retry-delay-ms': '1' }
    });
    mockOctokit = result.mockOctokit;
  });

  test('second PR is skipped when it is no longer mergeable before merge attempt', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({ number: 1, title: 'Bump lodash from 4.17.20 to 4.17.21', created_at: fourDaysAgo, head: { sha: 'sha1' } }),
        createMockPR({ number: 2, title: 'Bump axios from 0.21.1 to 0.21.4',   created_at: fourDaysAgo, head: { sha: 'sha2' } })
      ]
    });

    // Initial scan: both PRs mergeable.
    // Pre-merge re-check PR1: still clean → PR1 merges.
    // Pre-merge re-check PR2: dirty (became non-mergeable after PR1 was merged) → PR2 skipped.
    setupPullsGet(mockOctokit, [1, 2], [
      { number: 1, mergeable: true,  mergeable_state: 'clean', head: { sha: 'sha1' } },
      { number: 2, mergeable: false, mergeable_state: 'dirty', head: { sha: 'sha2' } }
    ]);

    mockOctokit.rest.pulls.merge.mockResolvedValueOnce({}); // PR1 succeeds

    await run();

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 1 }));

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #2'));

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Skipping PR #2: no longer mergeable')
    );
  });

  test('second PR is merged after pre-merge re-check resolves null mergeability', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({ number: 1, title: 'Bump lodash from 4.17.20 to 4.17.21', created_at: fourDaysAgo, head: { sha: 'sha1' } }),
        createMockPR({ number: 2, title: 'Bump axios from 0.21.1 to 0.21.4',   created_at: fourDaysAgo, head: { sha: 'sha2' } })
      ]
    });

    // Initial scan: both PRs mergeable.
    // Pre-merge re-check PR1: clean → PR1 merges.
    // Pre-merge re-check PR2: null first (GitHub computing after PR1 rebase), then resolves to true.
    setupPullsGet(mockOctokit, [1, 2], [
      { number: 1, mergeable: true, mergeable_state: 'clean',   head: { sha: 'sha1' } },
      { number: 2, mergeable: null, mergeable_state: 'unknown', head: { sha: 'sha2' } },
      { number: 2, mergeable: true, mergeable_state: 'clean',   head: { sha: 'sha2' } }
    ]);

    mockOctokit.rest.pulls.merge
      .mockResolvedValueOnce({}) // PR1 succeeds
      .mockResolvedValueOnce({}); // PR2 succeeds

    await run();

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(2);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 1 }));
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 2 }));

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #2'));

    // pulls.get: 2 (scan) + 1 (re-check PR1) + 2 (re-check PR2: null then true)
    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledTimes(5);
  });
});
