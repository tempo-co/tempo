#!/usr/bin/env bash
# Per-table fingerprints of a PostgreSQL database, and their comparison, for moving production to a new host.
#
#   table-check.sh fingerprints <command...>     # <command> runs psql reading SQL on stdin, such as
#                                                #   docker exec -i wisp-production-postgres-1 psql -U wisp -d wisp
#   table-check.sh compare <left> <right> [<left name> <right name>]
#
# A fingerprint is one line per table: "<schema.table> TAB <row count> TAB <hash>", the hash an md5 over the
# sorted md5s of the table's rows, so two copies match whatever their physical row order. The rows are read
# in one read-only snapshot with fixed output settings, so the same data gives the same text on any server.
# compare prints only the names of tables that differ or exist on one side, never a row, and exits 1 if any do.
set -Eeuo pipefail
export LC_ALL=C

usage() {
    echo "usage: $(basename "$0") fingerprints <psql command...> | compare <left> <right> [<left name> <right name>]" >&2
    exit 2
}

fingerprints() {
    (($#)) || usage
    "$@" -qAtX -v ON_ERROR_STOP=1 -f - <<'SQL'
begin transaction isolation level repeatable read read only;
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local intervalstyle = 'postgres';
set local extra_float_digits = 3;
set local bytea_output = 'hex';
select format(
    'select concat_ws(E''\t'', %L, count(*), coalesce(md5(string_agg(h, '''' order by h collate "C")), ''-'')) from (select md5(t::text) as h from %I.%I as t) as fingerprint',
    schemaname || '.' || tablename, schemaname, tablename)
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename
\gexec
rollback;
SQL
}

compare() {
    local left=$1 right=$2 left_name=${3:-left} right_name=${4:-right} file
    for file in "$left" "$right"; do
        grep -qvE $'^[^\t]+\t[0-9]+\t([0-9a-f]{32}|-)$' "$file" && { echo "$file holds lines that are not table fingerprints" >&2; exit 2; }
        [[ -s $file ]] || { echo "$file lists no tables" >&2; exit 2; }
    done
    awk -F '\t' -v left_name="$left_name" -v right_name="$right_name" '
        NR == FNR { count[$1] = $2; hash[$1] = $3; seen[$1] = 1; next }
        {
            if (!($1 in seen)) problem[$1] = "only in " right_name
            else if ($2 != count[$1]) problem[$1] = "row counts differ"
            else if ($3 != hash[$1]) problem[$1] = "rows differ"
            seen[$1] = 2
        }
        END {
            for (table in seen) {
                tables++
                if (seen[table] == 1) problem[table] = "only in " left_name
            }
            for (table in problem) { print "MISMATCH " table ": " problem[table] | "sort"; bad++ }
            close("sort")
            if (bad) { printf "%d of %d tables differ\n", bad, tables; exit 1 }
            printf "all %d tables match: same row count and row hash\n", tables
        }' "$left" "$right"
}

case ${1:-} in
    fingerprints) shift; fingerprints "$@" ;;
    compare) (($# == 3 || $# == 5)) || usage; shift; compare "$@" ;;
    *) usage ;;
esac
