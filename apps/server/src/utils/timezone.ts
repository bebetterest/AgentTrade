interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

interface ZonedDateTimeParts extends CalendarDateParts {
  hour: number;
  minute: number;
  second: number;
}

const dayKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateTimePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDayKeyFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = dayKeyFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dayKeyFormatterCache.set(timeZone, formatter);
  }
  return formatter;
};

const getDateTimePartsFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = dateTimePartsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    dateTimePartsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
};

const getZonedDateTimeParts = (value: Date, timeZone: string): ZonedDateTimeParts => {
  const partMap = new Map<string, string>();
  for (const part of getDateTimePartsFormatter(timeZone).formatToParts(value)) {
    if (part.type !== "literal") {
      partMap.set(part.type, part.value);
    }
  }
  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second"))
  };
};

const shiftCalendarDate = (value: CalendarDateParts, deltaDays: number): CalendarDateParts => {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day));
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
};

const formatCalendarDate = (value: CalendarDateParts): string =>
  `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day
    .toString()
    .padStart(2, "0")}`;

const parseCalendarDate = (value: string): CalendarDateParts => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`invalid calendar date '${value}'`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const getTimeZoneOffsetMs = (value: Date, timeZone: string): number => {
  const parts = getZonedDateTimeParts(value, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    value.getTime()
  );
};

const zonedMidnightToUtc = (value: CalendarDateParts, timeZone: string): Date => {
  let utcMs = Date.UTC(value.year, value.month - 1, value.day, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const adjustedMs = Date.UTC(value.year, value.month - 1, value.day, 0, 0, 0) - offsetMs;
    if (adjustedMs === utcMs) {
      break;
    }
    utcMs = adjustedMs;
  }
  return new Date(utcMs);
};

export const toDayKeyInTimeZone = (value: string | Date, timeZone: string): string =>
  getDayKeyFormatter(timeZone).format(typeof value === "string" ? new Date(value) : value);

export const dayKeyToUtcStart = (dayKey: string, timeZone: string): Date =>
  zonedMidnightToUtc(parseCalendarDate(dayKey), timeZone);

export const buildDashboardDayWindow = (
  timeZone: string,
  windowSize: number,
  now = new Date()
): {
  labels: string[];
  startUtc: Date;
  endUtc: Date;
  todayStartUtc: Date;
  todayEndUtc: Date;
} => {
  const today = getZonedDateTimeParts(now, timeZone);
  const todayDate = {
    year: today.year,
    month: today.month,
    day: today.day
  };
  const startDate = shiftCalendarDate(todayDate, -(windowSize - 1));
  const tomorrowDate = shiftCalendarDate(todayDate, 1);
  return {
    labels: Array.from({ length: windowSize }, (_, index) =>
      formatCalendarDate(shiftCalendarDate(startDate, index))
    ),
    startUtc: zonedMidnightToUtc(startDate, timeZone),
    endUtc: zonedMidnightToUtc(tomorrowDate, timeZone),
    todayStartUtc: zonedMidnightToUtc(todayDate, timeZone),
    todayEndUtc: zonedMidnightToUtc(tomorrowDate, timeZone)
  };
};
