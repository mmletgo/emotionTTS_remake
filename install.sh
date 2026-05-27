#!/usr/bin/env bash
# =============================================================================
# EmotionTTS 一键部署脚本
# 用法: bash install.sh [--help]
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

# ─────────────────────────────── 辅助函数 ────────────────────────────────────
info()    { echo -e "${BLUE}▶ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}" >&2; }
bold()    { echo -e "${BOLD}$*${RESET}"; }
hr()      { echo -e "${CYAN}──────────────────────────────────────────────────${RESET}"; }

# 脚本所在目录（仓库根）
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────── --help ───────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    bold "EmotionTTS 一键部署脚本"
    echo ""
    echo "用法:"
    echo "  bash install.sh           交互式部署（推荐）"
    echo "  bash install.sh --help    显示此帮助信息"
    echo ""
    echo "脚本会引导你完成以下步骤："
    echo "  1. 检测系统环境（OS / python3 / ffmpeg / git / curl），缺失时自动安装"
    echo "     · macOS：通过 Homebrew 安装（无 brew 时先装 brew）"
    echo "     · Linux：自动选择 apt / dnf / yum / pacman / zypper"
    echo "  2. 选择 TTS 部署方式（本地 IndexTTS2 或云端 API）"
    echo "  3. 选择 ASR 部署方式（本地 Whisper 或云端 API）"
    echo "  4. 准备 Python 环境"
    echo "  5. 下载所需模型文件"
    echo "  6. 写入默认配置 webapp/config/config.json"
    echo "  7. 写入运行时元数据 .runtime/paths.env"
    echo ""
    echo "部署完成后，运行: bash start.sh"
    exit 0
fi

# ─────────────────────────────── 系统依赖自动安装辅助 ────────────────────────
# 用法约定：
#   - detect_pkg_manager     根据 OS_TYPE 探测出当前可用的包管理器名（brew/apt/...）
#   - install_homebrew       macOS 上没装 brew 时调用，装完后把 brew 放进当前 PATH
#   - map_pkg <mgr> <tool>   把通用工具名（python3/ffmpeg/git/curl）翻译成实际包名
#   - auto_install_pkgs      接收一组缺失工具，统一调用包管理器一次性安装

detect_pkg_manager() {
    if [[ "${OS_TYPE:-}" == "macos" ]]; then
        if command -v brew &>/dev/null; then echo "brew"; else echo "none"; fi
    elif [[ "${OS_TYPE:-}" == "linux" ]]; then
        if   command -v apt-get &>/dev/null; then echo "apt"
        elif command -v dnf     &>/dev/null; then echo "dnf"
        elif command -v yum     &>/dev/null; then echo "yum"
        elif command -v pacman  &>/dev/null; then echo "pacman"
        elif command -v zypper  &>/dev/null; then echo "zypper"
        else echo "none"
        fi
    else
        echo "none"
    fi
}

install_homebrew() {
    info "未检测到 Homebrew，将自动安装（过程中可能要求输入 sudo 密码）..."
    if ! /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
        error "Homebrew 安装失败"
        return 1
    fi
    # 加载 brew 到当前 PATH（Apple Silicon 在 /opt/homebrew，Intel 在 /usr/local）
    if   [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew  ]]; then eval "$(/usr/local/bin/brew shellenv)"
    fi
    command -v brew &>/dev/null
}

# 把通用工具名映射为当前包管理器下的实际包名（一行可能含空格分隔的多个包名）
map_pkg() {
    local mgr="$1" tool="$2"
    case "$mgr:$tool" in
        brew:python3)         echo "python@3.11" ;;
        brew:*)               echo "$tool" ;;
        apt:python3)          echo "python3 python3-venv python3-pip" ;;
        apt:*)                echo "$tool" ;;
        dnf:python3)          echo "python3 python3-pip" ;;
        dnf:*)                echo "$tool" ;;
        yum:python3)          echo "python3 python3-pip" ;;
        yum:*)                echo "$tool" ;;
        pacman:python3)       echo "python python-pip" ;;
        pacman:*)             echo "$tool" ;;
        zypper:python3)       echo "python311 python311-pip" ;;
        zypper:*)             echo "$tool" ;;
        *)                    echo "$tool" ;;
    esac
}

# 用包管理器一次性安装一组工具；失败返回非零
auto_install_pkgs() {
    local mgr="$1"; shift
    local tools=("$@")
    local pkg_list=()
    local tool parts
    for tool in "${tools[@]}"; do
        # shellcheck disable=SC2206
        parts=( $(map_pkg "$mgr" "$tool") )
        pkg_list+=("${parts[@]}")
    done
    [[ ${#pkg_list[@]} -eq 0 ]] && return 0

    info "用 $mgr 安装: ${pkg_list[*]}"
    case "$mgr" in
        brew)
            brew install "${pkg_list[@]}"
            ;;
        apt)
            sudo apt-get update
            sudo apt-get install -y "${pkg_list[@]}"
            ;;
        dnf)    sudo dnf    install -y "${pkg_list[@]}" ;;
        yum)    sudo yum    install -y "${pkg_list[@]}" ;;
        pacman) sudo pacman -S --noconfirm --needed "${pkg_list[@]}" ;;
        zypper) sudo zypper install -y "${pkg_list[@]}" ;;
        *)
            error "不支持的包管理器: $mgr"
            return 1
            ;;
    esac
}

