const core = require('@actions/core');

/**
 * Format date to ISO 8601 string
 * 
 * @param {Date} date - Date to format
 * @returns {string} ISO 8601 formatted date string
 */
function formatDate(date) {
  return date.toISOString();
}

/**
 * Check if a date is between two other dates (inclusive)
 * 
 * @param {Date} date - Date to check
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} [granularity='millisecond'] - Granularity of comparison
 * @returns {boolean} True if date is between start and end dates
 */
function isBetween(date, startDate, endDate, granularity = 'millisecond') {
  let dateToCheck = date;
  let start = startDate;
  let end = endDate;
  
  // Adjust for granularity
  if (granularity === 'day') {
    dateToCheck = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  }
  
  return dateToCheck >= start && dateToCheck <= end;
}

/**
 * Subtract days from a date
 * 
 * @param {Date} date - Date to subtract from
 * @param {number} days - Number of days to subtract
 * @returns {Date} New date with days subtracted
 */
function subtractDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Check if first date is after second date
 * 
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {boolean} True if date1 is after date2
 */
function isAfter(date1, date2) {
  return date1 > date2;
}

/**
 * Get human-readable relative time (e.g., "2 days ago")
 * 
 * @param {Date} date - Date to get relative time for
 * @returns {string} Human-readable relative time
 */
function fromNow(date) {
  const now = new Date();
  const diffMs = now - date;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else {
    return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  }
}

/**
 * Parse ISO 8601 date range string (e.g., "2023-12-24/2024-01-05")
 * 
 * @param {string} rangeStr - ISO 8601 date range string
 * @returns {Object} Object with start and end dates
 */
function parseISODateRange(rangeStr) {
  const [startStr, endStr] = rangeStr.split('/');
  return {
    start: new Date(startStr),
    end: new Date(endStr)
  };
}

/**
 * Get day of week short name (e.g., "mon", "tue")
 * 
 * @param {Date} date - Date to get day from
 * @returns {string} Short day name (lowercase)
 */
function getDayShortName(date) {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return dayNames[date.getDay()];
}

/**
 * Check if the current time is within a blackout period
 * 
 * @param {string} blackoutPeriodsInput - Comma-separated list of blackout periods
 * @returns {boolean} True if action should run, false if in blackout period
 */
