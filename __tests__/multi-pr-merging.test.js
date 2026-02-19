jest.mock('../src/summary', () => ({
  addWorkflowSummary: jest.fn().mockResolvedValue({}),
  getSummaryContent: jest.fn()
}));
jest.mock('@actions/core');
jest.mock('@actions/github');

const core = require('@actions/core');
const { run } = require('../src/index');
const { setupTestEnvironment, createMockPR } = require('./helpers/mockSetup');

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
    const result = setupTestEnvironment({
      inputOverrides: { 'retry-delay-ms': '1' }
    });
    mockOctokit = result.mockOctokit;
  });

  test('second PR is skipped when it is no longer mergeable after first PR is merged', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({ number: 1, title: 'Bump lodash from 4.17.20 to 4.17.21', created_at: fourDaysAgo, head: { sha: 'sha1' } }),
        createMockPR({ number: 2, title: 'Bump axios from 0.21.1 to 0.21.4',   created_at: fourDaysAgo, head: { sha: 'sha2' } })
      ]
    });

    // Initial mergeability checks: PR1 → mergeable, PR2 → mergeable.
    // Re-check after PR2 merge failure: PR2 → not mergeable (base branch changed).
    setupPullsGet(mockOctokit, [1, 2], [
      { number: 2, mergeable: false, mergeable_state: 'dirty', head: { sha: 'sha2' } }
    ]);

    mockOctokit.rest.pulls.merge
      .mockResolvedValueOnce({}) // PR1 succeeds
      .mockRejectedValueOnce(new Error('Base branch was modified. Review and try the merge again.')); // PR2 fails

    await run();

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(2);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 1 }));
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 2 }));

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #2'));

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('PR #2 failed due to base branch modification. Re-verifying mergeability and retrying...')
    );
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('PR #2 is no longer mergeable after base branch modification. Skipping.')
    );
  });

  test('second PR is merged on retry when mergeability resolves to true after initial null state', async () => {
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [
        createMockPR({ number: 1, title: 'Bump lodash from 4.17.20 to 4.17.21', created_at: fourDaysAgo, head: { sha: 'sha1' } }),
        createMockPR({ number: 2, title: 'Bump axios from 0.21.1 to 0.21.4',   created_at: fourDaysAgo, head: { sha: 'sha2' } })
      ]
    });

    // Initial mergeability checks: PR1 → mergeable, PR2 → mergeable.
    // Re-check after PR2 merge failure: first call returns null (GitHub still computing),
    // second call returns true (mergeability resolved). Using mockReturnValueOnce to
    // simulate advancing through time via call count rather than actual delays.
    setupPullsGet(mockOctokit, [1, 2], [
      { number: 2, mergeable: null,  mergeable_state: 'unknown', head: { sha: 'sha2' } },
      { number: 2, mergeable: true,  mergeable_state: 'clean',   head: { sha: 'sha2' } }
    ]);

    mockOctokit.rest.pulls.merge
      .mockResolvedValueOnce({}) // PR1 succeeds
      .mockRejectedValueOnce(new Error('Base branch was modified. Review and try the merge again.')) // PR2 first attempt fails
      .mockResolvedValueOnce({}); // PR2 retry succeeds

    await run();

    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(3);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 1 }));
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 2 }));

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #1'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Successfully merged PR #2 on retry'));

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('PR #2 failed due to base branch modification. Re-verifying mergeability and retrying...')
    );
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Retrying merge for PR #2 after re-verification')
    );

    // pulls.get called twice for initial checks + twice for the re-check retry (null then true)
    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledTimes(4);
  });
});
