#!/usr/bin/env bash
# Install the deploy script and a target's host files from this checkout.
#
#   ops/install.sh staging           # as the staging user
#   sudo ops/install.sh production   # as root, from a checkout of main
#
# --check after the target compares the installed files with this checkout and lists the differences.
# It writes nothing and exits 1 when anything differs.
set -Eeuo pipefail

REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Read-only as root: no optional index writes, so no root-owned files appear in the checkout.
git() { command git --no-optional-locks -c safe.directory="$REPO" -C "$REPO" "$@"; }
VERSION=$(git rev-parse HEAD)

usage() { echo "usage: $0 <staging|production> [--check]" >&2; exit 2; }
CHECK=false
case $#:${2:-} in
    1:) ;;
    2:--check) CHECK=true ;;
    *) usage ;;
esac
drift=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

copy() {
    local mode=$1 src=$2 dest=$3
    if ! $CHECK; then
        install -D -m "$mode" "$src" "$dest" && echo "installed $dest"
        return
    fi
    if [[ ! -f $dest ]]; then
        echo "missing $dest"
        drift=1
        return
    fi
    if ! cmp -s "$dest" "$src"; then
        echo "differs $dest"
        diff -u --label "$dest (installed)" --label "$dest (checkout)" "$dest" "$src" || true
        drift=1
    fi
    local installed_mode
    installed_mode=$(stat -c %a "$dest")
    if [[ $installed_mode != "$mode" ]]; then
        echo "mode $dest is $installed_mode, checkout installs $mode"
        drift=1
    fi
}

# Units carry @USER@ and @HOME@; rendered to a temp file because uutils `install` cannot read /dev/stdin.
copy_rendered() {
    local mode=$1 src=$2 dest=$3 user=$4 home=$5 rendered
    rendered="$tmp/$(basename "$src")"
    sed -e "s|@USER@|$user|g" -e "s|@HOME@|$home|g" "$src" >"$rendered"
    copy "$mode" "$rendered" "$dest"
}

# A link that should point at target; in check mode, report one that doesn't.
link() {
    local target=$1 name=$2
    if ! $CHECK; then
        ln -sfn "$target" "$name"
    elif [[ $(readlink "$name" 2>/dev/null) != "$target" ]]; then
        echo "link $name does not point at $target"
        drift=1
    fi
}

# Files earlier installs put elsewhere; in check mode, report any still there.
remove_old() {
    local file
    for file in "$@"; do
        if ! $CHECK; then
            rm -f "$file"
        elif [[ -e $file ]]; then
            echo "leftover $file"
            drift=1
        fi
    done
}

install_script() {
    local dir=$1
    copy 755 "$REPO/ops/deploy.sh" "$dir/deploy.sh"
    copy 755 "$REPO/ops/backup.sh" "$dir/backup.sh"
    copy 644 "$REPO/ops/targets/production.env" "$dir/targets/production.env"
    copy 644 "$REPO/ops/targets/staging.env" "$dir/targets/staging.env"
    if $CHECK; then
        # Informational: main moves on without ops changes, so an older version is not drift.
        echo "installed version $(cat "$dir/VERSION" 2>/dev/null || echo none), checkout $VERSION"
    else
        echo "$VERSION" >"$dir/VERSION"
    fi
}

case ${1:-} in
    staging)
        [[ $EUID != 0 ]] || { echo 'run the staging install as the staging user, not root' >&2; exit 1; }
        install_script "$HOME/.local/lib/tempo-deploy"
        $CHECK || mkdir -p "$HOME/.local/bin"
        link "$HOME/.local/lib/tempo-deploy/deploy.sh" "$HOME/.local/bin/tempo-deploy"
        copy 644 "$REPO/ops/staging/docker-compose.yml" "$HOME/.config/tempo-staging/staging.compose.yml"
        copy 700 "$REPO/ops/staging/tempo-staging-refresh.sh" "$HOME/.config/tempo-staging/tempo-staging-refresh.sh"
        copy 644 "$REPO/ops/staging/tailscale.compose.yml" "$HOME/.config/tempo-staging/tailscale.compose.yml"
        copy 644 "$REPO/ops/staging/tailscale-serve.json" "$HOME/.config/tempo-staging/tailscale-serve.json"
        ;;
    production)
        [[ $EUID == 0 && -n ${SUDO_USER:-} && $SUDO_USER != root ]] || { echo 'run the production install with sudo as the deployment user' >&2; exit 1; }
        home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
        [[ $home =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsupported home directory: $home" >&2; exit 1; }
        # Production runs exactly what is on main; fetch first as the normal user. A check compares any clean commit.
        [[ -z $(git status --porcelain) ]] || { echo 'checkout has uncommitted changes' >&2; exit 1; }
        $CHECK || [[ $VERSION == "$(git rev-parse origin/main)" ]] || { echo 'checkout is not origin/main; run git fetch and check out origin/main' >&2; exit 1; }
        install_script /usr/local/lib/tempo-deploy
        copy 755 "$REPO/ops/sync-pins.sh" /usr/local/lib/tempo-deploy/sync-pins.sh
        copy 644 "$REPO/ops/production.compose.yml" /etc/tempo/compose/production.compose.yml
        copy 644 "$REPO/ops/tailscale.compose.yml" /etc/tempo/compose/tailscale.compose.yml
        copy 755 "$REPO/ops/tempo-api-egress.sh" /usr/local/sbin/tempo-api-egress
        # Earlier installs kept these next to the secrets.
        remove_old /etc/tempo/production.compose.yml /etc/tempo/tailscale.compose.yml
        for unit in tempo-deploy-production.service tempo-deploy-production.timer tempo-sync-pins.service \
            tempo-backup.service tempo-backup.timer tempo-api-egress.service; do
            copy_rendered 644 "$REPO/ops/systemd/$unit" "/etc/systemd/system/$unit" "$SUDO_USER" "$home"
        done
        if ! $CHECK; then
            systemctl daemon-reload
            echo 'if the egress script or unit changed: sudo systemctl reload tempo-api-egress'
        fi
        ;;
    *) usage ;;
esac
if $CHECK; then
    ((drift)) && exit 1
    echo "installed files match $VERSION"
else
    echo "installed tempo-deploy $VERSION"
fi
