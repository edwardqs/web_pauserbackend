export function calcDeadline(
  periodStart: Date,
  offsetDays: number,
  businessDaysOnly: boolean
): Date {
  const deadline = new Date(periodStart);
  if (businessDaysOnly) {
    let added = 0;
    while (added < offsetDays) {
      deadline.setDate(deadline.getDate() + 1);
      const day = deadline.getDay();
      if (day !== 0 && day !== 6) added++; // skip weekend
    }
  } else {
    deadline.setDate(deadline.getDate() + offsetDays);
  }
  deadline.setHours(23, 59, 59, 999);
  return deadline;
}