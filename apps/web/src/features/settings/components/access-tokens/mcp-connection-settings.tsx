import {SettingsGroup} from '../settings-group';
import {CopyField} from './copy-field';

export function McpConnectionSettings() {
  const serverUrl = new URL(
    `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/mcp`,
    window.location.origin,
  ).href;

  return (
    <SettingsGroup id='mcp-connection-heading' title='Connect an MCP client'>
      <CopyField
        id='mcp-server-url'
        label='Server URL'
        value={serverUrl}
        copyLabel='Copy URL'
        errorMessage='Could not copy the URL. Select it and copy it manually.'
      />
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
