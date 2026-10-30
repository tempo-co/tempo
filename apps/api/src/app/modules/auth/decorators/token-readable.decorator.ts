import {SetMetadata} from '@nestjs/common';

export const TOKEN_READABLE_KEY = 'tokenReadable';
/** Explicit opt-in for owner-scoped, side-effect-free GET routes. */
export const TokenReadable = () => SetMetadata(TOKEN_READABLE_KEY, true);
