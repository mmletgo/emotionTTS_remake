#!/usr/bin/env bash
# =============================================================================
# EmotionTTS 一键启动脚本
# 用法:
#   bash start.sh              启动所有服务（默认）
#   bash start.sh status       查看各服务状态
#   bash start.sh stop         停止所有服务
#   bash start.sh restart      重启所有服务
#   bash start.sh logs [webapp|asr|tts]  查看日志
# =============================================================================
set -euo pipefail

# ─────────────────────────────── 颜色常量 ────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}▶ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}" >&2; }
bold()    { echo -e "${BOLD}$*${RESET}"; }
hr()      { echo -e "${CYAN}──────────────────────────────────────────────────${RESET}"; }

# 脚本所在目录（仓库根）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 运行时目录
RUNTIME_DIR="$REPO_ROOT/.runtime"
PATHS_ENV="$RUNTIME_DIR/paths.env"
PIDS_DIR="$RUNTIME_DIR/pids"
LOGS_DIR="$RUNTIME_DIR/logs"

# ─────────────────────────────── 读取 paths.env ──────────────────────────────
# 软加载：缺失时返回非零，不退出脚本。status / stop 等只读子命令用这个。
try_load_paths_env() {
    if [[ ! -f "$PATHS_ENV" ]]; then
        return 1
    fi
    # shellcheck source=/dev/null
    source "$PATHS_ENV"
    return 0
}

# 硬加载：缺失时报错并退出。start / restart 等必须有环境才能执行的子命令用这个。
load_paths_env() {
    if ! try_load_paths_env; then
        error ".runtime/paths.env 不存在，请先运行:"
        echo "  bash install.sh"
        exit 1
    fi
}

# ─────────────────────────────── 读取 config.json ────────────────────────────
CONFIG_FILE="$REPO_ROOT/webapp/config/config.json"

get_config_value() {
    # 简易 JSON 提取，不依赖 jq
    local key="$1"
    python3 -c "
import json, sys
try:
    with open('$CONFIG_FILE') as f:
        cfg = json.load(f)
    # 支持 a.b 路径
    parts = '$key'.split('.')
    val = cfg
    for p in parts:
        val = val[p]
    print(val)
except Exception:
    print('')
" 2>/dev/null || echo ""
}

load_config() {
    if [[ -f "$CONFIG_FILE" ]]; then
        TTS_TYPE="$(get_config_value tts.type)"
        ASR_TYPE="$(get_config_value asr.type)"
    else
        # config.json 在 webapp 首次启动时自动创建，这里用默认值
        TTS_TYPE="local"
        ASR_TYPE="local"
    fi
}

# ─────────────────────────────── 进程管理辅助 ────────────────────────────────
pid_file() {
    echo "$PIDS_DIR/$1.pid"
}

log_file() {
    echo "$LOGS_DIR/$1.log"
}

is_running() {
    local name="$1"
    local pidfile
    pidfile="$(pid_file "$name")"
    if [[ ! -f "$pidfile" ]]; then
        return 1
    fi
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || echo '')"
    if [[ -z "$pid" ]]; then
        return 1
    fi
    kill -0 "$pid" 2>/dev/null
}