# ─────────────────────────────── 欢迎界面 ────────────────────────────────────
hr
bold "       EmotionTTS 一键部署向导"
hr
echo ""

# =============================================================================
# A1. 环境检测
# =============================================================================
info "检测系统环境..."

# 检测 OS
OS_TYPE=""
case "$(uname -s)" in
    Darwin) OS_TYPE="macos" ;;
    Linux)  OS_TYPE="linux" ;;
    *)
        error "不支持的操作系统: $(uname -s)（仅支持 macOS / Linux）"
        exit 1
        ;;
esac
success "操作系统: $OS_TYPE"

# 检测必备工具（单次复用：自动安装后会再调一次）
MISSING_TOOLS=()
detect_tools() {
    MISSING_TOOLS=()

    # python3 >= 3.10
    if command -v python3 &>/dev/null; then
        local py_ver py_major py_minor
        py_ver=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        py_major=$(echo "$py_ver" | cut -d. -f1)
        py_minor=$(echo "$py_ver" | cut -d. -f2)
        if [[ "$py_major" -lt 3 || ("$py_major" -eq 3 && "$py_minor" -lt 10) ]]; then
            warn "python3 版本过低: ${py_ver}（需要 >= 3.10）"
            MISSING_TOOLS+=("python3")
        else
            success "python3: $py_ver"
        fi
    else
        warn "未找到 python3"
        MISSING_TOOLS+=("python3")
    fi

    # ffmpeg
    if command -v ffmpeg &>/dev/null; then
        success "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
    else
        warn "未找到 ffmpeg（音频处理必须）"
        MISSING_TOOLS+=("ffmpeg")
    fi

    # git
    if command -v git &>/dev/null; then
        success "git: $(git --version | awk '{print $3}')"
    else
        warn "未找到 git"
        MISSING_TOOLS+=("git")
    fi

    # curl
    if command -v curl &>/dev/null; then
        success "curl: 已安装"
    else
        warn "未找到 curl"
        MISSING_TOOLS+=("curl")
    fi
}

detect_tools

# uv（可选，推荐；不进入自动安装流程，缺失时只回落到 venv）
HAS_UV=false
if command -v uv &>/dev/null; then
    success "uv: $(uv --version)"
    HAS_UV=true
else
    warn "未找到 uv（推荐但非必需，将回落到 python3 -m venv）"
fi

