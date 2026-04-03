#!/usr/bin/env bash

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3005/api/v1}"
TENANT_ID="${TENANT_ID:-3ad53721-e751-4133-96b7-26600c75bcf9}"
PROJECT_ID="${PROJECT_ID:-69f207ed-9d25-4d6c-b0e1-76edd3021e72}"
HOST_ID="${HOST_ID:-a9d7ffc0-0eb8-4d43-9960-2298ada671ec}"
PRESENTER_ID="${PRESENTER_ID:-37e3a92c-d8d3-40d0-8cbc-109fd67ebd6a}"
VIEWER_ID="${VIEWER_ID:-}"
TITLE="${TITLE:-Live Demo $(date +%s)}"

MEETING_JSON="$(
  curl -s -X POST "$API_BASE/meetings" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"createdBy\":\"$HOST_ID\",\"projectId\":\"$PROJECT_ID\",\"title\":\"$TITLE\"}"
)"

MEETING_ID="$(echo "$MEETING_JSON" | jq -r '.id')"
if [[ -z "$MEETING_ID" || "$MEETING_ID" == "null" ]]; then
  echo "Failed to create meeting:"
  echo "$MEETING_JSON"
  exit 1
fi

HOST_URL="$API_BASE/meetings/$MEETING_ID/demo?userId=$HOST_ID&tenantId=$TENANT_ID&role=host&name=Video%20Host"
PRESENTER_URL="$API_BASE/meetings/$MEETING_ID/demo?userId=$PRESENTER_ID&tenantId=$TENANT_ID&role=presenter&name=Video%20Presenter"

echo "MEETING_ID=$MEETING_ID"
echo "HOST_URL=$HOST_URL"
echo "PRESENTER_URL=$PRESENTER_URL"

if [[ -n "$VIEWER_ID" ]]; then
  VIEWER_URL="$API_BASE/meetings/$MEETING_ID/demo?userId=$VIEWER_ID&tenantId=$TENANT_ID&role=viewer&name=Video%20Viewer"
  echo "VIEWER_URL=$VIEWER_URL"
fi

