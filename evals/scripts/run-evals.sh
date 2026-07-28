#!/usr/bin/env bash
# Nightly eval runner for the Hermes agent fleet.
# Called by agent-cockpit-evals.service.
#
# Usage: run-evals.sh [--dry-run]
#
# After running, writes a row to eval_runs.db.
# Eval spans are tagged eval=true to avoid polluting prod cost tracking.

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  echo "[eval] DRY RUN mode — no writes to eval_runs.db"
fi

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
EVAL_RUNS_DB="${EVAL_RUNS_DB_PATH:-/home/ubuntu/data/sqlite/shared/eval_runs.db}"
OUTPUT_DIR="/tmp/eval-runs"

mkdir -p "$OUTPUT_DIR"

# ── Load env ────────────────────────────────────────────────────────────────
ENV_FILE="/home/ubuntu/apps/agent-cockpit/.env"
if [[ -f "$ENV_FILE" ]]; then
  # Export only eval-relevant vars
  set -a
  # shellcheck source=/dev/null
  source <(grep -E "^(EVAL_BYPASS_TOKEN|LAMINAR_PROJECT_API_KEY|LAMINAR_BASE_URL)=" "$ENV_FILE" || true)
  set +a
fi

if [[ -z "${EVAL_BYPASS_TOKEN:-}" ]]; then
  echo "[eval] ERROR: EVAL_BYPASS_TOKEN not set — aborting" >&2
  exit 1
fi

echo "[eval] Starting eval run at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Datasets to run ─────────────────────────────────────────────────────────
DATASETS=(
  "henry-cos-smoke"
  "mally-cos-smoke"
  "mally-scope-deny"
  "jiddlers-ingest"
)

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_REGRESSION=0
RUN_ID="$(date +%s)-nightly"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for DATASET in "${DATASETS[@]}"; do
  echo "[eval] Running dataset: $DATASET"
  OUTPUT_FILE="$OUTPUT_DIR/eval-${DATASET}-$(date +%s).json"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[eval] DRY RUN: would run: promptfoo eval --config evals/datasets/${DATASET}.yaml"
    continue
  fi

  # Run promptfoo eval for this dataset
  if promptfoo eval \
    --config "$EVALS_DIR/datasets/${DATASET}.yaml" \
    --output "$OUTPUT_FILE" \
    --no-cache 2>&1; then
    echo "[eval] Dataset $DATASET completed"
  else
    echo "[eval] WARNING: Dataset $DATASET had failures"
  fi

  # Push results into LangFuse as scores. LangFuse records what happened but
  # never whether it was right; promptfoo knows, and otherwise throws the
  # answer away in /tmp. The bridge verifies its own writes by reading them
  # back and exits non-zero if they are not visible, so a silent drop cannot
  # look like a success. Non-fatal here: a telemetry failure must not mask the
  # eval result itself.
  if [[ -x /home/ubuntu/bin/promptfoo-to-langfuse && -f "$OUTPUT_FILE" ]]; then
    /home/ubuntu/bin/promptfoo-to-langfuse "$OUTPUT_FILE" --dataset "$DATASET" \
      || echo "[eval] WARNING: LangFuse score push failed for $DATASET (rc=$?)"
  fi

  # Parse results
  if [[ -f "$OUTPUT_FILE" ]]; then
    PASS=$(python3 -c "
import json, sys
try:
    d = json.load(open('$OUTPUT_FILE'))
    results = d.get('results', {}).get('results', [])
    print(sum(1 for r in results if r.get('success', False)))
except Exception as e:
    print(0)
" 2>/dev/null || echo 0)
    FAIL=$(python3 -c "
import json, sys
try:
    d = json.load(open('$OUTPUT_FILE'))
    results = d.get('results', {}).get('results', [])
    print(sum(1 for r in results if not r.get('success', False)))
except Exception as e:
    print(0)
" 2>/dev/null || echo 0)

    # For scope-deny: regressions = tests that passed (should have been denied)
    if [[ "$DATASET" == "mally-scope-deny" ]]; then
      REGRESSION=$PASS
    else
      REGRESSION=0
    fi

    TOTAL_PASS=$((TOTAL_PASS + PASS))
    TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
    TOTAL_REGRESSION=$((TOTAL_REGRESSION + REGRESSION))

    # Write per-dataset row to eval_runs.db
    sqlite3 "$EVAL_RUNS_DB" "
      INSERT OR REPLACE INTO runs (id, started_at, finished_at, dataset, pass, fail, regression_count, cost_usd, log_url)
      VALUES (
        '${RUN_ID}-${DATASET}',
        '$STARTED_AT',
        '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
        '$DATASET',
        $PASS,
        $FAIL,
        $REGRESSION,
        0.0,
        NULL
      );
    " 2>&1 || echo "[eval] WARNING: Could not write to eval_runs.db"
  fi
done

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ $DRY_RUN -eq 0 ]]; then
  echo "[eval] Summary: pass=$TOTAL_PASS fail=$TOTAL_FAIL regressions=$TOTAL_REGRESSION"

  # Alert if regressions detected
  if [[ $TOTAL_REGRESSION -gt 0 ]]; then
    echo "[eval] ❌ REGRESSIONS DETECTED: $TOTAL_REGRESSION scope-deny tests leaked!" >&2
    exit 1
  else
    echo "[eval] ✅ No regressions."
  fi
fi

echo "[eval] Completed at $FINISHED_AT"
