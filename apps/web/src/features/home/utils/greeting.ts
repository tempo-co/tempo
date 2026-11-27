/** "Good morning", "Good afternoon" or "Good evening" at the local time of `now`. */
export function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