# ─── 自动安装缺失依赖 ─────────────────────────────────────────────────────────
if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
    echo ""
    warn "检测到缺失依赖: ${MISSING_TOOLS[*]}"

    PKG_MGR="$(detect_pkg_manager)"

    # macOS 无 brew 时先装 brew
    if [[ "$OS_TYPE" == "macos" && "$PKG_MGR" == "none" ]]; then
        echo ""
        read -r -p "  macOS 上没有 Homebrew，是否自动安装 Homebrew？[Y/n，默认 Y]: " INSTALL_BREW
        INSTALL_BREW="${INSTALL_BREW:-Y}"
        if [[ "$INSTALL_BREW" =~ ^[Yy]$ ]]; then
            if install_homebrew; then
                PKG_MGR="brew"
                success "Homebrew 已就绪"
            else
                error "Homebrew 安装失败"
                exit 1
            fi
        else
            warn "跳过 Homebrew 安装，无法自动安装系统依赖"
        fi
    fi

    if [[ "$PKG_MGR" == "none" ]]; then
        error "未检测到可用的包管理器（macOS 需要 brew；Linux 需要 apt/dnf/yum/pacman/zypper 之一）"
        bold "请手动安装以下依赖后重试: ${MISSING_TOOLS[*]}"
        exit 1
    fi

    echo ""
    read -r -p "  使用 ${PKG_MGR} 自动安装这些依赖？[Y/n，默认 Y]: " AUTO_INSTALL
    AUTO_INSTALL="${AUTO_INSTALL:-Y}"
    if [[ "$AUTO_INSTALL" =~ ^[Yy]$ ]]; then
        if auto_install_pkgs "$PKG_MGR" "${MISSING_TOOLS[@]}"; then
            success "依赖安装完成，重新检测..."
            echo ""
            detect_tools
            if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
                error "以下依赖在自动安装后仍不可用: ${MISSING_TOOLS[*]}"
                echo "  请手动检查上面的安装日志后重试。"
                exit 1
            fi
            success "所有系统依赖均已就绪"
        else
            error "自动安装失败，请查看上面的输出排查原因"
            exit 1
        fi
    else
        warn "已跳过自动安装"
        # 用户拒绝自动安装：只有「仅 ffmpeg 缺失」时允许继续（运行时才会出错）
        if [[ ${#MISSING_TOOLS[@]} -eq 1 && "${MISSING_TOOLS[0]}" == "ffmpeg" ]]; then
            warn "ffmpeg 缺失不阻止安装，但运行时音频处理会报错"
        else
            error "缺少关键依赖，无法继续: ${MISSING_TOOLS[*]}"
            exit 1
        fi
    fi
fi

echo ""

# =============================================================================
# A2. 交互式询问
# =============================================================================
hr
bold "部署配置"
hr
echo ""

# ── 问题 1：TTS 部署方式 ──────────────────────────────────────────────────────
echo -e "${BOLD}1) TTS（语音合成）部署方式？${RESET}"
echo "   a) 本地 IndexTTS2（需 GPU 或耐心等 CPU 推理，需下载几 GB 模型）"
echo "   b) 云端 OpenAI 兼容 TTS API（无本地依赖，最快启动）"
echo ""
read -r -p "   请选择 [a/b，默认 b]: " TTS_CHOICE
TTS_CHOICE="${TTS_CHOICE:-b}"
TTS_CHOICE="$(echo "$TTS_CHOICE" | tr '[:upper:]' '[:lower:]')"

if [[ "$TTS_CHOICE" == "a" ]]; then
    ENABLE_LOCAL_TTS=true
    echo ""
    echo -e "${BOLD}2) IndexTTS 环境处理？${RESET}"
    echo "   a) 我已经按官方 README 装好了，输入 .venv 路径（跳过下载）"
    echo "   b) 让脚本帮我全自动部署（clone + uv sync + 下载几 GB checkpoint）"
    echo "   c) 暂不安装，脚本只写配置 —— 之后我自己按文档手动装"
    echo ""
    read -r -p "   请选择 [a/b/c，默认 a]: " INDEXTTS_ENV_CHOICE
    INDEXTTS_ENV_CHOICE="${INDEXTTS_ENV_CHOICE:-a}"
    INDEXTTS_ENV_CHOICE="$(echo "$INDEXTTS_ENV_CHOICE" | tr '[:upper:]' '[:lower:]')"
else
    ENABLE_LOCAL_TTS=false
    INDEXTTS_ENV_CHOICE="skip"
fi

echo ""

# ── 问题 3：ASR 部署方式 ──────────────────────────────────────────────────────
if [[ "${ENABLE_LOCAL_TTS:-false}" == "true" ]]; then
    ASR_QNUM=3
else
    ASR_QNUM=2
fi
echo -e "${BOLD}${ASR_QNUM}) ASR（语音识别）部署方式？${RESET}"
echo "   a) 本地 Whisper（自动下载 ~466MB 模型到 models/whisper-small/）"
echo "   b) 本地 Whisper（暂不下载，我之后自己放进 models/whisper-small/）"
echo "   c) 云端 OpenAI 兼容 ASR API（如 OpenAI / Groq）"
echo ""
read -r -p "   请选择 [a/b/c，默认 a]: " ASR_CHOICE
ASR_CHOICE="${ASR_CHOICE:-a}"
ASR_CHOICE="$(echo "$ASR_CHOICE" | tr '[:upper:]' '[:lower:]')"

if [[ "$ASR_CHOICE" == "a" ]]; then
    ENABLE_LOCAL_ASR=true
    DOWNLOAD_ASR_MODEL=true
elif [[ "$ASR_CHOICE" == "b" ]]; then
    ENABLE_LOCAL_ASR=true
    DOWNLOAD_ASR_MODEL=false
else
    ENABLE_LOCAL_ASR=false
    DOWNLOAD_ASR_MODEL=false
fi

echo ""

# ── 问题 4：仅 TTS=cloud 时询问 Python 环境策略 ───────────────────────────────
PYTHON_ENV_CHOICE="new"
if [[ "$ENABLE_LOCAL_TTS" == "false" ]]; then
    Q_NUM=3
    echo -e "${BOLD}${Q_NUM}) Python 环境策略？${RESET}"
    echo "   a) 在项目目录创建新的 .venv（推荐）"
    echo "   b) 复用我指定的现有 venv 路径"
    echo ""
    read -r -p "   请选择 [a/b，默认 a]: " PYTHON_ENV_CHOICE_INPUT
    PYTHON_ENV_CHOICE_INPUT="${PYTHON_ENV_CHOICE_INPUT:-a}"
    PYTHON_ENV_CHOICE_INPUT="$(echo "$PYTHON_ENV_CHOICE_INPUT" | tr '[:upper:]' '[:lower:]')"
    if [[ "$PYTHON_ENV_CHOICE_INPUT" == "b" ]]; then
        PYTHON_ENV_CHOICE="existing"
    fi
fi

echo ""

# =============================================================================
# 汇总用户选择
# =============================================================================
hr
bold "配置汇总"
hr
echo "  TTS 方式     : $( [[ "$ENABLE_LOCAL_TTS" == "true" ]] && echo "本地 IndexTTS2" || echo "云端 API")"
echo "  ASR 方式     : $( [[ "$ENABLE_LOCAL_ASR" == "true" ]] && echo "本地 Whisper" || echo "云端 API")"
if [[ "$ENABLE_LOCAL_TTS" == "true" ]]; then
    case "$INDEXTTS_ENV_CHOICE" in
        a) echo "  IndexTTS 安装: 使用已有 venv（跳过下载）" ;;
        b) echo "  IndexTTS 安装: 全自动部署（clone + uv sync + 下 checkpoint）" ;;
        c) echo "  IndexTTS 安装: 暂不安装（只写配置，之后手动）" ;;
    esac
