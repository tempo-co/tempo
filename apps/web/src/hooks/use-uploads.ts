import {useContext} from 'react';

import {UploadsContext} from '@/providers/uploads.provider';

export const useUploads = () => {
  const context = useContext(UploadsContext);

  if (context === undefined) throw new Error('useUploads must be used within an UploadsProvider');
  return context;
};
