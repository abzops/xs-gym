#!/usr/bin/env bash
# End-to-end run as a real user on phone, tablet and laptop, against a local
# copy of the backend (real migrations + RLS) and a GitHub-Pages-like host.
#   tests/e2e/run.sh            # all three platforms
#   tests/e2e/run.sh phone      # one platform
# Needs: PostgreSQL 16, Node, Python 3 with Playwright (Chromium).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DIST="$(mktemp -d)"; trap 'kill $API $WEB 2>/dev/null || true; rm -rf -- "$DIST"' EXIT
bash "$HERE/start_db.sh"
ANON=$(node --input-type=module -e "
import crypto from 'node:crypto'; const b=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}), p=b({role:'anon',iss:'local',exp:4102444800});
console.log(h+'.'+p+'.'+crypto.createHmac('sha256','local-e2e-secret').update(h+'.'+p).digest('base64url'))")
(cd "$ROOT" && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY="$ANON" VITE_BASE_PATH=/xs-gym/ npx vite build --outDir "$DIST" --emptyOutDir >/dev/null)
cp "$DIST/index.html" "$DIST/404.html"
node "$HERE/server.mjs" & API=$!
python3 "$HERE/pages_server.py" "$DIST" 4300 & WEB=$!
sleep 2
status=0
node --experimental-strip-types "$ROOT/tests/ai/agent.test.mjs" 2>&1 | grep -v ExperimentalWarning || status=1
for p in ${1:-phone tablet laptop}; do python3 "$HERE/e2e.py" "$p" || status=1; done
exit $status