fi
if [[ "$ENABLE_LOCAL_ASR" == "true" ]]; then
    if [[ "$DOWNLOAD_ASR_MODEL" == "true" ]]; then
        echo "  Whisper 模型 : 自动下载（~466MB）"
    else
        echo "  Whisper 模型 : 暂不下载（只写配置，之后手动放到 models/whisper-small/）"
    fi
fi
echo ""
read -r -p "确认以上配置继续？[Y/n，默认 Y]: " CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    warn "已取消。重新运行 bash install.sh 重新配置。"
    exit 0
fi

echo ""

# =============================================================================
# A3. Python 环境准备
# =============================================================================
hr
info "准备 Python 环境..."
hr

PYTHON_BIN=""
INDEXTTS_MODEL_DIR=""

# ── 情况 A：TTS=local + 复用已有 env ─────────────────────────────────────────
if [[ "$ENABLE_LOCAL_TTS" == "true" && "$INDEXTTS_ENV_CHOICE" == "a" ]]; then
    echo ""
    read -r -p "  请输入 IndexTTS .venv 根目录路径（如 ~/repos/index-tts/.venv）: " EXISTING_VENV_INPUT
    EXISTING_VENV="${EXISTING_VENV_INPUT/#\~/$HOME}"
    EXISTING_VENV="${EXISTING_VENV%/}"

    if [[ ! -d "$EXISTING_VENV" ]]; then
        error "路径不存在: $EXISTING_VENV"
        exit 1
    fi

    PYTHON_BIN="$EXISTING_VENV/bin/python"
    if [[ ! -f "$PYTHON_BIN" ]]; then
        error "未在 $EXISTING_VENV/bin/ 找到 python"
        exit 1
    fi

    # 校验关键包
    info "校验 venv 中的关键依赖..."
    MISSING_PKGS=()
    for pkg in fastapi uvicorn httpx pydub indextts; do
        if ! "$PYTHON_BIN" -c "import $pkg" &>/dev/null; then
            MISSING_PKGS+=("$pkg")
        fi
    done
    if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
        warn "venv 中缺少以下包: ${MISSING_PKGS[*]}"
        warn "请在该 venv 中手动安装后重新运行本脚本"
        exit 1
    fi
    success "venv 校验通过: $PYTHON_BIN"

    # 自动探测 IndexTTS checkpoints —— 优先级:
    #   1) HuggingFace cache (huggingface-cli download 默认位置，含 snapshots/<hash> 结构)
    #   2) <venv_parent>/checkpoints (IndexTTS 仓库内常见位置)
    VENV_PARENT="$(dirname "$EXISTING_VENV")"
    DEFAULT_CKPT="$VENV_PARENT/checkpoints"
    HF_HUB_DIR="${HF_HOME:-$HOME/.cache/huggingface}/hub"
    HF_SNAPSHOT="$(ls -td "$HF_HUB_DIR"/models--IndexTeam--IndexTTS-2/snapshots/*/ 2>/dev/null | head -1)"
    if [[ -n "$HF_SNAPSHOT" && -f "${HF_SNAPSHOT}gpt.pth" ]]; then
        DEFAULT_CKPT="${HF_SNAPSHOT%/}"
        info "检测到 HuggingFace cache 中的 IndexTTS-2 模型: $DEFAULT_CKPT"
    fi
    read -r -p "  IndexTTS checkpoints 目录（默认 ${DEFAULT_CKPT}）: " CKPT_INPUT
    INDEXTTS_MODEL_DIR="${CKPT_INPUT:-$DEFAULT_CKPT}"
    INDEXTTS_MODEL_DIR="${INDEXTTS_MODEL_DIR/#\~/$HOME}"
    if [[ ! -d "$INDEXTTS_MODEL_DIR" ]]; then
        warn "checkpoints 目录不存在: $INDEXTTS_MODEL_DIR"
        warn "请确保模型文件已下载；启动 tts_service 时会用到此路径"
    else
        success "checkpoints 目录: $INDEXTTS_MODEL_DIR"
    fi

