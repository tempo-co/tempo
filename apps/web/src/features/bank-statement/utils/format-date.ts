import {differenceInMinutes, format, isSameDay, startOfToday, subDays} from 'date-fns';

export function formatDate(date: Date, isDesktop: boolean) {
  const now = new Date();
  const uploadDate = new Date(date);

  if (differenceInMinutes(now, uploadDate) < 1) {
    return 'moments ago';
  }

  const startOfTodayDate = startOfToday();
  const startOfYesterdayDate = subDays(startOfTodayDate, 1);

  if (isSameDay(uploadDate, startOfTodayDate)) {
    return `today at ${format(uploadDate, 'HH:mm')}`;
  } else if (isSameDay(uploadDate, startOfYesterdayDate)) {
    return `yesterday at ${format(uploadDate, 'HH:mm')}`;
  } else {
    return `${isDesktop ? 'on' : ''} ${format(uploadDate, 'dd/MM/yyyy HH:mm')}`;
  }
}
