#!/usr/bin/env bash
# Installed as /usr/local/sbin/wisp-api-egress by `sudo ops/install.sh production`; loaded by wisp-api-egress.service.
#
# The production API runs as uid 10001 on the root Docker daemon (ops/README.md, Container privileges).
# 1. Host-side: if code ever escapes as uid 10001, it may use DNS and the internet, and nothing on
#    loopback (other local services and databases), the LAN, link-local or the tailnet.
#    Only a positive uid match enters the chain, so socketless kernel packets (IPv6 ND, MLD) are untouched.
# 2. Container-side: Wisp's API and web networks may reach the internet, not the LAN, link-local,
#    the tailnet or this host. Traffic between containers on one network never leaves its bridge.
#    The Tailscale sidecar's network is left alone; it needs its peers.
#
# Re-resolves the bridges each run: `systemctl reload wisp-api-egress` after a network is recreated.
set -Eeuo pipefail
export LC_ALL=C
TABLE=${TABLE:-wisp_api_egress}
API_UID=${API_UID:-10001}
NETWORKS=${NETWORKS:-wisp-production_default wisp-production_ingress}

bridges=() missing=()
for net in $NETWORKS; do
    if id=$(timeout 20 docker network inspect --format '{{.Id}}' "$net" 2>/dev/null) && [[ $id =~ ^[0-9a-f]{64}$ ]]; then
        bridges+=("\"br-${id:0:12}\"")
    else
        missing+=("$net")
    fi
done
# An empty set would never match; a placeholder keeps the ruleset valid.
((${#bridges[@]})) || bridges=('"wisp-none"')
set_list=$(IFS=,; echo "${bridges[*]}")

private4='0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 255.255.255.255'
private6='::1, fc00::/7, fe80::/10, ff00::/8'

nft -f - <<EOF
table inet $TABLE
delete table inet $TABLE
table inet $TABLE {
	set bridges {
		type ifname
		elements = { $set_list }
	}
	chain output {
		type filter hook output priority filter - 5; policy accept;
		meta skuid $API_UID jump account
	}
	chain account {
		ct state established,related accept
		ip daddr { 127.0.0.53, 127.0.0.54 } meta l4proto { tcp, udp } th dport 53 accept
		ip daddr { $private4 } counter reject
		ip6 daddr { $private6 } counter reject
	}
	chain forward {
		type filter hook forward priority filter - 5; policy accept;
		iifname @bridges oifname != @bridges ct state new jump containers
	}
	chain containers {
		ip daddr { $private4 } counter reject
		ip6 daddr { $private6 } counter reject
	}
	chain input {
		type filter hook input priority filter - 5; policy accept;
		iifname @bridges ct state new meta l4proto { tcp, udp } counter reject
	}
}
EOF

if ((${#missing[@]})); then
    echo "wisp-api-egress: networks not found, not filtered: ${missing[*]}" >&2
    exit 1
fi
echo "wisp-api-egress: uid $API_UID and bridges ${bridges[*]} filtered"
