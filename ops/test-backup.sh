#!/usr/bin/env bash
# Offline tests for backup.sh, restore-drill.sh and failure-email.sh: each case runs copies of the
# scripts in a temporary sandbox with stub `docker`, `restic`, `df`, `sleep` and `journalctl` first
# on PATH, and a local fake SMTP server. Nothing reaches a Docker daemon, a restic repository or a
# mail provider.
#
#   ops/test-backup.sh
set -Eeuo pipefail

OPS_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wisp-test-backup.XXXXXX")
trap 'rm -rf -- "$ROOT"' EXIT

failures=0
SB=''

new_sandbox() {
    SB=$(mktemp -d "$ROOT/case.XXXXXX")
    mkdir -p "$SB/bin" "$SB/ops/targets" "$SB/backups" "$SB/fake/live" "$SB/fake/drill" "$SB/tmp"
    cp -- "$OPS_DIR/backup.sh" "$OPS_DIR/restore-drill.sh" "$OPS_DIR/failure-email.sh" "$SB/ops/"
    # The live database: one file per table holding its row count. A dump is "table count" lines.
    echo 120 >"$SB/fake/live/public.users"
    echo 48210 >"$SB/fake/live/public.transactions"
    echo 7 >"$SB/fake/live/public.bank_connections"
    : >"$SB/events.log"
    write_stubs
}

write_stubs() {
    cat >"$SB/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
event() { echo "$*" >>"$FAKE/../events.log"; }
live_dump() {
    local table
    for table in "$FAKE"/live/*; do echo "$(basename "$table") $(cat "$table")"; done
    # pg_dump archives are binary and larger than any plausible empty file.
    head -c 2000 /dev/zero | tr '\0' '#'
    echo
}
# psql stub: the query lists tables or counts one table's rows in the given fake database.
psql_answer() {
    local db=$1 query=${*: -1} table
    if [[ $query == *pg_tables* ]]; then
        for table in "$db"/*; do [[ -e $table ]] && basename "$table"; done
        return 0
    fi
    table=$(sed -nE 's/.*count\(\*\) from ([A-Za-z0-9_.]+).*/\1/p' <<<"$query")
    [[ -f $db/$table ]] || { echo "ERROR:  relation \"$table\" does not exist" >&2; return 1; }
    [[ ! -e $FAKE/unanswered-$table ]] || { echo "ERROR:  could not read block in $table" >&2; return 1; }
    cat "$db/$table"
}
case $1 in
    exec)
        shift
        [[ $1 == -i ]] && shift
        container=$1 tool=$2
        shift 2
        case $container:$tool in
            wisp-production-postgres-1:pg_dump)
                event "pg_dump $*"
                [[ ! -e $FAKE/dump-fails ]] || { echo 'pg_dump: connection refused' >&2; exit 1; }
                live_dump
                ;;
            wisp-production-postgres-1:pg_restore) cat >/dev/null ;;
            wisp-production-postgres-1:psql) psql_answer "$FAKE/live" "$@" ;;
            wisp-restore-drill:pg_isready) [[ -e $FAKE/drill-started ]] ;;
            wisp-restore-drill:pg_restore)
                event "drill pg_restore $*"
                while read -r table count; do
                    [[ $table == \#* ]] && continue
                    [[ $count =~ ^[0-9]+$ ]] || { echo 'pg_restore: input file is not a valid archive' >&2; exit 1; }
                    echo "$count" >"$FAKE/drill/$table"
                done
                ;;
            wisp-restore-drill:psql) psql_answer "$FAKE/drill" "$@" ;;
            *) echo "unexpected docker exec $container $tool" >&2; exit 1 ;;
        esac
        ;;
    inspect)
        [[ $4 == wisp-production-postgres-1 ]] || exit 1
        echo 'postgres:17.11@sha256:1111111111111111111111111111111111111111111111111111111111111111'
        ;;
    run)
        event "run ${*:2}"
        touch "$FAKE/drill-started"
        echo 0123456789ab
        ;;
    rm)
        event "rm ${*:2}"
        ;;
    compose)
        [[ " $* " == *' config --format json api '* ]] || { echo "unexpected docker $*" >&2; exit 1; }
        cat "$FAKE/api-config.json"
        ;;
    *) echo "unexpected docker $*" >&2; exit 1 ;;
