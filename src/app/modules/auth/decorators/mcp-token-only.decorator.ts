import {SetMetadata} from '@nestjs/common';

export const MCP_TOKEN_ONLY_KEY = 'mcpTokenOnly';
export const McpTokenOnly = () => SetMetadata(MCP_TOKEN_ONLY_KEY, true);
