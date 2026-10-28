import {Check, Copy} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';

import {SettingsGroup} from '../settings-group';

export function McpConnectionSettings() {
  const serverUrl = new URL(
    `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/mcp`,
    window.location.origin,
  ).href;
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setCopyError(false);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <SettingsGroup id='mcp-connection-heading' title='Connect an MCP client'>
      <div className='space-y-2'>
        <Label htmlFor='mcp-server-url'>Server URL</Label>
        <div className='flex h-11 border bg-background max-sm:h-12'>
          <input
            id='mcp-server-url'
            readOnly
            value={serverUrl}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            className='min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ellipsis text-foreground outline-none selection:bg-primary selection:text-primary-foreground'
          />
          <Button
            variant='ghost'
            onClick={() => void copy()}
            className='h-full shrink-0 border-l px-3'
          >
            {copied ? (
              <Check className='size-4 text-success' aria-hidden='true' />
            ) : (
              <Copy className='size-4' aria-hidden='true' />
            )}
            {copied ? 'Copied' : 'Copy URL'}
          </Button>
        </div>
        {copyError && (
          <p role='alert' className='text-sm text-destructive'>
            Could not copy the URL. Select it and copy it manually.
          </p>
        )}
      </div>
      <ol
        aria-label='Connection steps'
        className='mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground'
      >
        <li>
          Create an <strong className='font-medium text-foreground'>access token</strong> and store
          it securely in your MCP client.
        </li>
        <li>
          Add an MCP server using this URL and the{' '}
          <strong className='font-medium text-foreground'>Streamable HTTP</strong> transport.
        </li>
        <li>
          Select <strong className='font-medium text-foreground'>Bearer token</strong> and enter
          your access token. For headers, use{' '}
          <code className='font-mono wrap-anywhere'>
            Authorization: Bearer &lt;access-token&gt;
          </code>
          .
        </li>
      </ol>
    </SettingsGroup>
  );
}
