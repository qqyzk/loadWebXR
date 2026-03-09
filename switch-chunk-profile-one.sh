#!/usr/bin/env bash
#
# 仅对单个应用（tale / hallo / mus）做分块版本切换，其他应用不变。
# 逻辑与 switch-chunk-profile.sh 一致，只是把循环改为只处理传入的 scenario。
#
# Usage:
#   ./switch-chunk-profile-one.sh <scenario> <profile> <full|apply>
#
# 参数:
#   scenario - 只处理该应用: tale | hallo | mus
#   profile   - 分块方案名，如 4g、4g_50、3g_30 等
#   full      - 全流程：profile 文件 → chunk_plan → split-by-plan → apply_chunks
#   apply     - 只运行 apply_chunks（在已有分块结果下切换该应用的版本）
#
# 示例:
#   ./switch-chunk-profile-one.sh mus 4g_50 full   # 仅 mus：生成 plan、split、apply
#   ./switch-chunk-profile-one.sh mus 4g_50 apply  # 仅 mus：切换到 4g_50（tale/hallo 不变）
#
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SCENARIO="${1:?Usage: $0 <scenario> <profile> <full|apply>   e.g. $0 mus 4g_50 apply}"
PROFILE="${2:?Usage: $0 <scenario> <profile> <full|apply>   e.g. $0 mus 4g_50 apply}"
MODE="${3:?Usage: $0 <scenario> <profile> <full|apply>   e.g. $0 mus 4g_50 apply}"

VALID_SCENARIOS=(tale hallo mus)
if [[ ! " ${VALID_SCENARIOS[*]} " =~ " ${SCENARIO} " ]]; then
  echo "Usage: $0 <scenario> <profile> <full|apply>"
  echo "  scenario must be one of: tale, hallo, mus"
  exit 1
fi

if [[ "$MODE" != "full" && "$MODE" != "apply" ]]; then
  echo "Usage: $0 <scenario> <profile> <full|apply>"
  echo "  mode: full (plan+split+apply) or apply (only apply_chunks)"
  exit 1
fi

DATA_DIR="visualize/data"

# 解析 profile：4g_30 -> BASE_PROFILE=4g, EXPANSION=30
if [[ "$PROFILE" =~ ^(.+)_([0-9]+)$ ]]; then
  BASE_PROFILE="${BASH_REMATCH[1]}"
  EXPANSION="${BASH_REMATCH[2]}"
else
  BASE_PROFILE="$PROFILE"
  EXPANSION=""
fi

CHUNK_PLAN_NAME="chunk_plan_profile_${PROFILE}.json"
scenario_dir="${DATA_DIR}/${SCENARIO}"
chunk_plan="${scenario_dir}/${CHUNK_PLAN_NAME}"
chunk_report="model-splitter/results/${SCENARIO}/chunk_report_${PROFILE}.json"

echo "========== $SCENARIO / profile=$PROFILE / mode=$MODE =========="

if [[ "$MODE" == "full" ]]; then
  profile_file="${scenario_dir}/profile_${BASE_PROFILE}"
  profile_file_json="${scenario_dir}/profile_${BASE_PROFILE}.json"
  if [[ -f "$profile_file" || -f "$profile_file_json" ]]; then
    if [[ -f "$profile_file" ]]; then
      pf="$profile_file"
    else
      pf="$profile_file_json"
    fi
    if [[ -n "$EXPANSION" ]]; then
      echo "[plan] $SCENARIO: python3.12 visualize/analyze_profile_for_chunking.py $pf --expansion $EXPANSION --output $chunk_plan"
      python3.12 visualize/analyze_profile_for_chunking.py "$pf" --expansion "$EXPANSION" --output "$chunk_plan"
    else
      echo "[plan] $SCENARIO: python3.12 visualize/analyze_profile_for_chunking.py $pf"
      python3.12 visualize/analyze_profile_for_chunking.py "$pf"
      wrong_plan="${scenario_dir}/chunk_plan_$(basename "$pf").json"
      if [[ -f "$wrong_plan" && "$wrong_plan" != "$chunk_plan" ]]; then
        mv "$wrong_plan" "$chunk_plan"
      fi
    fi
  fi

  if [[ ! -f "$chunk_plan" ]]; then
    echo "[skip] $SCENARIO: chunk_plan not found: $chunk_plan"
    exit 1
  fi
  echo "[split] $SCENARIO: node model-splitter/split-by-plan.js --chunk-plan $chunk_plan"
  node model-splitter/split-by-plan.js --chunk-plan "$chunk_plan"
fi

if [[ ! -f "$chunk_report" ]]; then
  echo "[skip] $SCENARIO: chunk_report not found: $chunk_report (run with full first?)"
  exit 1
fi
echo "[apply] $SCENARIO: python3.12 model-splitter/apply_chunks.py --chunk-report $chunk_report"
python3.12 model-splitter/apply_chunks.py --chunk-report "$chunk_report"

echo ""
echo "Done. $SCENARIO now uses chunk-profile=\"$PROFILE\" (tale/hallo/mus 中仅 $SCENARIO 被更改)."

AFRAME_DIR="${SCRIPT_DIR}/aframe-master"
if [[ -d "$AFRAME_DIR" ]]; then
  echo ""
  echo "[aframe] switch to prism and build + update apps..."
  (cd "$AFRAME_DIR" && sh switch-version.sh prism && sh update.sh)
fi
