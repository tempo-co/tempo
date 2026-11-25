#!/usr/bin/env bash
# The staging feed account's only command (forced in its authorized_keys): write the newest encrypted owner-only copy
# to stdout. Whatever command the client asks for is ignored.
#
#   [OUTBOX=<dir>] wisp-staging-copy-serve.sh
set -Eeuo pipefail

OUTBOX=${OUTBOX:-/var/lib/wisp-staging-copy}
shopt -s nullglob
copies=("$OUTBOX"/wisp-staging-copy-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump.gpg)
((${#copies[@]})) || { echo "staging-copy-serve: no copy in $OUTBOX" >&2; exit 1; }
newest=${copies[-1]}
[[ -f $newest && ! -L $newest && -s $newest ]] || { echo "staging-copy-serve: $newest is not a non-empty regular file" >&2; exit 1; }
echo "staging-copy-serve: sending $(basename "$newest")" >&2
exec cat -- "$newest"
