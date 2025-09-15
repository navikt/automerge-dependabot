const core = require('@actions/core');
const timeUtils = require('../src/timeUtils');

// Mock dependencies
jest.mock('@actions/core');

describe('TimeUtils Module', () => {
  let originalDate;
  
  beforeEach(() => {
    jest.clearAllMocks();
    core.info = jest.fn();
    core.warning = jest.fn();
    
    // Store the original Date
    originalDate = global.Date;
  });
  
  afterEach(() => {
    // Restore original Date
    global.Date = originalDate;
  });
  
  test('should return true when no blackout periods are defined', () => {
    const result = timeUtils.shouldRunAtCurrentTime('');
    expect(result).toBe(true);
  });

  test('should handle day of week blackout periods correctly', () => {
    // Mock date to Monday (day 1)
    const mockMonday = new Date(2025, 4, 12); // May 12, 2025 is a Monday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockMonday;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 1; // Monday is 1
      }
    };
    
    // Test for Monday (should be in blackout period)
    const result1 = timeUtils.shouldRunAtCurrentTime('Mon');
    expect(result1).toBe(false);
    expect(core.info).toHaveBeenCalled();
    
    jest.clearAllMocks();
    
    // Mock date to Tuesday (day 2)
    const mockTuesday = new Date(2025, 4, 13); // May 13, 2025 is a Tuesday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockTuesday;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 2; // Tuesday is 2
      }
    };
    
    // Test for Monday blackout on Tuesday (should not be in blackout period)
    const result2 = timeUtils.shouldRunAtCurrentTime('Mon');
    expect(result2).toBe(true);
  });

  test('should handle ISO 8601 time range blackout periods correctly', () => {
    // Mock date to 10:30 AM
    const mockTime = new Date(2025, 4, 13, 10, 30, 0);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockTime;
        }
        return new originalDate(...args);
      }
    };
    
    // During work hours
    const result1 = timeUtils.shouldRunAtCurrentTime('T09:00:00/T17:00:00');
    expect(result1).toBe(false);
    
    // Mock date to 8:00 AM (before work hours)
    const earlyTime = new Date(2025, 4, 13, 8, 0, 0);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return earlyTime;
        }
        return new originalDate(...args);
      }
    };
    
    // Before work hours
    const result2 = timeUtils.shouldRunAtCurrentTime('T09:00:00/T17:00:00');
    expect(result2).toBe(true);
  });

  test('should handle ISO 8601 date range blackout periods correctly', () => {
    // Mock date to Dec 25, 2025
    const christmasDay = new Date(2025, 11, 25);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return christmasDay;
        }
        return new originalDate(...args);
      }
    };
    
    // During Christmas holiday period
    const result1 = timeUtils.shouldRunAtCurrentTime('2025-12-24/2026-01-05');
    expect(result1).toBe(false);
    
    // Mock date to Jan 10, 2026 (after holiday period)
    const afterHoliday = new Date(2026, 0, 10);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return afterHoliday;
        }
        return new originalDate(...args);
      }
    };
    
    // After holiday period
    const result2 = timeUtils.shouldRunAtCurrentTime('2025-12-24/2026-01-05');
    expect(result2).toBe(true);
  });

  test('should warn about unrecognized blackout period format', () => {
    const result = timeUtils.shouldRunAtCurrentTime('invalid-format');
    expect(result).toBe(true);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Unrecognized blackout period format'));
  });

  test('should format date to ISO 8601 string', () => {
    const date = new Date('2025-05-13T12:00:00Z');
    const formatted = timeUtils.formatDate(date);
    expect(formatted).toBe('2025-05-13T12:00:00.000Z');
  });

  test('should subtract days correctly', () => {
    const date = new Date('2025-05-13T12:00:00Z');
    const result = timeUtils.subtractDays(date, 5);
    expect(result.toISOString()).toBe('2025-05-08T12:00:00.000Z');
  });

  test('should check if date is after another date', () => {
    const date1 = new Date('2025-05-13T12:00:00Z');
    const date2 = new Date('2025-05-10T12:00:00Z');
    
    expect(timeUtils.isAfter(date1, date2)).toBe(true);
    expect(timeUtils.isAfter(date2, date1)).toBe(false);
  });

  test('should calculate relative time correctly', () => {
    const now = new Date('2025-05-13T12:00:00Z');
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return now;
        }
        return new originalDate(...args);
      }
    };

    const dayAgo = new Date('2025-05-12T12:00:00Z');
    expect(timeUtils.fromNow(dayAgo)).toBe('1 day ago');

    const hoursAgo = new Date('2025-05-13T08:00:00Z');
    expect(timeUtils.fromNow(hoursAgo)).toBe('4 hours ago');

    const minutesAgo = new Date('2025-05-13T11:30:00Z');
    expect(timeUtils.fromNow(minutesAgo)).toBe('30 minutes ago');

    const secondsAgo = new Date('2025-05-13T11:59:30Z');
    expect(timeUtils.fromNow(secondsAgo)).toBe('30 seconds ago');
  });

  test('should handle multiple day blackout periods', () => {
    // Mock date to Saturday (day 6)
    const mockSaturday = new Date(2025, 4, 17); // May 17, 2025 is a Saturday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockSaturday;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 6; // Saturday is 6
      }
    };
    
    // Saturday should be in blackout period
    const result1 = timeUtils.shouldRunAtCurrentTime('Sat,Sun');
    expect(result1).toBe(false);
    
    // Mock date to Sunday (day 0)
    const mockSunday = new Date(2025, 4, 18); // May 18, 2025 is a Sunday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockSunday;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 0; // Sunday is 0
      }
    };
    
    // Sunday should be in blackout period
    const result2 = timeUtils.shouldRunAtCurrentTime('Sat,Sun');
    expect(result2).toBe(false);
    
    // Mock date to Monday (day 1)
    const mockMonday = new Date(2025, 4, 19); // May 19, 2025 is a Monday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockMonday;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 1; // Monday is 1
      }
    };
    
    // Monday should not be in blackout period
    const result3 = timeUtils.shouldRunAtCurrentTime('Sat,Sun');
    expect(result3).toBe(true);
  });

  test('should handle date range with month names', () => {
    // Mock date to Dec 30, 2025
    const christmasWeek = new Date(2025, 11, 30);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return christmasWeek;
        }
        return new originalDate(...args);
      }
    };
    
    // During holiday period
    const result1 = timeUtils.shouldRunAtCurrentTime('Dec 24-Jan 5');
    expect(result1).toBe(false);
    
    // Mock date to Jan 10, 2026 (after holiday period)
    const afterHoliday = new Date(2026, 0, 10);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return afterHoliday;
        }
        return new originalDate(...args);
      }
    };
    
    // After holiday period
    const result2 = timeUtils.shouldRunAtCurrentTime('Dec 24-Jan 5');
    expect(result2).toBe(true);
  });

  test('should handle time range without T prefix', () => {
    // Mock date to 9:30 AM
    const mockTime = new Date(2025, 4, 13, 9, 30, 0);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mockTime;
        }
        return new originalDate(...args);
      }
    };
    
    // During blackout time
    const result1 = timeUtils.shouldRunAtCurrentTime('9:00-10:00');
    expect(result1).toBe(false);
    
    // Mock date to 10:30 AM (after blackout time)
    const laterTime = new Date(2025, 4, 13, 10, 30, 0);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return laterTime;
        }
        return new originalDate(...args);
      }
    };
    
    // After blackout time
    const result2 = timeUtils.shouldRunAtCurrentTime('9:00-10:00');
    expect(result2).toBe(true);
  });

  test('should handle day-specific time ranges', () => {
    // Mock date to Monday 9:30 AM
    const mondayMorning = new Date(2025, 4, 12, 9, 30, 0); // May 12, 2025 is a Monday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mondayMorning;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 1; // Monday is 1
      }
    };
    
    // Monday 9:30 AM should be in blackout period
    const result1 = timeUtils.shouldRunAtCurrentTime('Mon 9:00-10:00,Wed 13:00-14:00');
    expect(result1).toBe(false);
    
    // Mock date to Wednesday 13:30 PM
    const wednesdayAfternoon = new Date(2025, 4, 14, 13, 30, 0); // May 14, 2025 is a Wednesday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return wednesdayAfternoon;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 3; // Wednesday is 3
      }
    };
    
    // Wednesday 13:30 should be in blackout period
    const result2 = timeUtils.shouldRunAtCurrentTime('Mon 9:00-10:00,Wed 13:00-14:00');
    expect(result2).toBe(false);
    
    // Mock date to Tuesday 9:30 AM
    const tuesdayMorning = new Date(2025, 4, 13, 9, 30, 0); // May 13, 2025 is a Tuesday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return tuesdayMorning;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 2; // Tuesday is 2
      }
    };
    
    // Tuesday 9:30 AM should not be in blackout period
    const result3 = timeUtils.shouldRunAtCurrentTime('Mon 9:00-10:00,Wed 13:00-14:00');
    expect(result3).toBe(true);
  });

  test('should handle complex mixed blackout periods', () => {
    // Mock date to Saturday 10:30 AM
    const saturdayMorning = new Date(2025, 4, 17, 10, 30, 0); // May 17, 2025 is a Saturday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return saturdayMorning;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 6; // Saturday is 6
      }
    };
    
    // Saturday should be in blackout (weekend)
    const result1 = timeUtils.shouldRunAtCurrentTime('Sat,Sun,Dec 24-Jan 5,9:00-10:00');
    expect(result1).toBe(false);

    // May 17 should be in blackout (single day)
    const result2 = timeUtils.shouldRunAtCurrentTime('May 17,Dec 24-Jan 5,9:00-10:00');
    expect(result2).toBe(false);
    
    // Mock date to Monday 9:30 AM
    const mondayMorning = new Date(2025, 4, 12, 9, 30, 0); // May 12, 2025 is a Monday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return mondayMorning;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 1; // Monday is 1
      }
    };
    
    // Monday 9:30 AM should be in blackout (time range)
    const result3 = timeUtils.shouldRunAtCurrentTime('Sat,Sun,Dec 24-Jan 5,9:00-10:00');
    expect(result3).toBe(false);
    
    // Mock date to Dec 30, 2025
    const holidayPeriod = new Date(2025, 11, 30, 15, 0, 0);
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return holidayPeriod;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 1; // Monday
      }
    };
    
    // Dec 30 should be in blackout (holiday period)
    const result4 = timeUtils.shouldRunAtCurrentTime('Sat,Sun,Dec 24-Jan 5,9:00-10:00');
    expect(result4).toBe(false);
    
    // Mock date to Tuesday 11:00 AM (outside all blackout periods)
    const tuesdayMorning = new Date(2025, 4, 13, 11, 0, 0); // May 13, 2025 is a Tuesday
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return tuesdayMorning;
        }
        return new originalDate(...args);
      }
      getDay() {
        return 2; // Tuesday is 2
      }
    };
    
    // Tuesday 11:00 AM should not be in any blackout period
    const result5 = timeUtils.shouldRunAtCurrentTime('Sat,Sun,Dec 24-Jan 5,9:00-10:00');
    expect(result5).toBe(true);
  });

  test('should handle single day blackout period', () => {
    // Test May 1st blackout period
    const may1st = new Date(2025, 4, 1); // May 1, 2025
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return may1st;
        }
        return new originalDate(...args);
      }
    };

    const result1 = timeUtils.shouldRunAtCurrentTime('May 1');
    expect(result1).toBe(false);
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('is within blackout period'));

    // Test date not in blackout period (May 2nd)
    const may2nd = new Date(2025, 4, 2); // May 2, 2025
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return may2nd;
        }
        return new originalDate(...args);
      }
    };

    const result2 = timeUtils.shouldRunAtCurrentTime('May 1');
    expect(result2).toBe(true);

    // Test two-digit date (May 17th) in blackout
    const may17th = new Date(2025, 4, 17); // May 17, 2025
    global.Date = class extends Date {
      constructor(...args) {
        if (args.length === 0) {
          return may17th;
        }
        return new originalDate(...args);
      }
    };

    const result3 = timeUtils.shouldRunAtCurrentTime('May 17');
    expect(result3).toBe(false);
  });
});