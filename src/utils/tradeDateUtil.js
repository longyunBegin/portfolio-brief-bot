// NYSE full-day closures. Source: NYSE "Holidays & Trading Hours" (nyse.com/markets/hours-calendars).
// Extend this list every year; dates outside it are treated as trading days on weekdays.
const US_MARKET_HOLIDAYS = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-03-29','2024-05-27','2024-06-19',
  '2024-07-04','2024-09-02','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19',
  '2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19',
  '2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18',
  '2027-07-05','2027-09-06','2027-11-25','2027-12-24'
]);
const HOLIDAY_TABLE_LAST_YEAR = 2027;

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isHoliday(d) {
  return US_MARKET_HOLIDAYS.has(toDateStr(d));
}

function isTradeDate(date) {
  const d = date || new Date();
  if (isWeekend(d)) return false;
  if (isHoliday(d)) return false;
  return true;
}

function getPreviousTradeDate(date) {
  const d = new Date((date || new Date()).getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  let guard = 0;
  while (!isTradeDate(d) && guard < 15) {
    d.setDate(d.getDate() - 1);
    guard++;
  }
  return d;
}

// Works on 'YYYY-MM-DD' strings (calendar math in UTC, so the box/SCF timezone does not matter).
function isUsTradeDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !US_MARKET_HOLIDAYS.has(dateStr);
}

// Previous NYSE trading day before dateStr ('YYYY-MM-DD').
function previousUsTradeDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  for (let i = 0; i < 15; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const s = d.toISOString().slice(0, 10);
    if (isUsTradeDateStr(s)) return s;
  }
  return null;
}

function holidayTableCovers(date) {
  return (date || new Date()).getFullYear() <= HOLIDAY_TABLE_LAST_YEAR;
}

module.exports = {
  toDateStr,
  isWeekend,
  isHoliday,
  isTradeDate,
  getPreviousTradeDate,
  isUsTradeDateStr,
  previousUsTradeDateStr,
  holidayTableCovers,
};