function shouldRunAtCurrentTime(blackoutPeriodsInput) {
  if (!blackoutPeriodsInput) {
    return true; // No blackout periods defined, always run
  }
  
  const now = new Date();
  const blackoutPeriods = blackoutPeriodsInput.split(',').map(p => p.trim());
  
  for (const period of blackoutPeriods) {
    if (isInBlackoutPeriod(now, period)) {
      core.info(`Current time (${now.toISOString()}) is within blackout period: ${period}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Parse month name date range (e.g., "Dec 24-Jan 5")
 * 
 * @param {string} rangeStr - Month name date range string
 * @param {Date} currentTime - Current time for year context
 * @returns {Object} Object with start and end dates
 */
function parseMonthNameDateRange(rangeStr, currentTime) {
  const monthNames = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
  };
  
  const [startPart, endPart] = rangeStr.split('-');
  
  // Parse start date (e.g., "Dec 24")
  const startMatch = startPart.trim().match(/^(\w{3})\s+(\d{1,2})$/i);
  if (!startMatch) throw new Error(`Invalid start date format: ${startPart}`);
  
  const startMonth = monthNames[startMatch[1].toLowerCase()];
  const startDay = parseInt(startMatch[2], 10);
  
  // Parse end date (e.g., "Jan 5")
  const endMatch = endPart.trim().match(/^(\w{3})\s+(\d{1,2})$/i);
  if (!endMatch) throw new Error(`Invalid end date format: ${endPart}`);
  
  const endMonth = monthNames[endMatch[1].toLowerCase()];
  const endDay = parseInt(endMatch[2], 10);
  
  const currentYear = currentTime.getFullYear();
  
  // Handle year boundary crossing (e.g., Dec 24 - Jan 5)
  let startYear = currentYear;
  let endYear = currentYear;
  
  if (startMonth > endMonth) {
    // Range crosses year boundary
    if (currentTime.getMonth() >= startMonth) {
      // We're in the start year, end is next year
      endYear = currentYear + 1;
    } else {
      // We're in the end year, start was last year
      startYear = currentYear - 1;
    }
  }
  
  return {
    start: new Date(startYear, startMonth, startDay),
    end: new Date(endYear, endMonth, endDay)
  };
}

/**
 * Parse simple time range (e.g., "9:00-10:00")
 * 
 * @param {string} rangeStr - Simple time range string
 * @param {Date} currentTime - Current time for date context
 * @returns {Object} Object with start and end times
 */
function parseSimpleTimeRange(rangeStr, currentTime) {
  const [startTimeStr, endTimeStr] = rangeStr.split('-');
  
  // Parse time components
  const startMatch = startTimeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const endMatch = endTimeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  
  if (!startMatch || !endMatch) {
    throw new Error(`Invalid time format in range: ${rangeStr}`);
  }
  
  const startHours = parseInt(startMatch[1], 10);
  const startMinutes = parseInt(startMatch[2], 10);
  const startSeconds = startMatch[3] ? parseInt(startMatch[3], 10) : 0;
  
  const endHours = parseInt(endMatch[1], 10);
  const endMinutes = parseInt(endMatch[2], 10);
  const endSeconds = endMatch[3] ? parseInt(endMatch[3], 10) : 0;
  
  // Get current date components
  const year = currentTime.getFullYear();
  const month = currentTime.getMonth();
  const day = currentTime.getDate();
  
  return {
    start: new Date(year, month, day, startHours, startMinutes, startSeconds),
    end: new Date(year, month, day, endHours, endMinutes, endSeconds)
  };
}

/**
 * Check if the given time is within a specific blackout period
 * 
 * @param {Date} currentTime - Current time as Date object
 * @param {string} period - Blackout period string
 * @returns {boolean} True if in blackout period
 */
function isInBlackoutPeriod(currentTime, period) {
  // Handle day-specific time ranges: "Mon 9:00-10:00"
  const dayTimeMatch = period.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(.+)$/i);
  if (dayTimeMatch) {
    const dayName = dayTimeMatch[1].substring(0, 3).toLowerCase();
    const timeRange = dayTimeMatch[2];
    const currentDayName = getDayShortName(currentTime);
    
    // First check if it's the right day
    if (currentDayName !== dayName) {
      return false;
    }
    
    // Then check the time range
    try {
      const { start, end } = parseSimpleTimeRange(timeRange, currentTime);
      return isBetween(currentTime, start, end);
    } catch (error) {
      core.warning(`Invalid time range in day-specific period: ${period}. Error: ${error.message}`);
      return false;
    }
  }
  
  // Handle ISO 8601 date range format: "2023-12-24/2024-01-05"
  if (period.includes('/') && !period.startsWith('T')) {
    try {
      const { start, end } = parseISODateRange(period);
      const isInBlackout = isBetween(currentTime, start, end, 'day');
      return isInBlackout;
    } catch (error) {
      core.warning(`Invalid ISO 8601 date range format: ${period}. Error: ${error.message}`);
      return false;
    }
  }
  
  // Handle month name date range: "Dec 24-Jan 5"
  if (period.includes('-') && /\w{3}\s+\d{1,2}-\w{3}\s+\d{1,2}/.test(period)) {
    try {
      const { start, end } = parseMonthNameDateRange(period, currentTime);
      return isBetween(currentTime, start, end, 'day');
    } catch (error) {
      core.warning(`Invalid month name date range format: ${period}. Error: ${error.message}`);
      return false;
    }
  }
  
  // Handle simple time range: "9:00-10:00"
  if (period.includes('-') && /^\d{1,2}:\d{2}(?::\d{2})?-\d{1,2}:\d{2}(?::\d{2})?$/.test(period)) {
    try {
      const { start, end } = parseSimpleTimeRange(period, currentTime);
      return isBetween(currentTime, start, end);
    } catch (error) {
      core.warning(`Invalid simple time range format: ${period}. Error: ${error.message}`);
      return false;
    }
  }
  
  // Handle ISO 8601 time range format: "T09:00:00/T17:00:00"
  if (period.startsWith('T') && period.includes('/')) {
    try {
      const [startTimeStr, endTimeStr] = period.split('/');
      
      // Get current date components
      const year = currentTime.getFullYear();
      const month = currentTime.getMonth();
      const day = currentTime.getDate();
      
      // Parse time components from ISO strings
      const startHours = parseInt(startTimeStr.substring(1, 3), 10);
      const startMinutes = parseInt(startTimeStr.substring(4, 6), 10);
      const startSeconds = parseInt(startTimeStr.substring(7, 9), 10);
      
      const endHours = parseInt(endTimeStr.substring(1, 3), 10);
      const endMinutes = parseInt(endTimeStr.substring(4, 6), 10);
      const endSeconds = parseInt(endTimeStr.substring(7, 9), 10);
      
      // Create date objects with current date and specified times
      const startTime = new Date(year, month, day, startHours, startMinutes, startSeconds);
      const endTime = new Date(year, month, day, endHours, endMinutes, endSeconds);
      
      // Check if current time is between start and end times
      const currentHour = currentTime.getHours();
      
      // First do a simple hour check to avoid unnecessary date comparisons
      if (currentHour > startHours && currentHour < endHours) {
        return true;
      }
      
      // For edge cases (at the hour boundaries), do the full comparison
      return isBetween(currentTime, startTime, endTime);
    } catch (error) {
      core.warning(`Invalid ISO 8601 time range format: ${period}. Error: ${error.message}`);
      return false;
    }
  }
  
  // Handle day of week format: "Mon,Tue,Wed"
  const dayOfWeekMatch = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/i.test(period);
  if (dayOfWeekMatch) {
    const dayName = period.substring(0, 3).toLowerCase();
    const currentDayName = getDayShortName(currentTime);
    return currentDayName === dayName;
  }
  
  // If we can't parse the format, log a warning
  core.warning(`Unrecognized blackout period format: ${period}. Please use ISO 8601 format.`);
  return false;
}

module.exports = {
  shouldRunAtCurrentTime,
  subtractDays,
  isAfter,
  fromNow,
  formatDate
};