get_pid() {
    local name="$1"
    local pidfile
    pidfile="$(pid_file "$name")"
    if [[ -f "$pidfile" ]]; then
        cat "$pidfile" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

wait_for_port() {
    local port="$1"
    local timeout="${2:-30}"
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if curl -sf "http://127.0.0.1:$port/" &>/dev/null || \
           curl -sf "http://127.0.0.1:$port/healthz" &>/dev/null || \
           curl -sf "http://127.0.0.1:$port/health" &>/dev/null; then
            return 0
        fi
        sleep 1
        ((elapsed++)) || true
    done
    return 1
}

kill_service() {
    local name="$1"
    local port="$2"
    local pidfile
    pidfile="$(pid_file "$name")"

    if is_running "$name"; then
        local pid
        pid="$(get_pid "$name")"
        info "停止 $name (PID $pid)..."
        kill "$pid" 2>/dev/null || true
        # 等待最多 5 秒
        local i=0
        while [[ $i -lt 5 ]] && kill -0 "$pid" 2>/dev/null; do
            sleep 1
            ((i++)) || true
        done
        if kill -0 "$pid" 2>/dev/null; then
            warn "$name 未在 5 秒内退出，强制 KILL..."
            kill -9 "$pid" 2>/dev/null || true
        fi
        success "$name 已停止"
    fi

    # 兜底：用端口 kill
    if command -v lsof &>/dev/null; then
        local leftover
        leftover="$(lsof -ti:"$port" 2>/dev/null || true)"
        if [[ -n "$leftover" ]]; then
            warn "端口 $port 仍有进程残留，强制清理..."
            echo "$leftover" | xargs kill -9 2>/dev/null || true
        fi
    fi

    # 清空 PID 文件
    rm -f "$pidfile"
}

# =============================================================================
# 子命令：start
# =============================================================================
cmd_start() {
    hr
    bold "        EmotionTTS 启动中..."
    hr
    echo ""

    load_paths_env
    load_config
    mkdir -p "$PIDS_DIR" "$LOGS_DIR"

    # 检查 PYTHON_BIN
    if [[ -z "${PYTHON_BIN:-}" || ! -f "$PYTHON_BIN" ]]; then
        error "PYTHON_BIN 无效: ${PYTHON_BIN:-（未设置）}"
        echo "  请重新运行: bash install.sh"
        exit 1
    fi

    # ── 启动 tts_service（端口 9800） ─────────────────────────────────────────
    if [[ "${ENABLE_LOCAL_TTS:-false}" == "true" && "$TTS_TYPE" == "local" ]]; then
        if is_running "tts"; then
            local pid
            pid="$(get_pid tts)"
            warn "tts_service 已在运行 (PID $pid)，跳过启动（如需重启请用 restart）"
        else
            info "启动 tts_service（端口 9800）..."
            local tts_log
            tts_log="$(log_file tts)"
            local tts_pid_file
            tts_pid_file="$(pid_file tts)"

            # 构建 INDEXTTS_MODEL_DIR 环境变量
            local tts_model_dir="${INDEXTTS_MODEL_DIR:-}"
            if [[ -z "$tts_model_dir" ]]; then
                warn "INDEXTTS_MODEL_DIR 未配置，tts_service 可能无法加载模型"
            fi

            INDEXTTS_MODEL_DIR="$tts_model_dir" \
            nohup "$PYTHON_BIN" "$REPO_ROOT/tts_service/server.py" \
                > "$tts_log" 2>&1 &
            echo $! > "$tts_pid_file"
            success "tts_service 已启动 (PID $(cat "$tts_pid_file"))，日志: $tts_log"
        fi
    fi

    # ── 启动 asr_service（端口 9900） ─────────────────────────────────────────
    if [[ "${ENABLE_LOCAL_ASR:-false}" == "true" && "$ASR_TYPE" == "local" ]]; then
        if is_running "asr"; then
            local pid
            pid="$(get_pid asr)"
            warn "asr_service 已在运行 (PID $pid)，跳过启动（如需重启请用 restart）"
        else
            info "启动 asr_service（端口 9900）..."
            local asr_log
            asr_log="$(log_file asr)"
            local asr_pid_file
            asr_pid_file="$(pid_file asr)"

            WHISPER_MODEL_DIR="$REPO_ROOT/models/whisper-small" \
            nohup "$PYTHON_BIN" "$REPO_ROOT/asr_service/server.py" \
                > "$asr_log" 2>&1 &
            echo $! > "$asr_pid_file"
            success "asr_service 已启动 (PID $(cat "$asr_pid_file"))，日志: $asr_log"
        fi
    fi

    # ── 启动 webapp（端口 9880，始终启动） ───────────────────────────────────
    if is_running "webapp"; then
        local pid
        pid="$(get_pid webapp)"
        warn "webapp 已在运行 (PID $pid)，跳过启动（如需重启请用 restart）"
    else
        info "启动 webapp（端口 9880）..."
        local webapp_log
        webapp_log="$(log_file webapp)"
        local webapp_pid_file
        webapp_pid_file="$(pid_file webapp)"

        nohup "$PYTHON_BIN" "$REPO_ROOT/main.py" \
            > "$webapp_log" 2>&1 &
        echo $! > "$webapp_pid_file"
        success "webapp 已启动 (PID $(cat "$webapp_pid_file"))，日志: $webapp_log"
    fi

    # ── 健康探活 ─────────────────────────────────────────────────────────────
    echo ""
    info "等待服务就绪（最多 60 秒）..."

    WEBAPP_OK=false
    ASR_OK=false
    TTS_OK=false

    # webapp
    info "探活 webapp:9880 ..."
    if wait_for_port 9880 60; then
        success "webapp 已就绪: http://127.0.0.1:9880"
        WEBAPP_OK=true
    else
        warn "webapp 未在 60 秒内响应，请检查日志: $(log_file webapp)"
    fi

    # asr_service
    if [[ "${ENABLE_LOCAL_ASR:-false}" == "true" && "$ASR_TYPE" == "local" ]]; then
        info "探活 asr_service:9900 ..."
        if wait_for_port 9900 30; then
            success "asr_service 已就绪: http://127.0.0.1:9900"
            ASR_OK=true
        else
            warn "asr_service 未在 30 秒内响应（Whisper 首次加载需要时间），请检查日志: $(log_file asr)"
        fi
    fi

    # tts_service
    if [[ "${ENABLE_LOCAL_TTS:-false}" == "true" && "$TTS_TYPE" == "local" ]]; then
        info "探活 tts_service:9800 ..."
        # tts_service 首次加载模型很慢，等更长时间
        if wait_for_port 9800 120; then
            success "tts_service 已就绪: http://127.0.0.1:9800"
            TTS_OK=true
        else
            warn "tts_service 未在 120 秒内响应（IndexTTS2 首次加载可能需要更长时间）"
            warn "请稍后用 bash start.sh status 检查状态，或查看日志: $(log_file tts)"
        fi
    fi

    echo ""
    hr
    if [[ "$WEBAPP_OK" == "true" ]]; then
        success "启动完成！"
        echo ""
        echo -e "  ${BOLD}访问地址:${RESET} ${CYAN}http://127.0.0.1:9880${RESET}"
    else
        warn "webapp 可能尚未完全启动，请稍后访问 http://127.0.0.1:9880"
    fi
    echo ""
    echo "  bash start.sh status   # 查看服务状态"
    echo "  bash start.sh logs     # 查看日志"
    echo "  bash start.sh stop     # 停止所有服务"
    hr
}

# =============================================================================
# 子命令：status
# =============================================================================
cmd_status() {
    try_load_paths_env || true
    load_config

    echo ""
    bold "EmotionTTS 服务状态"
    hr
    printf "%-12s %-6s %-8s %-8s %s\n" "SERVICE" "PORT" "PID" "STATUS" "LOG"
    hr

    print_service_row() {
        local name="$1"
        local port="$2"
        local display_name="$3"

        local pid=""
        local status=""
        local log=""

        if is_running "$name"; then
            pid="$(get_pid "$name")"
            status="${GREEN}RUN${RESET}"
            log="$(log_file "$name")"
        else
            local dead_pid
            dead_pid="$(get_pid "$name")"
            if [[ -n "$dead_pid" ]]; then
                pid="$dead_pid(dead)"
                status="${RED}DEAD${RESET}"
            else
                pid="-"
                status="${YELLOW}OFF${RESET}"
            fi
            log="-"
        fi

        printf "%-12s %-6s %-8s " "$display_name" "$port" "$pid"
        echo -e "$status    $log"
    }

    print_service_row "webapp" "9880" "webapp"

    if [[ "${ENABLE_LOCAL_ASR:-false}" == "true" ]]; then
        print_service_row "asr" "9900" "asr_svc"
    else
        printf "%-12s %-6s %-8s " "asr_svc" "9900" "-"
        echo -e "${CYAN}CLOUD${RESET}  (云端 API 模式)"
    fi

    if [[ "${ENABLE_LOCAL_TTS:-false}" == "true" ]]; then
        print_service_row "tts" "9800" "tts_svc"
    else
        printf "%-12s %-6s %-8s " "tts_svc" "9800" "-"
        echo -e "${CYAN}CLOUD${RESET}  (云端 API 模式)"
    fi

    hr
    echo ""
}

# =============================================================================
# 子命令：stop
# =============================================================================
cmd_stop() {
    try_load_paths_env || true
    load_config

    hr
    info "停止所有服务..."
    hr

    # 按依赖倒序停：先 webapp，再 asr，再 tts
    kill_service "webapp" 9880

    if [[ "${ENABLE_LOCAL_ASR:-false}" == "true" ]]; then
        kill_service "asr" 9900
    fi

    if [[ "${ENABLE_LOCAL_TTS:-false}" == "true" ]]; then
        kill_service "tts" 9800
    fi

    success "所有服务已停止"
    hr
}

# =============================================================================
# 子命令：restart
# =============================================================================
cmd_restart() {
    cmd_stop
    echo ""
    cmd_start
}

# =============================================================================
# 子命令：logs
# =============================================================================
cmd_logs() {
    local target="${1:-webapp}"

    case "$target" in
        webapp|web)
            local f
            f="$(log_file webapp)"
            if [[ -f "$f" ]]; then
                bold "=== webapp 日志 ($f) ==="
                tail -f "$f"
            else
                warn "日志文件不存在: ${f}（服务尚未启动？）"
            fi
            ;;
        asr)
            local f
            f="$(log_file asr)"
            if [[ -f "$f" ]]; then
                bold "=== asr_service 日志 ($f) ==="
                tail -f "$f"
            else
                warn "日志文件不存在: ${f}（服务尚未启动？）"
            fi
            ;;
        tts)
            local f
            f="$(log_file tts)"
            if [[ -f "$f" ]]; then
                bold "=== tts_service 日志 ($f) ==="
                tail -f "$f"
            else
                warn "日志文件不存在: ${f}（服务尚未启动？）"
            fi
            ;;
        all)
            # 用 tail -f 同时跟踪多个（若存在）
            local files=()
            [[ -f "$(log_file webapp)" ]] && files+=("$(log_file webapp)")
            [[ -f "$(log_file asr)" ]]    && files+=("$(log_file asr)")
            [[ -f "$(log_file tts)" ]]    && files+=("$(log_file tts)")
            if [[ ${#files[@]} -eq 0 ]]; then
                warn "没有找到任何日志文件（服务尚未启动？）"
            else
                tail -f "${files[@]}"
            fi
            ;;
        *)
            error "未知目标: $target"
            echo "  可用: webapp | asr | tts | all"
            exit 1
            ;;
    esac
}

# =============================================================================
# --help
# =============================================================================
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    bold "EmotionTTS 一键启动脚本"
    echo ""
    echo "用法:"
    echo "  bash start.sh                    启动所有需要的服务"
    echo "  bash start.sh status             查看各服务状态"
    echo "  bash start.sh stop               停止所有服务"
    echo "  bash start.sh restart            重启所有服务"
    echo "  bash start.sh logs [webapp|asr|tts|all]  查看日志（默认 webapp）"
    echo ""
    echo "服务端口:"
    echo "  webapp     9880   Web 中枢（始终启动）"
    echo "  asr_svc    9900   本地 Whisper ASR（按配置启动）"
    echo "  tts_svc    9800   本地 IndexTTS2（按配置启动）"
    echo ""
    echo "前置条件: 先运行 bash install.sh"
    exit 0
fi

# =============================================================================
# 入口路由
# =============================================================================
SUBCOMMAND="${1:-start}"

case "$SUBCOMMAND" in
    start)   cmd_start ;;
    status)  cmd_status ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    logs)    cmd_logs "${2:-webapp}" ;;
    *)
        error "未知子命令: $SUBCOMMAND"
        echo "  可用子命令: start | status | stop | restart | logs"
        echo "  运行 bash start.sh --help 查看完整用法"
        exit 1
        ;;
esac
