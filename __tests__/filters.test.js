const { applyFilters, shouldAlwaysAllow } = require('../src/filters');
const core = require('@actions/core');

// Mock @actions/core
jest.mock('@actions/core');

describe('Filters Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    core.debug = jest.fn();
    core.info = jest.fn();
  });

  describe('shouldAlwaysAllow', () => {
    test('should return true for wildcard pattern', () => {
      expect(shouldAlwaysAllow('any-dependency', ['*'])).toBe(true);
    });

    test('should return true for exact match', () => {
      expect(shouldAlwaysAllow('lodash', ['lodash'])).toBe(true);
    });

    test('should return true for name:string pattern match', () => {
      expect(shouldAlwaysAllow('eslint-plugin-react', ['name:eslint'])).toBe(true);
    });

    test('should return false for non-matching dependency', () => {
      expect(shouldAlwaysAllow('axios', ['lodash', 'react'])).toBe(false);
    });

    test('should return false for non-matching pattern', () => {
      expect(shouldAlwaysAllow('axios', ['name:react'])).toBe(false);
    });

    test('should handle empty alwaysAllow list', () => {
      expect(shouldAlwaysAllow('axios', [])).toBe(false);
    });

    test('should handle package names with colons', () => {
      expect(shouldAlwaysAllow('no.nav.appsec:package-a', ['no.nav.appsec:package-a'])).toBe(true);
      expect(shouldAlwaysAllow('no.nav.appsec:package-b', 
        ['no.nav.appsec:package-a', 'no.nav.appsec:package-b'])).toBe(true);
      expect(shouldAlwaysAllow('com.example:other-package', ['no.nav.appsec:package-a'])).toBe(false);
    });

    test('should match package with colon using name pattern', () => {
      expect(shouldAlwaysAllow('no.nav.appsec:package-a', ['name:appsec'])).toBe(true);
      expect(shouldAlwaysAllow('no.nav.appsec:package-a', ['name:package-a'])).toBe(true);
    });

    test('should match packages based on prefix pattern', () => {
      expect(shouldAlwaysAllow('no.nav.appsec:contracts', ['no.nav.appsec'])).toBe(true);
      expect(shouldAlwaysAllow('com.example.core:utils', ['com.example'])).toBe(true);
      expect(shouldAlwaysAllow('org.apache.maven:core', ['org'])).toBe(true);
      expect(shouldAlwaysAllow('org.springframework:core', ['org.other'])).toBe(false);
    });

    test('should handle non-semver dependencies with always-allow wildcard', () => {
      const nonSemverPR = {
        number: 105,
        title: 'Bump non-semver-package from abc123 to def456',
        user: { login: 'dependabot[bot]' },
        dependencyInfo: {
          name: 'non-semver-package',
          fromVersion: 'abc123',
          toVersion: 'def456',
          semverChange: 'unknown'
        }
      };

      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        alwaysAllow: ['*'],
        semverFilter: ['patch', 'minor']
      };

      const result = applyFilters([nonSemverPR], filters);
      expect(result.length).toBe(1);
      expect(result[0].number).toBe(105);
    });

    test('should handle non-semver dependencies with always-allow name pattern', () => {
      const nonSemverPR = {
        number: 105,
        title: 'Bump my-non-semver-lib from abc123 to def456',
        user: { login: 'dependabot[bot]' },
        dependencyInfo: {
          name: 'my-non-semver-lib',
          fromVersion: 'abc123',
          toVersion: 'def456',
          semverChange: 'unknown'
        }
      };

      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        alwaysAllow: ['name:non-semver'],
        semverFilter: ['patch', 'minor']
      };

      const result = applyFilters([nonSemverPR], filters);
      expect(result.length).toBe(1);
      expect(result[0].number).toBe(105);
    });

    test('should handle multiple dependencies with always-allow pattern', () => {
      const multiNonSemverPR = {
        number: 106,
        title: 'Bump multiple dependencies',
        user: { login: 'dependabot[bot]' },
        dependencyInfoList: [
          {
            name: 'semver-package',
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            semverChange: 'major'
          },
          {
            name: 'non-semver-lib',
            fromVersion: 'abc',
            toVersion: 'def',
            semverChange: 'unknown'
          }
        ]
      };

      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        alwaysAllow: ['name:non-semver'],
        semverFilter: ['patch', 'minor']
      };

      const result = applyFilters([multiNonSemverPR], filters);
      expect(result.length).toBe(0); // Should be filtered out due to the 'major' semver change in the first dependency
    });
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

  const mockMultiDependencyPRs = [
    {
      number: 101,
      title: 'Bump multiple dependencies',
      user: { login: 'dependabot[bot]' },
      dependencyInfoList: [
        {
          name: 'express',
          fromVersion: '4.17.1',
          toVersion: '4.17.2',
          semverChange: 'patch'
        },
        {
          name: 'morgan',
          fromVersion: '1.10.0',
          toVersion: '1.10.1',
          semverChange: 'patch'
        }
      ]
    },
    {
      number: 102,
      title: 'Bump react and redux',
      user: { login: 'dependabot[bot]' },
      dependencyInfoList: [
        {
          name: 'react',
          fromVersion: '17.0.2',
          toVersion: '18.0.0',
          semverChange: 'major'
        },
        {
          name: 'redux',
          fromVersion: '4.1.0',
          toVersion: '4.2.0',
          semverChange: 'minor'
        }
      ]
    },
    {
      number: 103,
      title: 'Bump multiple mixed dependencies',
      user: { login: 'dependabot[bot]' },
      dependencyInfoList: [
        {
          name: 'lodash',
          fromVersion: '4.17.20',
          toVersion: '4.17.21',
          semverChange: 'patch'
        },
        {
          name: 'axios',
          fromVersion: '0.21.0',
          toVersion: '0.22.0',
          semverChange: 'minor'
        }
      ]
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

  test('should handle unknown semver change when explicitly allowed', () => {
    const nonSemverPR = {
      number: 107,
      title: 'Bump non-semver-package from abc123 to def456',
      user: { login: 'dependabot[bot]' },
      dependencyInfo: {
        name: 'non-semver-package',
        fromVersion: 'abc123',
        toVersion: 'def456',
        semverChange: 'unknown'
      }
    };

    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      alwaysAllow: [],
      semverFilter: ['patch', 'minor', 'unknown']
    };

    const result = applyFilters([nonSemverPR], filters);
    expect(result.length).toBe(1);
    expect(result[0].number).toBe(107);
  });

  test('should properly handle combination of always-allow and semver-filter with unknown', () => {
    const testPRs = [
      {
        // This one should pass with always-allow pattern
        number: 201,
        title: 'Bump aws-sdk from old-version to new-version',
        user: { login: 'dependabot[bot]' },
        dependencyInfo: {
          name: 'aws-sdk',
          fromVersion: 'old-version',
          toVersion: 'new-version',
          semverChange: 'unknown'
        }
      },
      {
        // This one should pass with unknown in semver-filter
        number: 202,
        title: 'Bump random-package from v20230101 to v20230505',
        user: { login: 'dependabot[bot]' },
        dependencyInfo: {
          name: 'random-package',
          fromVersion: 'v20230101',
          toVersion: 'v20230505',
          semverChange: 'unknown'
        }
      },
      {
        // This one would normally be blocked by major change but passes due to always-allow
        number: 203,
        title: 'Bump aws-lambda from 1.0.0 to 2.0.0',
        user: { login: 'dependabot[bot]' },
        dependencyInfo: {
          name: 'aws-lambda',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          semverChange: 'major'
        }
      }
    ];

    const filters = {
      ignoredDependencies: [],
      ignoredVersions: [],
      alwaysAllow: ['name:aws'],
      semverFilter: ['patch', 'minor', 'unknown']
    };

    const result = applyFilters(testPRs, filters);
    expect(result.length).toBe(3);
    expect(result.map(pr => pr.number).sort()).toEqual([201, 202, 203]);
  });

  describe('Multi-dependency PR filtering', () => {
    test('should filter out multi-dependency PRs if any dependency is in ignored dependencies list', () => {
      const filters = {
        ignoredDependencies: ['react'],
        ignoredVersions: [],
        semverFilter: ['patch', 'minor', 'major']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(2);
      expect(result.find(pr => pr.number === 102)).toBeUndefined();
    });

    test('should filter out multi-dependency PRs if any dependency version is in ignored versions list', () => {
      const filters = {
        ignoredDependencies: [],
        ignoredVersions: ['axios@0.22.0'],
        semverFilter: ['patch', 'minor', 'major']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(2);
      expect(result.find(pr => pr.number === 103)).toBeUndefined();
    });

    test('should filter out multi-dependency PRs if any dependency has a semver level not in the filter', () => {
      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        semverFilter: ['patch', 'minor']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(2);
      expect(result.find(pr => pr.number === 102)).toBeUndefined();
    });

    test('should pass multi-dependency PRs that satisfy all filters', () => {
      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        semverFilter: ['patch']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(1);
      expect(result[0].number).toBe(101);
    });

    test('should handle wildcard version ignores in multi-dependency PRs', () => {
      const filters = {
        ignoredDependencies: [],
        ignoredVersions: ['lodash@*'],
        semverFilter: ['patch', 'minor', 'major']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(2);
      expect(result.find(pr => pr.number === 103)).toBeUndefined();
    });

    test('should handle incomplete dependency info in multi-dependency PRs', () => {
      const invalidMultiPR = {
        number: 104,
        title: 'Bump multiple dependencies with invalid info',
        user: { login: 'dependabot[bot]' },
        dependencyInfoList: [
          {
            name: 'express',
            fromVersion: '4.17.1',
            toVersion: '4.17.2',
            semverChange: 'patch'
          },
          {
            name: 'missing-info',
            fromVersion: '1.0.0',
            // Missing toVersion
            semverChange: 'patch'
          }
        ]
      };

      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        semverFilter: ['patch', 'minor', 'major']
      };

      const result = applyFilters([...mockMultiDependencyPRs, invalidMultiPR], filters);
      expect(result.length).toBe(3);
      expect(result.find(pr => pr.number === 104)).toBeUndefined();
    });

    test('should handle mixed filtering cases in multi-dependency PRs', () => {
      const filters = {
        ignoredDependencies: ['morgan'],
        ignoredVersions: ['redux@4.2.0'],
        semverFilter: ['patch', 'minor', 'major']
      };

      const result = applyFilters(mockMultiDependencyPRs, filters);
      expect(result.length).toBe(1); // Only PR 103 should pass
      expect(result[0].number).toBe(103);
      expect(result.find(pr => pr.number === 101)).toBeUndefined(); // Filtered by ignored dependency 'morgan'
      expect(result.find(pr => pr.number === 102)).toBeUndefined(); // Filtered by ignored version 'redux@4.2.0'
    });

    test('should pass multi-dependency PR when one dependency matches prefix in always-allow list', () => {
      const multiPR = {
        number: 108,
        title: 'Bump multiple dependencies',
        user: { login: 'dependabot[bot]' },
        dependencyInfoList: [
          {
            name: 'no.nav.appsec:contracts',
            fromVersion: '1.0.0',
            toVersion: '2.0.0',
            semverChange: 'major' // Would normally be blocked by semver filter
          },
          {
            name: 'other-package',
            fromVersion: '0.1.0',
            toVersion: '0.1.1',
            semverChange: 'patch'
          }
        ]
      };

      const filters = {
        ignoredDependencies: [],
        ignoredVersions: [],
        alwaysAllow: ['no.nav.appsec'],
        semverFilter: ['patch', 'minor']
      };

      const result = applyFilters([multiPR], filters);
      expect(result.length).toBe(1);
      expect(result[0].number).toBe(108);
    });
  });
});