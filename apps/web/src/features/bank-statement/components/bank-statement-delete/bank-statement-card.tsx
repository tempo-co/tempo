import {format} from 'date-fns';
import {Calendar} from 'lucide-react';

import {MimeTypeIcon} from '@/components/shared/mime-type-icon';
import {Card, CardHeader, CardTitle} from '@/components/ui/card';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {BankStatement} from '@/types/bank-statement';

import {BankStatementActions} from '../file/bank-statement-actions';

type BankStatementCardProps = {
  bankStatement: BankStatement;
};

export function BankStatementCard({bankStatement}: BankStatementCardProps) {
  const displayDate = format(bankStatement.uploadedAt, 'P');
  const tooltipDate = format(bankStatement.uploadedAt, 'MMM d, yyyy HH:mm');

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-4'>
          <div className='flex-shrink-0 rounded bg-muted p-2'>
            <MimeTypeIcon mimeType={bankStatement.file.mimeType} />
          </div>
          <div className='min-w-0 flex-1'>
            <CardTitle className='truncate text-base'>{bankStatement.file.name}</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className='mt-1 flex cursor-default items-center gap-1.5'>
                    <Calendar className='h-3.5 w-3.5 text-muted-foreground' />
                    <p className='text-xs text-muted-foreground'>{displayDate}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Uploaded on {tooltipDate} </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className='flex-shrink-0'>
            <BankStatementActions bankStatement={bankStatement} />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
