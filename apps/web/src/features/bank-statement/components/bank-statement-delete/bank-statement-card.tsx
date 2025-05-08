import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Card} from '@/components/ui/card';
import {BankStatement} from '@/types/bank-statement';

import {FileMetadata} from '../file/file-metadata';

type BankStatementCardProps = {
  bankStatement: BankStatement;
};

export function BankStatementCard({bankStatement}: BankStatementCardProps) {
  return (
    <Card className='flex items-center p-4'>
      <div className='mr-4 rounded-md bg-muted p-3'>
        <MimeTypeIcon mimeType={bankStatement.file.mimeType} />
      </div>
      <div className='overflow-hidden'>
        <p className='mb-1 max-w-[35rem] truncate text-base text-foreground md:max-w-[23.5rem]'>
          {bankStatement.file.name}
        </p>
        <FileMetadata
          fileSize={bankStatement.file.size}
          fileType={bankStatement.file.mimeType}
          fileUploadedAt={bankStatement.uploadedAt}
        />
      </div>
    </Card>
  );
}
