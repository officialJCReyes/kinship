// SPDX-License-Identifier: AGPL-3.0-or-later

/** "5 hours", "6 days": how long ago something happened, in whole units (the caller adds "ago"). */
export function ageText(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return unit(hours, 'hour');
  return unit(Math.floor(hours / 24), 'day');
}
