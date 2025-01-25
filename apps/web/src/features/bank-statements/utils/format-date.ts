import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function formatDate(date: Date, isDesktop: boolean) {
  const now = dayjs();
  const uploadDate = dayjs(date);

  if (now.diff(uploadDate, 'minute') < 1) {
    return 'moments ago';
  }

  const startOfToday = now.startOf('day');
  const startOfYesterday = startOfToday.subtract(1, 'day');

  if (uploadDate.isSame(startOfToday, 'day')) {
    return `today at ${uploadDate.format('HH:mm')}`;
  } else if (uploadDate.isSame(startOfYesterday, 'day')) {
    return `yesterday at ${uploadDate.format('HH:mm')}`;
  } else {
    return `${isDesktop ? 'on' : ''} ${uploadDate.format('DD/MM/YYYY HH:mm')}`;
  }
}
