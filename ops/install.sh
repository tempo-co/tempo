#!/usr/bin/env bash
# Install the deploy script and a target's host files from this checkout.
#
#   ops/install.sh staging           # as the staging user
#   sudo ops/install.sh production   # as root, from a checkout of main
set -Eeuo pipefail

REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Read-only as root: no optional index writes, so no root-owned files appear in the checkout.
git() { command git --no-optional-locks -c safe.directory="$REPO" -C "$REPO" "$@"; }
VERSION=$(git rev-parse HEAD)

copy() { install -D -m "$1" "$2" "$3" && echo "installed $3"; }

install_script() {
    local dir=$1
    copy 755 "$REPO/ops/deploy.sh" "$dir/deploy.sh"
    copy 755 "$REPO/ops/backup.sh" "$dir/backup.sh"
    copy 644 "$REPO/ops/targets/production.env" "$dir/targets/production.env"
    copy 644 "$REPO/ops/targets/staging.env" "$dir/targets/staging.env"
    echo "$VERSION" >"$dir/VERSION"
}

case ${1:-} in
    staging)
        [[ $EUID != 0 ]] || { echo 'run the staging install as the staging user, not root' >&2; exit 1; }
        install_script "$HOME/.local/lib/tempo-deploy"
        mkdir -p "$HOME/.local/bin"
        ln -sfn "$HOME/.local/lib/tempo-deploy/deploy.sh" "$HOME/.local/bin/tempo-deploy"
        copy 644 "$REPO/ops/staging/docker-compose.yml" "$HOME/.config/tempo-staging/staging.compose.yml"
        copy 700 "$REPO/ops/staging/tempo-staging-refresh.sh" "$HOME/.config/tempo-staging/tempo-staging-refresh.sh"
        ;;
    claude-bridge)
        [[ $EUID != 0 ]] || { echo 'run the bridge install as the Claude subscription user, not root' >&2; exit 1; }
        for file in bridge.mjs contract.json main.mjs search-hook.mjs subscription.mjs validation.mjs; do
            copy 600 "$REPO/ops/claude-bridge/$file" "$HOME/.local/lib/tempo-claude-bridge/$file"
        done
        copy 644 "$REPO/ops/systemd/tempo-claude-bridge.service" "$HOME/.config/systemd/user/tempo-claude-bridge.service"
        systemctl --user daemon-reload
        ;;
    production)
        [[ $EUID == 0 && -n ${SUDO_USER:-} && $SUDO_USER != root ]] || { echo 'run the production install with sudo as the deployment user' >&2; exit 1; }
        home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
        [[ $home =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsupported home directory: $home" >&2; exit 1; }
        # Production runs exactly what is on main; fetch first as the normal user.
        [[ -z $(git status --porcelain) ]] || { echo 'checkout has uncommitted changes' >&2; exit 1; }
        [[ $VERSION == "$(git rev-parse origin/main)" ]] || { echo 'checkout is not origin/main; run git fetch and check out origin/main' >&2; exit 1; }
        rendered=$(mktemp)
        trap 'rm -f "$rendered"' EXIT
        install_script /usr/local/lib/tempo-deploy
        copy 755 "$REPO/ops/sync-pins.sh" /usr/local/lib/tempo-deploy/sync-pins.sh
        copy 644 "$REPO/docker-compose.production.yml" /etc/tempo/compose/production.compose.yml
        copy 644 "$REPO/ops/tailscale.compose.yml" /etc/tempo/compose/tailscale.compose.yml
        # Earlier installs kept these next to the secrets.
        rm -f /etc/tempo/production.compose.yml /etc/tempo/tailscale.compose.yml
        for unit in tempo-deploy-production.service tempo-deploy-production.timer tempo-sync-pins.service \
            tempo-backup.service tempo-backup.timer; do
            # Rendered to a temp file: uutils `install` cannot overwrite from /dev/stdin.
            sed -e "s|@USER@|$SUDO_USER|g" -e "s|@HOME@|$home|g" "$REPO/ops/systemd/$unit" >"$rendered"
            copy 644 "$rendered" "/etc/systemd/system/$unit"
        done
        systemctl daemon-reload
        ;;
    *)
        echo "usage: $0 <staging|production>" >&2
        exit 2
        ;;
esac
echo "installed tempo-deploy $VERSION"