esac
EOF
    cat >"$SB/bin/restic" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
sub=''
for arg; do [[ $arg == -* ]] || { sub=$arg; break; }; done
echo "restic $* repo=${RESTIC_REPOSITORY:-} password=${RESTIC_PASSWORD:+set}" >>"$FAKE/../events.log"
[[ ! -e $FAKE/restic-$sub-fails ]] || { echo "Fatal: unable to open repository at $RESTIC_REPOSITORY" >&2; exit 1; }
case $sub in
    backup) cat >"$FAKE/uploaded.dump" ;;
    forget) ;;
    dump)
        [[ -e $FAKE/uploaded.dump ]] || { echo 'Fatal: no snapshot found' >&2; exit 1; }
        cat "$FAKE/uploaded.dump"
        ;;
    *) exit 1 ;;
esac
EOF
    cat >"$SB/bin/df" <<'EOF'
#!/usr/bin/env bash
printf 'Avail\n%s\n' 50000000000
EOF
    cat >"$SB/bin/sleep" <<'EOF'
#!/usr/bin/env bash
EOF
    cat >"$SB/bin/journalctl" <<'EOF'
#!/usr/bin/env bash
echo "journalctl $*" >>"$FAKE/../events.log"
lines=10
while (($#)); do
    [[ $1 == -n ]] && lines=$2
    shift
done
# A unit's journal ends with its failure; -n prints that many of its last lines.
{
    seq -f 'backup.sh[812]: earlier line %g' 50
    echo 'backup.sh[812]: 2026-01-02 06:30:01 FAIL pg_dump failed for database wisp'
} | tail -n "$lines"
EOF
    chmod +x "$SB/bin/"*
}

# Usage: run <script> [args]: runs an ops script in the sandbox with the scheduled backup's settings;
# sets $status, output in $SB/out, events of this run in $SB/run.log.
run() {
    local script=$1 start
    shift
    start=$(wc -l <"$SB/events.log")
    status=0
    # shellcheck disable=SC2086 # EXTRA_ENV holds extra NAME=value words
    env -i HOME="$SB" PATH="$SB/bin:/usr/local/bin:/usr/bin:/bin" FAKE="$SB/fake" TMPDIR="$SB/tmp" \
        BACKUP_DIR="$SB/backups" KEEP=4 UPLOAD=true \
        RESTIC_REPOSITORY=sftp:u000000@u000000.your-storagebox.de:wisp RESTIC_PASSWORD=synthetic-test-password \
        DRILL_ROW_TOLERANCE_PERCENT=10 DRILL_ROW_TOLERANCE_ROWS=100 \
        ${EXTRA_ENV:-} bash "$SB/ops/$script" "$@" >"$SB/out" 2>&1 || status=$?
    tail -n +"$((start + 1))" "$SB/events.log" >"$SB/run.log"
}

fail() {
    echo "  FAIL: $*" >&2
    echo "  --- output ---" >&2
    sed 's/^/  | /' "$SB/out" >&2 2>/dev/null || true
    echo "  --- events ---" >&2
    sed 's/^/  | /' "$SB/run.log" >&2 2>/dev/null || true
    exit 1
}
expect_status() { [[ $status == "$1" ]] || fail "exit status $status, expected $1"; }
expect_output() { grep -qF -- "$1" "$SB/out" || fail "output lacks: $1"; }
expect_event() { grep -qF -- "$1" "$SB/run.log" || fail "no event: $1"; }
expect_no_event() { ! grep -qE -- "$1" "$SB/run.log" || fail "unexpected event matching: $1"; }
local_dumps() { find "$SB/backups" -name 'wisp-*.dump' | wc -l; }

test_backup_uploads_the_dump_and_applies_retention() {
    run backup.sh
    expect_status 0
    expect_event 'restic backup'
    expect_event 'repo=sftp:u000000@u000000.your-storagebox.de:wisp password=set'
    expect_event '--stdin --stdin-filename wisp.dump'
    cmp -s "$SB/fake/uploaded.dump" "$(find "$SB/backups" -name 'wisp-*.dump')" ||
        fail 'the uploaded snapshot is not the local dump'
    expect_event 'restic forget'
    expect_event '--keep-within 7d --keep-within-weekly 30d --prune'
    [[ $(grep -c '^restic ' "$SB/run.log") == 2 ]] || fail 'expected one upload and one forget'
}

test_pre_deploy_backup_keeps_its_dump_local() {
    EXTRA_ENV=UPLOAD=false run backup.sh
    expect_status 0
    [[ $(local_dumps) == 1 ]] || fail 'no local dump'
    expect_no_event '^restic'
}

test_failed_dump_exits_with_an_error_and_uploads_nothing() {
    touch "$SB/fake/dump-fails"
    run backup.sh
    expect_status 1
    expect_output 'FAIL pg_dump failed'
    expect_no_event '^restic'
    [[ $(local_dumps) == 0 ]] || fail 'a failed dump left an archive'
}

test_failed_upload_exits_with_an_error_and_keeps_the_local_dump() {
    touch "$SB/fake/restic-backup-fails"
    run backup.sh
    expect_status 1
    expect_output 'FAIL upload of'
    expect_no_event '^restic forget'
    [[ $(local_dumps) == 1 ]] || fail 'the local dump is gone after a failed upload'
}

test_failed_retention_exits_with_an_error() {
    touch "$SB/fake/restic-forget-fails"
    run backup.sh
    expect_status 1
    expect_output 'FAIL restic retention'
}

test_drill_passes_on_a_good_snapshot_and_removes_its_database() {
    run backup.sh
    expect_status 0
    # Rows imported since the snapshot, within the tolerance.
    echo 48260 >"$SB/fake/live/public.transactions"
    run restore-drill.sh
    expect_status 0
    expect_event 'restic dump --retry-lock 15m --host wisp-production --tag wisp-db latest /wisp.dump'
    expect_event 'run -d --name wisp-restore-drill --network none'
    expect_event 'drill pg_restore'
    expect_event 'rm -f -v wisp-restore-drill'
    expect_output 'public.transactions: 48210 restored, 48260 live'
    expect_output 'restore drill passed: 3 tables'
    [[ -z $(find "$SB/tmp" -mindepth 1) ]] || fail 'the restored dump was left behind'
}

test_drill_fails_on_an_unreadable_snapshot() {
    run backup.sh
    touch "$SB/fake/restic-dump-fails"
    run restore-drill.sh
    expect_status 1
    expect_output 'could not read the newest snapshot'
    expect_no_event '^run '

    rm "$SB/fake/restic-dump-fails"
    echo 'not an archive' >"$SB/fake/uploaded.dump"
    run restore-drill.sh
    expect_status 1
    expect_output 'the snapshot did not restore'
    expect_event 'rm -f -v wisp-restore-drill'
}

test_drill_fails_on_a_missing_table() {
    run backup.sh
    echo 12 >"$SB/fake/live/public.categories"
    run restore-drill.sh
    expect_status 1
    expect_output 'public.categories: missing from the restored database'
    expect_event 'rm -f -v wisp-restore-drill'
}

test_drill_fails_on_a_table_that_does_not_answer() {
    run backup.sh
    touch "$SB/fake/unanswered-public.users"
    run restore-drill.sh
    expect_status 1
    expect_output 'public.users: does not answer'
}

test_drill_fails_when_row_counts_are_far_from_live() {
    run backup.sh
    echo 90000 >"$SB/fake/live/public.transactions"
    run restore-drill.sh
    expect_status 1
    expect_output 'public.transactions: 48210 restored, 90000 live'
    expect_output 'restore drill FAILED'
}

# Usage: start_smtp: a local SMTP server that saves each message to $SB/fake/mail/<n>.eml, plus
# the API settings and target file failure-email.sh reads.
start_smtp() {
    mkdir -p "$SB/fake/mail"
    python3 - "$SB/fake/mail" "$SB/fake/smtp-port" <<'PY' &
import socketserver, sys
from pathlib import Path

mail_dir, port_file = Path(sys.argv[1]), Path(sys.argv[2])

class Session(socketserver.StreamRequestHandler):
    def handle(self):
        def say(line):
            self.wfile.write((line + '\r\n').encode())
        say('220 smtp.example.test')
        envelope = []
        while line := self.rfile.readline().decode():
            verb = line.strip().split(' ', 1)[0].upper()
            if verb in ('EHLO', 'HELO'):
                say('250 smtp.example.test')
            elif verb in ('MAIL', 'RCPT'):
                envelope.append(line.strip())
                say('250 ok')
            elif verb == 'DATA':
                say('354 go ahead')
                body = []
                while (data := self.rfile.readline().decode()) not in ('.\r\n', ''):
                    body.append(data)
                count = len(list(mail_dir.iterdir()))
                (mail_dir / f'{count + 1}.eml').write_text('\n'.join(envelope) + '\n\n' + ''.join(body))
                envelope = []
                say('250 queued')
            elif verb == 'QUIT':
                say('221 bye')
                return
            else:
                say('502 not implemented')

with socketserver.TCPServer(('127.0.0.1', 0), Session) as server:
    port_file.write_text(str(server.server_address[1]))
    server.serve_forever()
PY
    SMTP_PID=$!
    # Each case runs in its own subshell: this trap stops the server when the case ends.
    trap 'kill "$SMTP_PID" 2>/dev/null || true' EXIT
    for _ in $(seq 50); do
        [[ -s $SB/fake/smtp-port ]] && break
        command sleep 0.1
    done
    [[ -s $SB/fake/smtp-port ]] || fail 'the fake SMTP server did not start'
    cat >"$SB/fake/api-config.json" <<EOF
{"services": {"api": {"environment": {
  "EMAIL_HOST": "127.0.0.1", "EMAIL_PORT": "$(cat "$SB/fake/smtp-port")", "EMAIL_SECURE": "false",
  "EMAIL_REQUIRE_TLS": "false", "EMAIL_FROM": "Wisp <alerts@example.com>",
  "OPERATOR_ALERT_EMAIL": "operator@example.com", "DB_PASSWORD": "unrelated"}}}}
EOF
    cat >"$SB/ops/targets/production.env" <<EOF
# shellcheck shell=bash disable=SC2034
COMPOSE_PROJECT=wisp-test
COMPOSE_FILE=$SB/production.compose.yml
ENV_FILE=$SB/production.env
EOF
}

test_failed_unit_emails_the_operator_once() {
    start_smtp
    run failure-email.sh wisp-backup.service
    expect_status 0
    expect_event 'journalctl -u wisp-backup.service'
    [[ $(find "$SB/fake/mail" -name '*.eml' | wc -l) == 1 ]] || fail 'expected exactly one email'
    local mail=$SB/fake/mail/1.eml
    grep -qi '^RCPT TO:<operator@example.com>' "$mail" || fail 'not sent to the operator address'
    grep -qi '^MAIL FROM:<alerts@example.com>' "$mail" || fail 'not sent from the app sender'
    grep -q '^Subject: .*wisp-backup.service failed' "$mail" || fail 'subject does not name the unit'
    grep -qF 'FAIL pg_dump failed for database wisp' "$mail" || fail 'body lacks the unit log'
}

test_every_server_unit_sends_a_failure_email() {
    local unit missing=''
    for unit in "$OPS_DIR"/systemd/wisp-*.service; do
        [[ $unit == */wisp-failure-email@.service ]] && continue
        grep -qx 'OnFailure=wisp-failure-email@%n.service' "$unit" || missing+=" $(basename "$unit")"
    done
    [[ -z $missing ]] || fail "units without the failure email:$missing"
}

tests=$(declare -F | awk '$3 ~ /^test_/ { print $3 }')
for test in $tests; do
    new_sandbox
    if ("$test"); then
        echo "ok   ${test#test_}"
    else
        echo "FAIL ${test#test_}"
        failures=$((failures + 1))
    fi
done
((failures == 0)) || { echo "$failures backup test(s) failed" >&2; exit 1; }
echo 'all backup tests passed'
