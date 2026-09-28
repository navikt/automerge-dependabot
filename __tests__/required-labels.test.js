import { describe, test, expect } from '@jest/globals';
import { applyFilters, hasRequiredLabel, getFilterReasons } from '../src/filters.js';

const makePR = (number, labels, name = 'lodash', semverChange = 'patch') => ({
  number,
  title: `Bump ${name}`,
  user: { login: 'dependabot[bot]' },
  labels: labels.map(l => ({ name: l })),
  dependencyInfo: { name, fromVersion: '1.0.0', toVersion: '1.0.1', semverChange }
});

const baseFilters = {
  ignoredDependencies: [],
  alwaysAllow: [],
  alwaysAllowLabels: [],
  ignoredVersions: [],
  semverFilter: ['patch', 'minor']
};

describe('hasRequiredLabel', () => {
  test('returns true when no required labels are configured', () => {
    expect(hasRequiredLabel([], [])).toBe(true);
    expect(hasRequiredLabel(undefined, undefined)).toBe(true);
    expect(hasRequiredLabel([{ name: 'java' }], null)).toBe(true);
  });

  test('returns true when PR has one of the required labels (case-insensitive)', () => {
    expect(hasRequiredLabel([{ name: 'JavaScript' }], ['javascript'])).toBe(true);
    expect(hasRequiredLabel([{ name: 'deps' }, { name: 'docker' }], ['javascript', 'docker'])).toBe(true);
  });

  test('returns false when PR lacks all required labels', () => {
    expect(hasRequiredLabel([{ name: 'java' }], ['javascript'])).toBe(false);
    expect(hasRequiredLabel([], ['javascript'])).toBe(false);
    expect(hasRequiredLabel(undefined, ['javascript'])).toBe(false);
  });
});

describe('applyFilters with requiredLabels', () => {
  test('without requiredLabels all PRs pass (existing behaviour)', () => {
    const prs = [makePR(1, ['javascript']), makePR(2, ['java'])];
    expect(applyFilters(prs, baseFilters)).toHaveLength(2);
  });

  test('only PRs with a required label pass', () => {
    const prs = [makePR(10, ['dependencies', 'javascript']), makePR(11, ['dependencies', 'java']), makePR(12, [])];
    const result = applyFilters(prs, { ...baseFilters, requiredLabels: ['javascript'] });

    expect(result.map(pr => pr.number)).toEqual([10]);
    expect(getFilterReasons(11)[0].reason).toContain('Missing required label');
    expect(getFilterReasons(12)[0].reason).toContain('Missing required label');
  });

  test('PRs with required label still go through other filters', () => {
    const prs = [makePR(20, ['javascript'], 'react', 'major')];
    const result = applyFilters(prs, { ...baseFilters, requiredLabels: ['javascript'] });
    expect(result).toHaveLength(0);
  });

  test('always-allow-labels cannot bypass required-labels', () => {
    const prs = [makePR(30, ['automerge', 'java']), makePR(31, ['automerge', 'javascript'], 'react', 'major')];
    const result = applyFilters(prs, {
      ...baseFilters,
      alwaysAllowLabels: ['automerge'],
      requiredLabels: ['javascript']
    });
    expect(result.map(pr => pr.number)).toEqual([31]);
  });
});