# ── 情况 B：TTS=local + 全自动部署 ───────────────────────────────────────────
elif [[ "$ENABLE_LOCAL_TTS" == "true" && "$INDEXTTS_ENV_CHOICE" == "b" ]]; then
    echo ""
    DEFAULT_CLONE_DIR="$HOME/repos/index-tts"
    read -r -p "  IndexTTS 仓库安装位置（默认 ${DEFAULT_CLONE_DIR}）: " CLONE_DIR_INPUT
    CLONE_DIR="${CLONE_DIR_INPUT:-$DEFAULT_CLONE_DIR}"
    CLONE_DIR="${CLONE_DIR/#\~/$HOME}"

    # Git clone IndexTTS
    if [[ -d "$CLONE_DIR/.git" ]]; then
        warn "目录已存在: ${CLONE_DIR}，跳过 clone（执行 git pull）"
        info "更新 IndexTTS 仓库..."
        git -C "$CLONE_DIR" pull --ff-only || warn "git pull 失败，继续使用现有代码"
    else
        info "克隆 IndexTTS 仓库到 $CLONE_DIR ..."
        mkdir -p "$(dirname "$CLONE_DIR")"
        if ! git clone https://github.com/index-tts/index-tts.git "$CLONE_DIR"; then
            error "git clone 失败！"
            echo "  可能原因: 网络不通 / GitHub 访问受限"
            echo "  建议: 手动 clone 后选择「使用已有 venv」模式"
            exit 1
        fi
        success "克隆完成: $CLONE_DIR"
    fi

    # 安装 uv（若未安装）
    if ! command -v uv &>/dev/null; then
        info "安装 uv 包管理器..."
        if ! curl -LsSf https://astral.sh/uv/install.sh | sh; then
            error "uv 安装失败，尝试 pip 安装..."
            python3 -m pip install -U uv || { error "pip 安装 uv 也失败"; exit 1; }
        fi
        # 尝试加载 uv 到当前 PATH
        export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
        if ! command -v uv &>/dev/null; then
            warn "uv 已安装但未在 PATH，尝试使用 python3 -m uv"
            UV_CMD="python3 -m uv"
        else
            UV_CMD="uv"
        fi
        success "uv 安装完成"
    else
        UV_CMD="uv"
    fi

    # uv sync 安装 Python 依赖
    info "安装 IndexTTS 依赖（uv sync --all-extras）..."
    (
        cd "$CLONE_DIR"
        if ! $UV_CMD sync --all-extras; then
            warn "uv sync 失败，尝试使用国内镜像..."
            $UV_CMD sync --all-extras --default-index "https://mirrors.aliyun.com/pypi/simple" || {
                error "依赖安装失败！"
                echo "  建议: 检查网络连接，或参考 IndexTTS README 手动安装"
                exit 1
            }
        fi
    )
    success "IndexTTS 依赖安装完成"

    PYTHON_BIN="$CLONE_DIR/.venv/bin/python"
    if [[ ! -f "$PYTHON_BIN" ]]; then
        error "未找到 ${PYTHON_BIN}，uv sync 可能未创建 venv"
        exit 1
    fi

    # 下载 IndexTTS checkpoints
    INDEXTTS_MODEL_DIR="$CLONE_DIR/checkpoints"
    if [[ -d "$INDEXTTS_MODEL_DIR" && -n "$(ls -A "$INDEXTTS_MODEL_DIR" 2>/dev/null)" ]]; then
        warn "checkpoints 目录已存在且非空，跳过下载"
    else
        info "下载 IndexTTS2 checkpoints（IndexTeam/IndexTTS-2）..."
        warn "注意：模型文件较大（数 GB），下载可能耗时较长"
        mkdir -p "$INDEXTTS_MODEL_DIR"

        # 优先用 huggingface-cli / hf 工具
        HF_DOWNLOAD_SUCCESS=false
        if command -v huggingface-cli &>/dev/null; then
            if huggingface-cli download IndexTeam/IndexTTS-2 --local-dir="$INDEXTTS_MODEL_DIR"; then
                HF_DOWNLOAD_SUCCESS=true
            fi
        fi

        # 备选：用 uv tool 安装 huggingface-hub 后下载
        if [[ "$HF_DOWNLOAD_SUCCESS" == "false" ]]; then
            info "尝试通过 uv tool 安装 huggingface-hub 并下载..."
            (
                cd "$CLONE_DIR"
                $UV_CMD tool install "huggingface-hub[cli,hf_xet]" &>/dev/null || true
                # 尝试镜像加速
                export HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
                if ! "$CLONE_DIR/.venv/bin/python" -c "
from huggingface_hub import snapshot_download
snapshot_download('IndexTeam/IndexTTS-2', local_dir='$INDEXTTS_MODEL_DIR')
print('download ok')
"; then
                    warn "HuggingFace 下载失败，尝试国内镜像 hf-mirror.com ..."
                    HF_ENDPOINT=https://hf-mirror.com "$CLONE_DIR/.venv/bin/python" -c "
from huggingface_hub import snapshot_download
import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
snapshot_download('IndexTeam/IndexTTS-2', local_dir='$INDEXTTS_MODEL_DIR')
print('download ok via mirror')
" || {
                        error "checkpoint 下载失败！"
                        echo "  手动下载方式:"
                        echo "  1. HuggingFace: https://huggingface.co/IndexTeam/IndexTTS-2"
                        echo "  2. 镜像站: HF_ENDPOINT=https://hf-mirror.com huggingface-cli download IndexTeam/IndexTTS-2 --local-dir=$INDEXTTS_MODEL_DIR"
                        echo "  下载完成后重新运行: bash install.sh"
                        exit 1
                    }
                fi
            )
            HF_DOWNLOAD_SUCCESS=true
        fi

        success "checkpoints 下载完成: $INDEXTTS_MODEL_DIR"
    fi

