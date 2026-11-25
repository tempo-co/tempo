#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Email the operator that a server unit failed, with the end of its log.
#
#   failure-email.sh <unit>     # run by wisp-failure-email@<unit>.service (OnFailure= of each unit)
#
# Sends through the API's own SMTP settings and to its OPERATOR_ALERT_EMAIL, read from the installed
# production Compose file and env file, so the alert mail and the app mail share one configuration.
set -Eeuo pipefail

UNIT=${1:?usage: failure-email.sh <unit>}
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=targets/production.env
source "$SCRIPT_DIR/targets/production.env"
export DOCKER_CONFIG

# The image variables are required by the Compose file but play no part in the API's environment.
API_CONFIG=$(TEMPO_API_IMAGE=unused TEMPO_WEB_IMAGE=unused \
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --format json api)
UNIT_LOG=$(journalctl -u "$UNIT" -n 40 --no-pager -o short-iso 2>&1) || UNIT_LOG="(no journal: $UNIT_LOG)"
export API_CONFIG UNIT_LOG

python3 - "$UNIT" <<'PY'
import json
import os
import smtplib
import socket
import sys
from email.message import EmailMessage
from email.utils import parseaddr

unit = sys.argv[1]
env = json.loads(os.environ['API_CONFIG'])['services']['api']['environment']
to = env.get('OPERATOR_ALERT_EMAIL')
sender = env.get('EMAIL_FROM')
if not to or not sender:
    sys.exit('failure-email: OPERATOR_ALERT_EMAIL and EMAIL_FROM must be set in the API environment')

message = EmailMessage()
message['From'] = sender
message['To'] = to
message['Subject'] = f'[wisp] {unit} failed on {socket.gethostname()}'
message.set_content(
    f'{unit} failed. The end of its log:\n\n{os.environ["UNIT_LOG"]}\n\n'
    f'More: journalctl -u {unit}\n'
)

host, port = env['EMAIL_HOST'], int(env['EMAIL_PORT'])
if env.get('EMAIL_SECURE') == 'true':
    smtp = smtplib.SMTP_SSL(host, port, timeout=30)
else:
    smtp = smtplib.SMTP(host, port, timeout=30)
with smtp:
    if env.get('EMAIL_SECURE') != 'true' and env.get('EMAIL_REQUIRE_TLS') == 'true':
        smtp.starttls()
    if env.get('EMAIL_USERNAME'):
        smtp.login(env['EMAIL_USERNAME'], env['EMAIL_PASSWORD'])
    smtp.send_message(message, from_addr=parseaddr(sender)[1], to_addrs=[to])
print(f'failure-email: sent the {unit} failure to the operator')
PY
