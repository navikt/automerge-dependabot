import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import * as github from '../__fixtures__/github.js';

jest.unstable_mockModule('@actions/core', () => core);
jest.unstable_mockModule('@actions/github', () => github);

const { run } = await import('../src/index.js');
const { hasMergeQueue, enqueuePullRequest } = await import('../src/pullRequests.js');
const { setupTestEnvironment, createMockPR } = await import('./helpers/mockSetup.js');

const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

function prDetails(number, baseRef = 'main') {
  return {
    number,
    node_id: `node${number}`,
    mergeable: true,
    mergeable_state: 'clean',
    head: { sha: `sha${number}` },
    base: { ref: baseRef }
  };
}

function setupPRs(mockOctokit, numbers, baseRef = 'main') {
  mockOctokit.rest.pulls.list.mockResolvedValue({
    data: numbers.map(n => createMockPR({
      number: n,
      title: `Bump pkg${n} from 1.0.0 to 1.0.1`,
      created_at: fourDaysAgo,
      head: { sha: `sha${n}` }
    }))
  });
  // initial scan, then the pre-merge re-check
  for (const n of numbers) mockOctokit.rest.pulls.get.mockResolvedValueOnce({ data: prDetails(n, baseRef) });
  for (const n of numbers) mockOctokit.rest.pulls.get.mockResolvedValueOnce({ data: prDetails(n, baseRef) });
}

const queueRules = { data: [{ type: 'pull_request' }, { type: 'merge_queue' }] };

describe('merge queue support', () => {
  let mockOctokit;

  function setup(inputOverrides = {}) {
    ({ mockOctokit } = setupTestEnvironment(core, github, {
      inputOverrides: { 'retry-delay-ms': '1', 'merge-queue': 'auto', ...inputOverrides }
    }));
    core.setFailed.mockClear();
    core.setOutput.mockClear();
  }

  beforeEach(() => setup());

  test('enqueues instead of merging when the base branch has a merge queue', async () => {
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    mockOctokit.graphql.mockResolvedValue({
      enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } }
    });
    setupPRs(mockOctokit, [1]);

    const merged = await run();

    expect(merged).toBe(0);
    expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
    expect(mockOctokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining('enqueuePullRequest'),
      { pullRequestId: 'node1', expectedHeadOid: 'sha1' }
    );
    expect(core.setOutput).toHaveBeenCalledWith('queued-pr-count', 1);
    expect(core.setOutput).toHaveBeenCalledWith('merged-pr-count', 0);
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('merges directly when the branch has no merge queue', async () => {
    setupPRs(mockOctokit, [1]);

    const merged = await run();

    expect(merged).toBe(1);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(mockOctokit.graphql).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('queued-pr-count', 0);
  });

  test('falls back to direct merge when rule detection fails', async () => {
    mockOctokit.rest.repos.getBranchRules.mockRejectedValue(new Error('Forbidden'));
    setupPRs(mockOctokit, [1]);

    const merged = await run();

    expect(merged).toBe(1);
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Falling back to direct merge'));
  });

  test('is opt-in: without the input, rules are not checked and PRs merge directly', async () => {
    setup({ 'merge-queue': '' });
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    setupPRs(mockOctokit, [1]);

    await run();

    expect(mockOctokit.rest.repos.getBranchRules).not.toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('merge-queue=false never checks rules and merges directly', async () => {
    setup({ 'merge-queue': 'false' });
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    setupPRs(mockOctokit, [1]);

    await run();

    expect(mockOctokit.rest.repos.getBranchRules).not.toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('merge-queue=true enqueues without checking rules', async () => {
    setup({ 'merge-queue': 'true' });
    mockOctokit.graphql.mockResolvedValue({
      enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } }
    });
    setupPRs(mockOctokit, [1]);

    await run();

    expect(mockOctokit.rest.repos.getBranchRules).not.toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('queued-pr-count', 1);
  });

  test('invalid merge-queue value warns and uses false', async () => {
    setup({ 'merge-queue': 'sometimes' });
    setupPRs(mockOctokit, [1]);

    await run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Invalid merge-queue value 'sometimes'"));
    expect(mockOctokit.rest.repos.getBranchRules).not.toHaveBeenCalled();
    expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledTimes(1);
  });

  test('fails the run and continues when enqueue fails', async () => {
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    mockOctokit.graphql
      .mockRejectedValueOnce(new Error('Not allowed'))
      .mockResolvedValueOnce({ enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } } });
    setupPRs(mockOctokit, [1, 2]);

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to add PR #1 to the merge queue: Not allowed'));
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(2);
    expect(core.setOutput).toHaveBeenCalledWith('queued-pr-count', 1);
  });

  test('looks up branch rules once per base branch', async () => {
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    mockOctokit.graphql.mockResolvedValue({
      enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } }
    });
    setupPRs(mockOctokit, [1, 2]);

    await run();

    expect(mockOctokit.rest.repos.getBranchRules).toHaveBeenCalledTimes(1);
    expect(mockOctokit.rest.repos.getBranchRules).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'main' })
    );
    expect(core.setOutput).toHaveBeenCalledWith('queued-pr-count', 2);
  });

  test('skips branch update on the queue path', async () => {
    setup({ 'update-branch-before-merge': 'true' });
    mockOctokit.rest.repos.getBranchRules.mockResolvedValue(queueRules);
    mockOctokit.graphql.mockResolvedValue({
      enqueuePullRequest: { mergeQueueEntry: { position: 1, state: 'QUEUED' } }
    });
    mockOctokit.rest.pulls.list.mockResolvedValue({
      data: [createMockPR({ number: 1, title: 'Bump pkg1 from 1.0.0 to 1.0.1', created_at: fourDaysAgo, head: { sha: 'sha1' } })]
    });
    mockOctokit.rest.pulls.get
      .mockResolvedValueOnce({ data: prDetails(1) })
      .mockResolvedValueOnce({ data: { ...prDetails(1), mergeable_state: 'behind' } });

    await run();

    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
    expect(mockOctokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining('enqueuePullRequest'),
      expect.anything()
    );
  });
});

