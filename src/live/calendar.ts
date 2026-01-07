const BRATISLAVA_TZ = "Europe/Bratislava";

export function getMonthStartTimestamp(): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value);
  
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    timeZoneName: "shortOffset",
  });
  const offsetParts = offsetFormatter.formatToParts(monthStart);
  const tzPart = offsetParts.find((p) => p.type === "timeZoneName");
  let offsetHours = 1;
  if (tzPart) {
    const match = tzPart.value.match(/GMT([+-])(\d+)/);
    if (match) {
      offsetHours = parseInt(match[2]) * (match[1] === "+" ? 1 : -1);
    }
  }
  
  const utcMonthStart = new Date(Date.UTC(year, month - 1, 1, -offsetHours, 0, 0, 0));
  return utcMonthStart.getTime();
}

export function getCurrentMonthName(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    month: "long",
    year: "numeric",
  });
  return formatter.format(now);
}

export function getDaysInCurrentMonth(): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value);
  const month = parseInt(parts.find((p) => p.type === "month")!.value);
  return new Date(year, month, 0).getDate();
}

export function getCurrentDayOfMonth(): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  return parseInt(parts.find((p) => p.type === "day")!.value);
}
