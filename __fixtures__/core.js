import { jest } from '@jest/globals';

export const getInput = jest.fn();
export const info = jest.fn();
export const debug = jest.fn();
export const warning = jest.fn();
export const error = jest.fn();
export const setFailed = jest.fn();
export const setOutput = jest.fn();
export const summary = {
  addHeading: jest.fn().mockReturnThis(),
  addRaw: jest.fn().mockReturnThis(),
  write: jest.fn().mockResolvedValue(undefined)
};