# ── 情况 B2：TTS=local 但选「暂不安装」(c) ──────────────────────────────────
elif [[ "$ENABLE_LOCAL_TTS" == "true" && "$INDEXTTS_ENV_CHOICE" == "c" ]]; then
    warn "选择「暂不安装本地 TTS」—— 跳过 IndexTTS 部署"
    echo "  注意：脚本只写配置，之后请你按 IndexTTS 官方文档手动装："
    echo "    https://github.com/index-tts/index-tts"
    echo "  装好后可重新跑 bash install.sh 选择 a（复用已有 venv）补完配置。"
    echo ""
    # 为 webapp / asr_service 建一个项目本地的轻量 .venv
    VENV_DIR="$REPO_ROOT/.venv"
    if [[ -d "$VENV_DIR" ]]; then
        warn ".venv 已存在，跳过创建"
    else
        info "为 webapp / asr_service 创建项目 .venv（IndexTTS 之后自己装）"
        if [[ "$HAS_UV" == "true" ]]; then
            uv venv "$VENV_DIR" --python 3.10 2>/dev/null || \
            uv venv "$VENV_DIR" 2>/dev/null || \
            python3 -m venv "$VENV_DIR"
        else
            python3 -m venv "$VENV_DIR"
        fi
    fi
    PYTHON_BIN="$VENV_DIR/bin/python"
    [[ -x "$PYTHON_BIN" ]] || { error "venv 创建失败: $PYTHON_BIN"; exit 1; }
    success "项目 .venv 就绪: $PYTHON_BIN"

    # 标记 INDEXTTS_MODEL_DIR 为空（占位，待用户手动设置）
    INDEXTTS_MODEL_DIR=""
    # 防御性：start.sh 启动 tts_service 时会探测此变量，空则跳过

# ── 情况 C：TTS=cloud + 新建 .venv ───────────────────────────────────────────
elif [[ "$ENABLE_LOCAL_TTS" == "false" && "$PYTHON_ENV_CHOICE" == "new" ]]; then
    VENV_DIR="$REPO_ROOT/.venv"

    if [[ -d "$VENV_DIR" ]]; then
        warn ".venv 已存在，跳过创建（直接安装/更新依赖）"
    else
        info "创建 Python venv: $VENV_DIR"
        if [[ "$HAS_UV" == "true" ]]; then
            uv venv "$VENV_DIR" --python 3.10 2>/dev/null || \
            uv venv "$VENV_DIR" 2>/dev/null || \
            python3 -m venv "$VENV_DIR"
        else
            python3 -m venv "$VENV_DIR"
        fi
        success "venv 创建完成: $VENV_DIR"
    fi

    PYTHON_BIN="$VENV_DIR/bin/python"
    info "安装基础依赖..."
    if [[ "$HAS_UV" == "true" ]]; then
        uv pip install --python "$PYTHON_BIN" \
            fastapi uvicorn python-multipart httpx "pydub" || \
        "$PYTHON_BIN" -m pip install \
            fastapi uvicorn python-multipart httpx pydub
    else
        "$PYTHON_BIN" -m pip install --upgrade pip
        "$PYTHON_BIN" -m pip install \
            fastapi uvicorn python-multipart httpx pydub
    fi
    success "基础依赖安装完成"

# ── 情况 D：TTS=cloud + 复用已有 venv ────────────────────────────────────────
elif [[ "$ENABLE_LOCAL_TTS" == "false" && "$PYTHON_ENV_CHOICE" == "existing" ]]; then
    read -r -p "  请输入现有 venv 根目录路径: " EXISTING_VENV_INPUT
    EXISTING_VENV="${EXISTING_VENV_INPUT/#\~/$HOME}"
    EXISTING_VENV="${EXISTING_VENV%/}"

    PYTHON_BIN="$EXISTING_VENV/bin/python"
    if [[ ! -f "$PYTHON_BIN" ]]; then
        error "未在 $EXISTING_VENV/bin/ 找到 python"
        exit 1
    fi
    success "使用现有 venv: $PYTHON_BIN"
fi

# =============================================================================
# A4. 额外依赖：ASR=local 需要 faster-whisper
# =============================================================================
if [[ "$ENABLE_LOCAL_ASR" == "true" ]]; then
    info "安装 faster-whisper（本地 ASR 依赖）..."
    if [[ "$HAS_UV" == "true" ]]; then
        uv pip install --python "$PYTHON_BIN" faster-whisper 2>/dev/null || \
        "$PYTHON_BIN" -m pip install faster-whisper
    else
        "$PYTHON_BIN" -m pip install faster-whisper
    fi
    # 验证安装
    if "$PYTHON_BIN" -c "import faster_whisper" &>/dev/null; then
        success "faster-whisper 安装成功"
    else
        warn "faster-whisper 安装后验证失败，请手动检查"
    fi
fi

echo ""

# =============================================================================
# A5. 模型下载
# =============================================================================
hr
info "检查/下载模型文件..."
hr

# ASR=local: 下载 Whisper 模型（仅当用户选了「自动下载」）
if [[ "$ENABLE_LOCAL_ASR" == "true" && "${DOWNLOAD_ASR_MODEL:-false}" != "true" ]]; then
    WHISPER_DIR="$REPO_ROOT/models/whisper-small"
    mkdir -p "$WHISPER_DIR"
    warn "选择「暂不下载 Whisper 模型」—— 跳过下载"
    echo "  之后请把模型文件放到: $WHISPER_DIR/"
    echo "  下载方式（任一）:"
    echo "    huggingface-cli download Systran/faster-whisper-small --local-dir=$WHISPER_DIR"
    echo "    或: git clone https://huggingface.co/Systran/faster-whisper-small $WHISPER_DIR"
    echo "    国内镜像: HF_ENDPOINT=https://hf-mirror.com 前缀任一上面命令"
