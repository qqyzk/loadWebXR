#!/usr/bin/env bash
#
# 在多 profile 分块版本之间切换，统一操作 tale / hallo / mus 三个应用。
# 路径与应用位置保持现状，使用硬编码，无需额外输入路径。
#
# Usage:
#   ./switch-chunk-profile.sh <profile> <full|apply>
#
# 参数:
#   profile  - 分块方案名，如 4g、3g、slow、192，或带扩展的 4g_30、4g_75、4g_200（任意数字）
#   full     - 全流程：profile 文件 → chunk_plan → split-by-plan → apply_chunks（首次或重新分块时用）
#   apply    - 只运行 apply_chunks，在已有分块结果之间切换版本（日常切换用）
#
# 示例:
#   ./switch-chunk-profile.sh 4g full       # 从 profile_4g 生成 plan 再分块并应用到三个应用
#   ./switch-chunk-profile.sh 4g_50 full    # 使用 expansion=50% 生成 plan（4g 基准）
#   ./switch-chunk-profile.sh 4g_50 apply   # 切换到 4g_50 版本（只改 HTML + 拷贝对应块）
#
# 硬编码约定:
#   - 场景: tale, hallo, mus
#   - profile 原始文件: visualize/data/<scenario>/profile_<profile> 或 profile_<profile>.json（手动跑 profile 后把控制台 JSON 存成该文件）
#   - chunk_plan: visualize/data/<scenario>/chunk_plan_profile_<profile>.json（可由 analyze 从 profile 生成）
#   - chunk_report: model-splitter/results/<scenario>/chunk_report_<profile>.json
#
# 测试与切换（多分块版本，扩展% 任意）:
#   1) 生成某扩展版本: ./switch-chunk-profile.sh 4g_50 full   # 首次或重算 4g_50
#   2) 切换 prism 到该版本: ./switch-chunk-profile.sh 4g_50 apply
#   3) 只重测 prism（priority-only / no-chunk 不变），对比 max_ft 等
#   4) 换其他版本: ./switch-chunk-profile.sh 4g_75 apply 等
#

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROFILE="${1:?Usage: $0 <profile> <full|apply>   e.g. $0 4g apply}"
MODE="${2:?Usage: $0 <profile> <full|apply>   e.g. $0 4g apply}"

if [[ "$MODE" != "full" && "$MODE" != "apply" ]]; then
  echo "Usage: $0 <profile> <full|apply>"
  echo "  profile: 4g, 3g, slow, 192, ..."
  echo "  full:    profile → chunk_plan → split-by-plan → apply_chunks"
  echo "  apply:   only run apply_chunks (switch to this profile)"
  exit 1
fi

SCENARIOS=(tale hallo mus)
DATA_DIR="visualize/data"

# 解析 profile：4g_30 -> BASE_PROFILE=4g, EXPANSION=30；4g_75 -> 4g, 75；4g -> BASE_PROFILE=4g, EXPANSION=
if [[ "$PROFILE" =~ ^(.+)_([0-9]+)$ ]]; then
  BASE_PROFILE="${BASH_REMATCH[1]}"
  EXPANSION="${BASH_REMATCH[2]}"
else
  BASE_PROFILE="$PROFILE"
  EXPANSION=""
fi

CHUNK_PLAN_NAME="chunk_plan_profile_${PROFILE}.json"

for scenario in "${SCENARIOS[@]}"; do
  echo "========== $scenario / profile=$PROFILE / mode=$MODE =========="
  scenario_dir="${DATA_DIR}/${scenario}"
  chunk_plan="${scenario_dir}/${CHUNK_PLAN_NAME}"
  chunk_report="model-splitter/results/${scenario}/chunk_report_${PROFILE}.json"

  if [[ "$MODE" == "full" ]]; then
    # 1) 从 profile 文件生成 chunk_plan（用 BASE_PROFILE 定位 profile 文件）
    profile_file="${scenario_dir}/profile_${BASE_PROFILE}"
    profile_file_json="${scenario_dir}/profile_${BASE_PROFILE}.json"
    if [[ -f "$profile_file" || -f "$profile_file_json" ]]; then
      if [[ -f "$profile_file" ]]; then
        pf="$profile_file"
      else
        pf="$profile_file_json"
      fi
      if [[ -n "$EXPANSION" ]]; then
        echo "[plan] $scenario: python3.12 visualize/analyze_profile_for_chunking.py $pf --expansion $EXPANSION --output $chunk_plan"
        python3.12 visualize/analyze_profile_for_chunking.py "$pf" --expansion "$EXPANSION" --output "$chunk_plan"
      else
        echo "[plan] $scenario: python3.12 visualize/analyze_profile_for_chunking.py $pf"
        python3.12 visualize/analyze_profile_for_chunking.py "$pf"
        wrong_plan="${scenario_dir}/chunk_plan_$(basename "$pf").json"
        if [[ -f "$wrong_plan" && "$wrong_plan" != "$chunk_plan" ]]; then
          mv "$wrong_plan" "$chunk_plan"
        fi
      fi
    fi

    if [[ ! -f "$chunk_plan" ]]; then
      echo "[skip] $scenario: chunk_plan not found: $chunk_plan (put profile JSON at ${scenario_dir}/profile_${PROFILE} or run analyze manually)"
      continue
    fi
    echo "[split] $scenario: node model-splitter/split-by-plan.js --chunk-plan $chunk_plan"
    node model-splitter/split-by-plan.js --chunk-plan "$chunk_plan"
  fi

  if [[ ! -f "$chunk_report" ]]; then
    echo "[skip] $scenario: chunk_report not found: $chunk_report (run with full first?)"
    continue
  fi
  echo "[apply] $scenario: python3.12 model-splitter/apply_chunks.py --chunk-report $chunk_report"
  python3.12 model-splitter/apply_chunks.py --chunk-report "$chunk_report"
done

echo ""
echo "Done. All scenarios now use chunk-profile=\"$PROFILE\" (where report existed)."

AFRAME_DIR="${SCRIPT_DIR}/aframe-master"
if [[ -d "$AFRAME_DIR" ]]; then
  echo ""
  echo "[aframe] switch to prism and build + update apps..."
  (cd "$AFRAME_DIR" && sh switch-version.sh prism && sh update.sh)
fi
echo ""
echo "Prism 多分块版本: profile 名格式 <基准>_<扩展%>，如 4g_30、4g_75、4g_200（扩展数任意）. 基准 3g/slow/192 同理。"
echo "  测试: 切换后只重测 prism；priority-only 与 no-chunk 不变。"
