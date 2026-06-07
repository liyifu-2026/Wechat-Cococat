#!/bin/bash
KEY=$(cat /data/auth-token)
sqlcipher /data/agent.db <<EOF
PRAGMA key = '${KEY}';
DELETE FROM context;
SELECT count(*) FROM context;
EOF
echo "done"
