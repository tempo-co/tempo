import {KeyRound, Plus} from 'lucide-react';
import {useRef, useState} from 'react';

import {EmptyState} from '@/components/shared/layout/app-empty-state';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';

import {usePersonalAccessTokens} from '../../api/use-personal-access-tokens';
import {SettingsGroup, SettingsList} from '../settings-group';
import {AccessTokenCard} from './access-token-card';
import {CreateTokenDialog} from './create-token-dialog';

export function AccessTokenSettings() {
  const {data: tokens, isPending, isError, refetch} = usePersonalAccessTokens();
  // The dialog lives outside the empty state, so the one-time reveal survives the list refresh.
  const [creating, setCreating] = useState(false);
  const headerCreate = useRef<HTMLButtonElement>(null);
  const emptyCreate = useRef<HTMLButtonElement>(null);
  const hasTokens = (tokens?.length ?? 0) > 0;

  return (
    <SettingsGroup
      id='access-tokens-heading'
      title='Access tokens'
      description='Access tokens let MCP clients, such as AI assistants, read your Tempo data.'
      action={
        hasTokens && (
          <Button
            ref={headerCreate}
            size='sm'
            onClick={() => setCreating(true)}
            className='max-sm:h-11'
          >
            <Plus className='size-4' aria-hidden='true' />
            Create token
          </Button>
        )
      }
    >
      {isPending && <Skeleton className='h-24 w-full rounded-card border bg-card' />}
      {isError && (
        <EmptyState
          icon={KeyRound}
          tone='error'
          title='Access tokens could not be loaded.'
          description='Check your connection and try again.'
        >
          <Button variant='outline' onClick={() => void refetch()}>
            Try again
          </Button>
        </EmptyState>
      )}
      {tokens?.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title='No access tokens yet.'
          description='Create a token to connect an MCP client.'
        >
          <Button ref={emptyCreate} onClick={() => setCreating(true)} className='max-sm:h-11'>
            Create token
          </Button>
        </EmptyState>
      )}
      {hasTokens && (
        <SettingsList>
          {tokens?.map((token) => (
            <AccessTokenCard key={token.id} token={token} />
          ))}
        </SettingsList>
      )}
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onClosed={() => (headerCreate.current ?? emptyCreate.current)?.focus()}
      />
    </SettingsGroup>
  );
}
