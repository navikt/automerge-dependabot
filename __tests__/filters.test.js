const { applyFilters } = require('../src/filters');
const core = require('@actions/core');

// Mock @actions/core
jest.mock('@actions/core');

describe('Filters Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    core.debug = jest.fn();
    core.info = jest.fn();
  });

  const mockPullRequests = [
    {
      number: 1,
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      user: { login: 'dependabot[bot]' },
      dependencyInfo: {
        name: 'lodash',
        fromVersion: '4.17.20',
        toVersion: '4.17.21',
        semverChange: 'patch'
      }
    },
    {
      number: 2,
      title: 'Bump axios from 0.21.0 to 0.22.0',
      user: { login: 'dependabot[bot]' },
      dependencyInfo: {
        name: 'axios',
        fromVersion: '0.21.0',
        toVersion: '0.22.0',
        semverChange: 'minor'
      }
    },
    {
      number: 3,
      title: 'Bump react from 17.0.0 to 18.0.0',
      user: { login: 'dependabot[bot]' },
      dependencyInfo: {
        name: 'react',
        fromVersion: '17.0.0',
        toVersion: '18.0.0',
        semverChange: 'major'
      }
    }
  ];

  test('should filter out ignored dependencies', () => {
    const filters = {
      ignoredDependencies: ['react'],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters(mockPullRequests, filters);
    expect(result.length).toBe(2);
    expect(result.find(pr => pr.number === 3)).toBeUndefined();
  });

  test('should filter out ignored versions', () => {
    const filters = {
      ignoredDependencies: [],
      ignoredVersions: ['axios@0.22.0'],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters(mockPullRequests, filters);
    expect(result.length).toBe(2);
    expect(result.find(pr => pr.number === 2)).toBeUndefined();
  });

  test('should filter out based on semver level', () => {
    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor']
    };

    const result = applyFilters(mockPullRequests, filters);
    expect(result.length).toBe(2);
    expect(result.find(pr => pr.number === 3)).toBeUndefined();
  });

  test('should handle PRs with invalid dependency info', () => {
    const invalidPR = {
      number: 4,
      title: 'Invalid PR title',
      user: { login: 'dependabot[bot]' },
      dependencyInfo: {
        name: null,
        fromVersion: null,
        toVersion: null,
        semverChange: null
      }
    };

    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters([...mockPullRequests, invalidPR], filters);
    expect(result.length).toBe(3);
    expect(result.find(pr => pr.number === 4)).toBeUndefined();
  });

  test('should handle wildcard in ignored versions', () => {
    const filters = {
      ignoredDependencies: [],
      ignoredVersions: ['lodash@*'],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters(mockPullRequests, filters);
    expect(result.length).toBe(2);
    expect(result.find(pr => pr.number === 1)).toBeUndefined();
  });

  test('should filter out PRs not created by Dependabot', () => {
    const suspiciousPR = {
      number: 5,
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      user: { login: 'malicious-user' },
      dependencyInfo: {
        name: 'lodash',
        fromVersion: '4.17.20',
        toVersion: '4.17.21',
        semverChange: 'patch'
      }
    };

    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters([...mockPullRequests, suspiciousPR], filters);
    expect(result.length).toBe(3);
    expect(result.find(pr => pr.number === 5)).toBeUndefined();
  });

  test('should filter out PRs with missing user information', () => {
    const suspiciousPR = {
      number: 6,
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      // No user property
      dependencyInfo: {
        name: 'lodash',
        fromVersion: '4.17.20',
        toVersion: '4.17.21',
        semverChange: 'patch'
      }
    };

    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      semverFilter: ['patch', 'minor', 'major']
    };

    const result = applyFilters([...mockPullRequests, suspiciousPR], filters);
    expect(result.length).toBe(3);
    expect(result.find(pr => pr.number === 6)).toBeUndefined();
  });
});