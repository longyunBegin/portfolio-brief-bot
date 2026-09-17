const HOLIDAYS_2024_2026 = new Set([
  '2024-01-01','2024-01-15','2024-02-19','2024-03-29','2024-05-27','2024-06-19',
  '2024-07-04','2024-09-02','2024-11-28','2024-12-25',
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26','2025-06-19',
  '2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19',
  '2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]);

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
  return HOLIDAYS_2024_2026.has(toDateStr(d));
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

function shouldNotifyNow(now, cfg) {
  const d = now || new Date();
  if (cfg && cfg.tradeDayOnly && !isTradeDate(d)) return false;
  if (cfg && typeof cfg.hour === 'number' && d.getHours() !== cfg.hour) return false;
  if (cfg && typeof cfg.minute === 'number' && d.getMinutes() !== cfg.minute) return false;
  return true;
}

module.exports = {
  toDateStr,
  isWeekend,
  isHoliday,
  isTradeDate,
  getPreviousTradeDate,
  shouldNotifyNow,
};