describe('hasMergeQueue', () => {
  test('caches per branch and returns null on error', async () => {
    const octokit = { rest: { repos: { getBranchRules: jest.fn().mockResolvedValue({ data: [{ type: 'merge_queue' }] }) } } };
    const cache = new Map();

    expect(await hasMergeQueue(octokit, 'o', 'r', 'main', cache)).toBe(true);
    expect(await hasMergeQueue(octokit, 'o', 'r', 'main', cache)).toBe(true);
    expect(octokit.rest.repos.getBranchRules).toHaveBeenCalledTimes(1);

    octokit.rest.repos.getBranchRules.mockRejectedValue(new Error('boom'));
    expect(await hasMergeQueue(octokit, 'o', 'r', 'other', cache)).toBeNull();
  });
});

describe('enqueuePullRequest', () => {
  test('prefers the expected head oid and returns the entry', async () => {
    const octokit = { graphql: jest.fn().mockResolvedValue({ enqueuePullRequest: { mergeQueueEntry: { position: 2, state: 'QUEUED' } } }) };

    const entry = await enqueuePullRequest(octokit, 5, { node_id: 'n5', head: { sha: 'old' } }, 'new');

    expect(entry).toEqual({ position: 2, state: 'QUEUED' });
    expect(octokit.graphql).toHaveBeenCalledWith(expect.any(String), { pullRequestId: 'n5', expectedHeadOid: 'new' });
  });

  test('throws when no queue entry is returned or node id is missing', async () => {
    const octokit = { graphql: jest.fn().mockResolvedValue({ enqueuePullRequest: { mergeQueueEntry: null } }) };

    await expect(enqueuePullRequest(octokit, 5, { node_id: 'n5', head: { sha: 'a' } })).rejects.toThrow('merge queue entry');
    await expect(enqueuePullRequest(octokit, 5, { head: { sha: 'a' } })).rejects.toThrow('node ID');
  });
});
