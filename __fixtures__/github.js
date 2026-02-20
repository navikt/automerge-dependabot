import { jest } from '@jest/globals';

export const context = {
  repo: { owner: 'owner', repo: 'repo' },
  ref: 'refs/heads/main'
};

export const getOctokit = jest.fn();
