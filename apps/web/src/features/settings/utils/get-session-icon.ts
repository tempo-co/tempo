import {Monitor, Smartphone, Tablet, TvMinimal} from 'lucide-react';

import Chrome from '@/assets/icons/browsers/chrome';
import Edge from '@/assets/icons/browsers/edge';
import Firefox from '@/assets/icons/browsers/firefox';
import Opera from '@/assets/icons/browsers/opera';
import Safari from '@/assets/icons/browsers/safari';
import SamsungInternet from '@/assets/icons/browsers/samsung-internet';

import {Session} from '../types/session';

const getDeviceIcon = (deviceType: Session['deviceType']) => {
  switch (deviceType?.toLowerCase()) {
    case 'mobile':
      return Smartphone;
    case 'tablet':
      return Tablet;
    case 'console':
    case 'smarttv':
    case 'wearable':
    case 'xr':
    case 'embedded':
      return TvMinimal;
    case 'desktop':
      return Monitor;
    default:
      return Monitor;
  }
};

export const getSessionIcon = (session: Session) => {
  switch (session.browserType?.toLowerCase()) {
    case 'chrome':
    case 'chromium':
      return Chrome;
    case 'firefox':
      return Firefox;
    case 'safari':
    case 'mobile safari':
      return Safari;
    case 'edge':
      return Edge;
    case 'opera':
      return Opera;
    case 'samsung browser':
      return SamsungInternet;
  }
  return getDeviceIcon(session.deviceType);
};