elif [[ "$ENABLE_LOCAL_ASR" == "true" ]]; then
    WHISPER_DIR="$REPO_ROOT/models/whisper-small"
    mkdir -p "$WHISPER_DIR"

    # 判断模型是否已存在（检查 model.bin）
    if [[ -f "$WHISPER_DIR/model.bin" ]]; then
        success "Whisper 模型已存在，跳过下载: $WHISPER_DIR"
    else
        info "下载 Whisper 模型（Systran/faster-whisper-small，~466MB）..."
        warn "网络环境不佳时可能较慢，请耐心等待"

        DOWNLOAD_SUCCESS=false

        # 方式 1：huggingface-cli
        if command -v huggingface-cli &>/dev/null; then
            info "使用 huggingface-cli 下载..."
            if huggingface-cli download Systran/faster-whisper-small \
                    --local-dir="$WHISPER_DIR" \
                    model.bin config.json tokenizer.json vocabulary.txt \
                    tokenizer_config.json preprocessor_config.json; then
                DOWNLOAD_SUCCESS=true
            fi
        fi

        # 方式 2：Python huggingface_hub
        if [[ "$DOWNLOAD_SUCCESS" == "false" ]]; then
            info "使用 huggingface_hub Python API 下载..."
            # 先确保 huggingface-hub 已装
            "$PYTHON_BIN" -m pip install huggingface-hub -q 2>/dev/null || true
            if "$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Systran/faster-whisper-small',
    local_dir='$WHISPER_DIR',
    ignore_patterns=['*.msgpack', '*.h5', 'flax_model*', 'tf_model*']
)
print('ok')
" 2>&1 | tail -5; then
                DOWNLOAD_SUCCESS=true
            fi
        fi

        # 方式 3：git clone（镜像）
        if [[ "$DOWNLOAD_SUCCESS" == "false" ]]; then
            info "尝试 git clone 镜像站..."
            MIRROR_URL="https://hf-mirror.com/Systran/faster-whisper-small"
            if git clone --depth=1 "$MIRROR_URL" "$WHISPER_DIR" 2>/dev/null || \
               git clone --depth=1 "https://huggingface.co/Systran/faster-whisper-small" "$WHISPER_DIR"; then
                DOWNLOAD_SUCCESS=true
            fi
        fi

        if [[ "$DOWNLOAD_SUCCESS" == "false" ]]; then
            error "Whisper 模型下载失败！"
            echo ""
            echo "手动下载方式:"
            echo "  git clone --depth=1 https://huggingface.co/Systran/faster-whisper-small \\"
            echo "      $WHISPER_DIR"
            echo ""
            echo "或使用国内镜像:"
            echo "  git clone --depth=1 https://hf-mirror.com/Systran/faster-whisper-small \\"
            echo "      $WHISPER_DIR"
            exit 1
        fi

        success "Whisper 模型下载完成: $WHISPER_DIR"
    fi
fi

echo ""

# =============================================================================
# A6. 写默认配置 config.json
# =============================================================================
hr
info "准备配置文件..."
hr

CONFIG_DIR="$REPO_ROOT/webapp/config"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"

# 构建 tts / asr 配置节
if [[ "$ENABLE_LOCAL_TTS" == "true" ]]; then
    TTS_JSON='"tts": {"type": "local", "api_base": "http://127.0.0.1:9800/v1", "api_key": "", "model": "indextts"}'
else
    echo ""
    echo "  云端 TTS 配置（稍后也可在设置页修改）:"
    read -r -p "  TTS API Base URL（如 https://api.openai.com/v1）: " TTS_API_BASE
    read -r -p "  TTS API Key: " TTS_API_KEY
    read -r -p "  TTS 模型名（如 tts-1）: " TTS_MODEL
    TTS_API_BASE="${TTS_API_BASE:-https://api.openai.com/v1}"
    TTS_MODEL="${TTS_MODEL:-tts-1}"
    TTS_JSON="\"tts\": {\"type\": \"cloud\", \"api_base\": \"$TTS_API_BASE\", \"api_key\": \"$TTS_API_KEY\", \"model\": \"$TTS_MODEL\"}"
fi

if [[ "$ENABLE_LOCAL_ASR" == "true" ]]; then
    ASR_JSON='"asr": {"type": "local", "api_base": "http://127.0.0.1:9900/v1", "api_key": "", "model": "whisper-small", "language": "zh"}'
else
    echo ""
    echo "  云端 ASR 配置（稍后也可在设置页修改）:"
    read -r -p "  ASR API Base URL（如 https://api.openai.com/v1）: " ASR_API_BASE
    read -r -p "  ASR API Key: " ASR_API_KEY
    read -r -p "  ASR 模型名（如 whisper-1）: " ASR_MODEL
    ASR_API_BASE="${ASR_API_BASE:-https://api.openai.com/v1}"
    ASR_MODEL="${ASR_MODEL:-whisper-1}"
    ASR_JSON="\"asr\": {\"type\": \"cloud\", \"api_base\": \"$ASR_API_BASE\", \"api_key\": \"$ASR_API_KEY\", \"model\": \"$ASR_MODEL\", \"language\": \"zh\"}"
fi

# 生成 config.json
write_config() {
    cat > "$CONFIG_FILE" <<CONFIGEOF
{
  "llm": {
    "active_type": "ollama",
    "configs": {
      "ollama": {
        "api_base": "http://127.0.0.1:11434/v1",
        "api_key": "ollama",
        "model": "qwen2.5:7b"
      },
      "openai": {
        "api_base": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-4o-mini"
      },
      "custom": {
        "api_base": "",
        "api_key": "",
        "model": ""
      }
    }
  },
  $TTS_JSON,
  $ASR_JSON
}
CONFIGEOF
}

if [[ -f "$CONFIG_FILE" ]]; then
    warn "config.json 已存在: $CONFIG_FILE"
    read -r -p "  是否覆盖？[y/N，默认 N]: " OVERWRITE_CONFIRM
    OVERWRITE_CONFIRM="${OVERWRITE_CONFIRM:-N}"
    if [[ "$OVERWRITE_CONFIRM" =~ ^[Yy]$ ]]; then
        write_config
        success "config.json 已更新"
    else
        info "保留现有 config.json"
    fi
else
    write_config
    success "config.json 已创建: $CONFIG_FILE"
fi

echo ""

# =============================================================================
# A7. 写运行时元数据 .runtime/paths.env
# =============================================================================
hr
info "写入运行时元数据..."
hr

RUNTIME_DIR="$REPO_ROOT/.runtime"
mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/pids"

PATHS_ENV="$RUNTIME_DIR/paths.env"

# 如已存在，询问是否覆盖
if [[ -f "$PATHS_ENV" ]]; then
    warn ".runtime/paths.env 已存在"
    read -r -p "  是否覆盖？[y/N，默认 N]: " OVERWRITE_PATHS
    OVERWRITE_PATHS="${OVERWRITE_PATHS:-N}"
    if [[ ! "$OVERWRITE_PATHS" =~ ^[Yy]$ ]]; then
        info "保留现有 paths.env"
        SKIP_PATHS_WRITE=true
    else
        SKIP_PATHS_WRITE=false
    fi
else
    SKIP_PATHS_WRITE=false
fi

if [[ "$SKIP_PATHS_WRITE" == "false" ]]; then
    {
        echo "# EmotionTTS 运行时路径配置（由 install.sh 生成，勿手动修改）"
        echo "# 重新运行 bash install.sh 可重新生成"
        echo ""
        echo "PYTHON_BIN=$PYTHON_BIN"
        if [[ "$ENABLE_LOCAL_TTS" == "true" && -n "$INDEXTTS_MODEL_DIR" ]]; then
            echo "INDEXTTS_MODEL_DIR=$INDEXTTS_MODEL_DIR"
        fi
        echo "ENABLE_LOCAL_TTS=$ENABLE_LOCAL_TTS"
        echo "ENABLE_LOCAL_ASR=$ENABLE_LOCAL_ASR"
    } > "$PATHS_ENV"
    success ".runtime/paths.env 写入完成"
fi

echo ""

# =============================================================================
# A8. 打印下一步指引
# =============================================================================
hr
bold "部署完成！"
hr
echo ""
success "所有组件已就绪"
echo ""
bold "下一步操作："
echo ""
echo -e "  ${CYAN}1. 启动服务${RESET}"
echo "     bash start.sh"
echo ""
echo -e "  ${CYAN}2. 访问 Web UI${RESET}"
echo "     浏览器打开: http://127.0.0.1:9880"
echo ""
echo -e "  ${CYAN}3. 配置 LLM（必须）${RESET}"
echo "     前往设置页 → LLM 配置，填入你的 LLM API 地址和 Key"
echo "     默认配置为本地 Ollama，模型: qwen2.5:7b"
echo ""
if [[ "$ENABLE_LOCAL_TTS" == "true" ]]; then
    echo -e "  ${CYAN}4. 本地 TTS 说明${RESET}"
    echo "     start.sh 会自动启动 tts_service（端口 9800）"
    echo "     首次加载模型较慢，请耐心等待"
    echo ""
fi
if [[ "$ENABLE_LOCAL_ASR" == "true" ]]; then
    echo -e "  ${CYAN}5. 本地 ASR 说明${RESET}"
    echo "     start.sh 会自动启动 asr_service（端口 9900）"
    echo ""
fi
echo -e "  ${CYAN}查看完整使用文档${RESET}"
echo "     cat docs/DEPLOY.md"
echo ""
bold "服务管理命令:"
echo "  bash start.sh           # 启动所有服务"
echo "  bash start.sh status    # 查看服务状态"
echo "  bash start.sh stop      # 停止所有服务"
echo "  bash start.sh restart   # 重启所有服务"
echo "  bash start.sh logs      # 查看日志（webapp/asr/tts）"
echo ""
