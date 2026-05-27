#Requires -Version 5.1
# =============================================================================
# EmotionTTS Windows 一键部署脚本
# 用法: .\install.ps1 [-Help]
# =============================================================================

[CmdletBinding()]
param(
    [Alias("h")]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ─────────────────────────────── 颜色辅助函数 ────────────────────────────────
function Info    { param([string]$Msg) Write-Host "▶ $Msg" -ForegroundColor Blue }
function Success { param([string]$Msg) Write-Host "✓ $Msg" -ForegroundColor Green }
function Warn    { param([string]$Msg) Write-Host "⚠ $Msg" -ForegroundColor Yellow }
function ErrorMsg{ param([string]$Msg) Write-Host "✗ $Msg" -ForegroundColor Red }
function Bold    { param([string]$Msg) Write-Host $Msg -ForegroundColor White }
function Hr      { Write-Host "──────────────────────────────────────────────────" -ForegroundColor Cyan }

# 仓库根目录
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# ─────────────────────────────── --help ──────────────────────────────────────
if ($Help) {
    Bold "EmotionTTS 一键部署脚本（Windows 版）"
    Write-Host ""
    Write-Host "用法:"
    Write-Host "  .\install.ps1           交互式部署（推荐）"
    Write-Host "  .\install.ps1 -Help     显示此帮助信息"
    Write-Host ""
    Write-Host "脚本会引导你完成以下步骤："
    Write-Host "  1. 检测系统环境（python / ffmpeg / git），缺失时自动安装"
    Write-Host "     · Windows：通过 winget（内置）/ choco / scoop 安装"
    Write-Host "  2. 选择 TTS 部署方式（本地 IndexTTS2 或云端 API）"
    Write-Host "  3. 选择 ASR 部署方式（本地 Whisper 或云端 API）"
    Write-Host "  4. 准备 Python 环境"
    Write-Host "  5. 下载所需模型文件"
    Write-Host "  6. 写入默认配置 webapp\config\config.json"
    Write-Host "  7. 写入运行时元数据 .runtime\paths.env"
    Write-Host ""
    Write-Host "部署完成后，运行: .\start.ps1"
    exit 0
}

# ─────────────────────────────── 刷新 PATH 辅助 ──────────────────────────────
function Refresh-EnvPath {
    <#
    Business Logic: winget/choco 安装工具后，新路径在当前 PowerShell 会话中不可见，需刷新。
    Code Logic: 从 Machine 和 User 两级注册表读取 PATH 并合并到 $env:Path。
    #>
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path    = "$machinePath;$userPath"
}

# ─────────────────────────────── 包管理器检测 ────────────────────────────────
function Detect-PkgManager {
    <#
    Business Logic: Windows 上有多个可选包管理器，优先使用内置的 winget。
    Code Logic: 按 winget → choco → scoop 顺序检测，返回第一个可用的名称或 "none"。
    #>
    if (Get-Command winget -ErrorAction SilentlyContinue) { return "winget" }
    if (Get-Command choco  -ErrorAction SilentlyContinue) { return "choco"  }
    if (Get-Command scoop  -ErrorAction SilentlyContinue) { return "scoop"  }
    return "none"
}

# ─────────────────────────────── 包名映射 ────────────────────────────────────
function Map-Pkg {
    <#
    Business Logic: 不同包管理器对同一工具使用不同的包 ID，需要统一映射。
    Code Logic: 接收包管理器名和工具名，返回该包管理器下对应的包标识符。
    #>
    param([string]$Mgr, [string]$Tool)
    switch ("$Mgr`:$Tool") {
        "winget:python3" { return "Python.Python.3.11" }
        "winget:ffmpeg"  { return "Gyan.FFmpeg" }
        "winget:git"     { return "Git.Git" }
        "choco:python3"  { return "python" }
        "choco:ffmpeg"   { return "ffmpeg" }
        "choco:git"      { return "git" }
        "scoop:python3"  { return "python" }
        "scoop:ffmpeg"   { return "ffmpeg" }
        "scoop:git"      { return "git" }
        default          { return $Tool }
    }
}

# ─────────────────────────────── 单工具安装 ──────────────────────────────────
function Install-Tool {
    <#
    Business Logic: 检测到某工具缺失、用户确认后自动通过包管理器安装。
    Code Logic: 接收包管理器名和工具名，调用对应包管理器命令静默安装；
                winget 安装时告知用户可能弹 UAC 对话框。
    #>
    param([string]$Mgr, [string]$Tool)
    $pkg = Map-Pkg $Mgr $Tool
    Info "用 $Mgr 安装: $pkg"
    switch ($Mgr) {
        "winget" {
            Warn "winget 安装可能弹出 UAC 提权对话框，请在弹窗中点击「是」。"
            winget install --id $pkg --silent --accept-source-agreements --accept-package-agreements
        }
        "choco"  {
            choco install $pkg -y
        }
        "scoop"  {
            scoop install $pkg
        }
    }
}

# ─────────────────────────────── Python 检测辅助 ──────────────────────────────
function Find-Python {
    <#
    Business Logic: Windows 上 Python 可能注册为 py.exe、python.exe，需两种都试。
    Code Logic: 按 py -3 → python → python3 顺序尝试，找到版本 >= 3.10 的返回其路径，
                否则返回空字符串。
    #>
    $candidates = @("py", "python", "python3")
    foreach ($cmd in $candidates) {
        $exe = Get-Command $cmd -ErrorAction SilentlyContinue
        if (-not $exe) { continue }
        try {
            $verStr = & $cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            if ($verStr -match "^(\d+)\.(\d+)") {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10)) {
                    return $cmd   # 返回可用的命令名
                }
            }
        } catch { }
    }
    return ""
}

# =============================================================================
# 欢迎界面
# =============================================================================
Hr
Bold "       EmotionTTS 一键部署向导（Windows）"
Hr
Write-Host ""

# =============================================================================
# A1. 环境检测
# =============================================================================
Info "检测系统环境..."

# ── 检测必备工具 ───────────────────────────────────────────────────────────────
$MissingTools = [System.Collections.Generic.List[string]]::new()

function Detect-Tools {
    <#
    Business Logic: 开始安装前检查所有必要的系统工具是否存在且版本符合要求。
    Code Logic: 检测 Python(>=3.10) / ffmpeg / git，将缺失的工具名加入 $script:MissingTools。
                curl 在 Win10+ 内置，跳过检测。
    #>
    $script:MissingTools = [System.Collections.Generic.List[string]]::new()
    $script:PythonCmd = ""

    # python >= 3.10
    $foundPy = Find-Python
    if ($foundPy) {
        $verStr = & $foundPy -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        Success "Python: $verStr（命令: $foundPy）"
        $script:PythonCmd = $foundPy
    } else {
        # 检查是否存在但版本太低
        $anyPy = @("py","python","python3") | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
        if ($anyPy) {
            Warn "检测到 Python，但版本低于 3.10，需要升级"
        } else {
            Warn "未找到 Python"
        }
        $script:MissingTools.Add("python3")
    }

    # ffmpeg
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        $ffVer = (ffmpeg -version 2>&1 | Select-Object -First 1) -replace ".*version\s+(\S+).*",'$1'
        Success "ffmpeg: $ffVer"
    } else {
        Warn "未找到 ffmpeg（音频处理必须）"
        $script:MissingTools.Add("ffmpeg")
    }

    # git
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $gitVer = (git --version) -replace "git version ",""
        Success "git: $gitVer"
    } else {
        Warn "未找到 git"
        $script:MissingTools.Add("git")
    }

    # curl：Win10+ 内置 curl.exe，跳过检测
    Success "curl: Win10+ 内置，跳过检测"
}

Detect-Tools

# uv（可选，推荐；缺失时回落到 venv）
$HasUV = $false
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $uvVer = (uv --version)
    Success "uv: $uvVer"
    $HasUV = $true
} else {
    Warn "未找到 uv（推荐但非必需，将回落到 python -m venv）"
}

# ── 自动安装缺失依赖 ───────────────────────────────────────────────────────────
if ($MissingTools.Count -gt 0) {
    Write-Host ""
    Warn "检测到缺失依赖: $($MissingTools -join ', ')"

    $PkgMgr = Detect-PkgManager
    if ($PkgMgr -eq "none") {
        ErrorMsg "未检测到可用的包管理器（需要 winget / choco / scoop 之一）"
        Bold "请手动安装以下依赖后重试: $($MissingTools -join ', ')"
        Bold "  推荐：从 https://apps.microsoft.com/store/detail/app-installer/9NBLGGH4NNS1 安装 winget"
        exit 1
    }

    Write-Host ""
    $autoInput = Read-Host "  使用 $PkgMgr 自动安装这些依赖？[Y/n，默认 Y]"
    if ([string]::IsNullOrWhiteSpace($autoInput)) { $autoInput = "Y" }

    if ($autoInput -match "^[Yy]$") {
        foreach ($tool in $MissingTools) {
            try {
                Install-Tool $PkgMgr $tool
            } catch {
                ErrorMsg "安装 $tool 失败: $_"
                exit 1
            }
        }
        # 刷新 PATH 使新安装的工具立即可用
        Refresh-EnvPath
        Success "依赖安装完成，重新检测..."
        Write-Host ""
        Detect-Tools
        if ($MissingTools.Count -gt 0) {
            ErrorMsg "以下依赖在自动安装后仍不可用: $($MissingTools -join ', ')"
            Write-Host "  请手动检查上面的安装日志后重试。"
            exit 1
        }
        Success "所有系统依赖均已就绪"
    } else {
        Warn "已跳过自动安装"
        # 仅 ffmpeg 缺失时允许继续（运行时才会出错）
        if ($MissingTools.Count -eq 1 -and $MissingTools[0] -eq "ffmpeg") {
            Warn "ffmpeg 缺失不阻止安装，但运行时音频处理会报错"
        } else {
            ErrorMsg "缺少关键依赖，无法继续: $($MissingTools -join ', ')"
            exit 1
        }
    }
}

Write-Host ""

# =============================================================================
# A2. 交互式询问
# =============================================================================
Hr
Bold "部署配置"
Hr
Write-Host ""

# ── 问题 1：TTS 部署方式 ──────────────────────────────────────────────────────
Bold "1) TTS（语音合成）部署方式？"
Write-Host "   a) 本地 IndexTTS2（需 GPU 或耐心等 CPU 推理，需下载几 GB 模型）"
Write-Host "   b) 云端 OpenAI 兼容 TTS API（无本地依赖，最快启动）"
Write-Host ""
$ttsInput = Read-Host "   请选择 [a/b，默认 b]"
if ([string]::IsNullOrWhiteSpace($ttsInput)) { $ttsInput = "b" }
$TtsChoice = $ttsInput.ToLower().Trim()

$EnableLocalTTS = $false
$IndexTTSEnvChoice = "skip"

if ($TtsChoice -eq "a") {
    $EnableLocalTTS = $true
    Write-Host ""
    Bold "2) IndexTTS 环境处理？"
    Write-Host "   a) 我已经按官方 README 装好了，输入 .venv 路径（跳过下载）"
    Write-Host "   b) 让脚本帮我全自动部署（clone + uv sync + 下载几 GB checkpoint）"
    Write-Host "   c) 暂不安装，脚本只写配置 —— 之后我自己按文档手动装"
    Write-Host ""
    $envInput = Read-Host "   请选择 [a/b/c，默认 a]"
    if ([string]::IsNullOrWhiteSpace($envInput)) { $envInput = "a" }
    $IndexTTSEnvChoice = $envInput.ToLower().Trim()
}

Write-Host ""

# ── 问题 3：ASR 部署方式 ──────────────────────────────────────────────────────
$AsrQNum = if ($EnableLocalTTS) { 3 } else { 2 }
Bold "$AsrQNum) ASR（语音识别）部署方式？"
Write-Host "   a) 本地 Whisper（自动下载 ~466MB 模型到 models\whisper-small\）"
Write-Host "   b) 本地 Whisper（暂不下载，我之后自己放进 models\whisper-small\）"
Write-Host "   c) 云端 OpenAI 兼容 ASR API（如 OpenAI / Groq）"
Write-Host ""
$asrInput = Read-Host "   请选择 [a/b/c，默认 a]"
if ([string]::IsNullOrWhiteSpace($asrInput)) { $asrInput = "a" }
$AsrChoice = $asrInput.ToLower().Trim()

$EnableLocalASR = $false
$DownloadAsrModel = $false
switch ($AsrChoice) {
    "a" { $EnableLocalASR = $true;  $DownloadAsrModel = $true  }
    "b" { $EnableLocalASR = $true;  $DownloadAsrModel = $false }
    default { $EnableLocalASR = $false; $DownloadAsrModel = $false }
}

Write-Host ""

# ── 问题 4：仅 TTS=cloud 时询问 Python 环境策略 ──────────────────────────────
$PythonEnvChoice = "new"
if (-not $EnableLocalTTS) {
    $qNum = 3
    Bold "$qNum) Python 环境策略？"
    Write-Host "   a) 在项目目录创建新的 .venv（推荐）"
    Write-Host "   b) 复用我指定的现有 venv 路径"
    Write-Host ""
    $pyEnvInput = Read-Host "   请选择 [a/b，默认 a]"
    if ([string]::IsNullOrWhiteSpace($pyEnvInput)) { $pyEnvInput = "a" }
    if ($pyEnvInput.ToLower().Trim() -eq "b") {
        $PythonEnvChoice = "existing"
    }
}

Write-Host ""

# =============================================================================
# 汇总用户选择
# =============================================================================
Hr
Bold "配置汇总"
Hr
$ttsDesc = if ($EnableLocalTTS) { "本地 IndexTTS2" } else { "云端 API" }
$asrDesc = if ($EnableLocalASR) { "本地 Whisper"  } else { "云端 API" }
Write-Host "  TTS 方式     : $ttsDesc"
Write-Host "  ASR 方式     : $asrDesc"
if ($EnableLocalTTS) {
    switch ($IndexTTSEnvChoice) {
        "a" { Write-Host "  IndexTTS 安装: 使用已有 venv（跳过下载）" }
        "b" { Write-Host "  IndexTTS 安装: 全自动部署（clone + uv sync + 下 checkpoint）" }
        "c" { Write-Host "  IndexTTS 安装: 暂不安装（只写配置，之后手动）" }
    }
}
if ($EnableLocalASR) {
    if ($DownloadAsrModel) {
        Write-Host "  Whisper 模型 : 自动下载（~466MB）"
    } else {
        Write-Host "  Whisper 模型 : 暂不下载（只写配置，之后手动放到 models\whisper-small\）"
    }
}
Write-Host ""
$confirmInput = Read-Host "确认以上配置继续？[Y/n，默认 Y]"
if ([string]::IsNullOrWhiteSpace($confirmInput)) { $confirmInput = "Y" }
if ($confirmInput -notmatch "^[Yy]$") {
    Warn "已取消。重新运行 .\install.ps1 重新配置。"
    exit 0
}

Write-Host ""

# =============================================================================
# A3. Python 环境准备
# =============================================================================
Hr
Info "准备 Python 环境..."
Hr

$PythonBin = ""
$IndexTTSModelDir = ""

# ── 情况 A：TTS=local + 复用已有 venv ────────────────────────────────────────
if ($EnableLocalTTS -and $IndexTTSEnvChoice -eq "a") {
    Write-Host ""
    $venvInput = Read-Host "  请输入 IndexTTS .venv 根目录路径（如 C:\Users\you\repos\index-tts\.venv）"
    $ExistingVenv = $venvInput.TrimEnd('\', '/')
    # 展开 ~ 为用户目录
    $ExistingVenv = $ExistingVenv -replace "^~", $env:USERPROFILE

    if (-not (Test-Path $ExistingVenv -PathType Container)) {
        ErrorMsg "路径不存在: $ExistingVenv"
        exit 1
    }

    $PythonBin = Join-Path $ExistingVenv "Scripts\python.exe"
    if (-not (Test-Path $PythonBin)) {
        ErrorMsg "未在 $ExistingVenv\Scripts\ 找到 python.exe"
        exit 1
    }

    # 校验关键包
    Info "校验 venv 中的关键依赖..."
    $MissingPkgs = @()
    foreach ($pkg in @("fastapi","uvicorn","httpx","pydub","indextts")) {
        $ok = & $PythonBin -c "import $pkg" 2>$null
        if ($LASTEXITCODE -ne 0) { $MissingPkgs += $pkg }
    }
    if ($MissingPkgs.Count -gt 0) {
        Warn "venv 中缺少以下包: $($MissingPkgs -join ', ')"
        Warn "请在该 venv 中手动安装后重新运行本脚本"
        exit 1
    }
    Success "venv 校验通过: $PythonBin"

    # 自动探测 IndexTTS checkpoints
    $VenvParent = Split-Path -Parent $ExistingVenv
    $DefaultCkpt = Join-Path $VenvParent "checkpoints"
    $HFHubDir = if ($env:HF_HOME) { Join-Path $env:HF_HOME "hub" } `
                else { Join-Path $env:USERPROFILE ".cache\huggingface\hub" }
    $HFSnapshotRoot = Join-Path $HFHubDir "models--IndexTeam--IndexTTS-2\snapshots"
    if (Test-Path $HFSnapshotRoot) {
        $latestSnap = Get-ChildItem $HFSnapshotRoot -Directory |
                      Sort-Object LastWriteTime -Descending |
                      Select-Object -First 1
        if ($latestSnap -and (Test-Path (Join-Path $latestSnap.FullName "gpt.pth"))) {
            $DefaultCkpt = $latestSnap.FullName
            Info "检测到 HuggingFace cache 中的 IndexTTS-2 模型: $DefaultCkpt"
        }
    }
    $ckptInput = Read-Host "  IndexTTS checkpoints 目录（默认 $DefaultCkpt）"
    $IndexTTSModelDir = if ([string]::IsNullOrWhiteSpace($ckptInput)) { $DefaultCkpt } else { $ckptInput }
    $IndexTTSModelDir = $IndexTTSModelDir -replace "^~", $env:USERPROFILE
    if (-not (Test-Path $IndexTTSModelDir -PathType Container)) {
        Warn "checkpoints 目录不存在: $IndexTTSModelDir"
        Warn "请确保模型文件已下载；启动 tts_service 时会用到此路径"
    } else {
        Success "checkpoints 目录: $IndexTTSModelDir"
    }
}
# ── 情况 B：TTS=local + 全自动部署 ────────────────────────────────────────────
elseif ($EnableLocalTTS -and $IndexTTSEnvChoice -eq "b") {
    Write-Host ""
    $DefaultCloneDir = Join-Path $env:USERPROFILE "repos\index-tts"
    $cloneInput = Read-Host "  IndexTTS 仓库安装位置（默认 $DefaultCloneDir）"
    $CloneDir = if ([string]::IsNullOrWhiteSpace($cloneInput)) { $DefaultCloneDir } else { $cloneInput }
    $CloneDir = $CloneDir -replace "^~", $env:USERPROFILE

    # Git clone IndexTTS
    $gitDir = Join-Path $CloneDir ".git"
    if (Test-Path $gitDir) {
        Warn "目录已存在: $CloneDir，跳过 clone（执行 git pull）"
        Info "更新 IndexTTS 仓库..."
        try {
            git -C $CloneDir pull --ff-only
        } catch {
            Warn "git pull 失败，继续使用现有代码"
        }
    } else {
        Info "克隆 IndexTTS 仓库到 $CloneDir ..."
        $parentDir = Split-Path -Parent $CloneDir
        if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
        try {
            git clone https://github.com/index-tts/index-tts.git $CloneDir
            Success "克隆完成: $CloneDir"
        } catch {
            ErrorMsg "git clone 失败！"
            Write-Host "  可能原因: 网络不通 / GitHub 访问受限"
            Write-Host "  建议: 手动 clone 后选择「使用已有 venv」模式"
            exit 1
        }
    }

    # 安装 uv（若未安装）
    $UvCmd = "uv"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        Info "安装 uv 包管理器..."
        try {
            # Windows 官方安装方式
            $uvInstallScript = (Invoke-WebRequest -Uri "https://astral.sh/uv/install.ps1" -UseBasicParsing).Content
            Invoke-Expression $uvInstallScript
            Refresh-EnvPath
            if (Get-Command uv -ErrorAction SilentlyContinue) {
                $UvCmd = "uv"
                Success "uv 安装完成"
            } else {
                # 尝试 pip 安装
                & $PythonCmd -m pip install -U uv
                Refresh-EnvPath
                $UvCmd = "uv"
                Success "uv（via pip）安装完成"
            }
        } catch {
            Warn "uv 安装失败，回落到 pip"
            $UvCmd = ""
        }
    }

    # uv sync 安装 Python 依赖
    Info "安装 IndexTTS 依赖（uv sync --all-extras）..."
    Push-Location $CloneDir
    try {
        if ($UvCmd) {
            try {
                & $UvCmd sync --all-extras
            } catch {
                Warn "uv sync 失败，尝试使用国内镜像..."
                & $UvCmd sync --all-extras --default-index "https://mirrors.aliyun.com/pypi/simple"
            }
        } else {
            ErrorMsg "uv 不可用，依赖安装失败！"
            Write-Host "  建议: 手动安装 uv 后重试，或参考 IndexTTS README 手动安装依赖"
            Pop-Location
            exit 1
        }
    } catch {
        ErrorMsg "依赖安装失败！"
        Write-Host "  建议: 检查网络连接，或参考 IndexTTS README 手动安装"
        Pop-Location
        exit 1
    }
    Pop-Location
    Success "IndexTTS 依赖安装完成"

    $PythonBin = Join-Path $CloneDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $PythonBin)) {
        ErrorMsg "未找到 $PythonBin，uv sync 可能未创建 venv"
        exit 1
    }

    # 下载 IndexTTS checkpoints
    $IndexTTSModelDir = Join-Path $CloneDir "checkpoints"
    $ckptExists = (Test-Path $IndexTTSModelDir) -and
                  ((Get-ChildItem $IndexTTSModelDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
    if ($ckptExists) {
        Warn "checkpoints 目录已存在且非空，跳过下载"
    } else {
        Info "下载 IndexTTS2 checkpoints（IndexTeam/IndexTTS-2）..."
        Warn "注意：模型文件较大（数 GB），下载可能耗时较长"
        if (-not (Test-Path $IndexTTSModelDir)) {
            New-Item -ItemType Directory -Path $IndexTTSModelDir -Force | Out-Null
        }

        $HFDownloadSuccess = $false

        # 方式 1：huggingface-cli
        if (Get-Command huggingface-cli -ErrorAction SilentlyContinue) {
            try {
                huggingface-cli download IndexTeam/IndexTTS-2 --local-dir="$IndexTTSModelDir"
                $HFDownloadSuccess = $true
            } catch { }
        }

        # 方式 2：Python huggingface_hub
        if (-not $HFDownloadSuccess) {
            Info "尝试通过 Python huggingface_hub 下载..."
            try {
                & $PythonBin -m pip install "huggingface-hub[cli,hf_xet]" -q 2>$null
                $dlScript = @"
from huggingface_hub import snapshot_download
snapshot_download('IndexTeam/IndexTTS-2', local_dir=r'$IndexTTSModelDir')
print('download ok')
"@
                & $PythonBin -c $dlScript
                $HFDownloadSuccess = $true
            } catch {
                Warn "HuggingFace 下载失败，尝试国内镜像 hf-mirror.com ..."
                try {
                    $env:HF_ENDPOINT = "https://hf-mirror.com"
                    $dlScript2 = @"
import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
from huggingface_hub import snapshot_download
snapshot_download('IndexTeam/IndexTTS-2', local_dir=r'$IndexTTSModelDir')
print('download ok via mirror')
"@
                    & $PythonBin -c $dlScript2
                    $HFDownloadSuccess = $true
                } catch { }
            }
        }

        # 方式 3：git clone（镜像）
        if (-not $HFDownloadSuccess) {
            Info "尝试 git clone 镜像站..."
            try {
                git clone --depth=1 "https://hf-mirror.com/IndexTeam/IndexTTS-2" $IndexTTSModelDir
                $HFDownloadSuccess = $true
            } catch {
                try {
                    git clone --depth=1 "https://huggingface.co/IndexTeam/IndexTTS-2" $IndexTTSModelDir
                    $HFDownloadSuccess = $true
                } catch { }
            }
        }

        if (-not $HFDownloadSuccess) {
            ErrorMsg "checkpoint 下载失败！"
            Write-Host ""
            Write-Host "手动下载方式:"
            Write-Host "  1. HuggingFace: https://huggingface.co/IndexTeam/IndexTTS-2"
            Write-Host "  2. 镜像站（国内）:"
            Write-Host "     `$env:HF_ENDPOINT = 'https://hf-mirror.com'"
            Write-Host "     huggingface-cli download IndexTeam/IndexTTS-2 --local-dir=$IndexTTSModelDir"
            Write-Host "  下载完成后重新运行: .\install.ps1"
            exit 1
        }

        Success "checkpoints 下载完成: $IndexTTSModelDir"
    }
}
# ── 情况 B2：TTS=local 但选「暂不安装」(c) ────────────────────────────────────
elseif ($EnableLocalTTS -and $IndexTTSEnvChoice -eq "c") {
    Warn "选择「暂不安装本地 TTS」—— 跳过 IndexTTS 部署"
    Write-Host "  注意：脚本只写配置，之后请你按 IndexTTS 官方文档手动装："
    Write-Host "    https://github.com/index-tts/index-tts"
    Write-Host "  装好后可重新跑 .\install.ps1 选择 a（复用已有 venv）补完配置。"
    Write-Host ""

    $VenvDir = Join-Path $RepoRoot ".venv"
    if (Test-Path $VenvDir -PathType Container) {
        Warn ".venv 已存在，跳过创建"
    } else {
        Info "为 webapp / asr_service 创建项目 .venv（IndexTTS 之后自己装）"
        if ($HasUV) {
            try { uv venv $VenvDir --python 3.10 2>$null } catch {
                try { uv venv $VenvDir 2>$null } catch {
                    & $PythonCmd -m venv $VenvDir
                }
            }
        } else {
            & $PythonCmd -m venv $VenvDir
        }
    }
    $PythonBin = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $PythonBin)) {
        ErrorMsg "venv 创建失败: $PythonBin"
        exit 1
    }
    Success "项目 .venv 就绪: $PythonBin"
    $IndexTTSModelDir = ""
}
# ── 情况 C：TTS=cloud + 新建 .venv ────────────────────────────────────────────
elseif (-not $EnableLocalTTS -and $PythonEnvChoice -eq "new") {
    $VenvDir = Join-Path $RepoRoot ".venv"

    if (Test-Path $VenvDir -PathType Container) {
        Warn ".venv 已存在，跳过创建（直接安装/更新依赖）"
    } else {
        Info "创建 Python venv: $VenvDir"
        if ($HasUV) {
            try { uv venv $VenvDir --python 3.10 2>$null } catch {
                try { uv venv $VenvDir 2>$null } catch {
                    & $PythonCmd -m venv $VenvDir
                }
            }
        } else {
            & $PythonCmd -m venv $VenvDir
        }
        Success "venv 创建完成: $VenvDir"
    }

    $PythonBin = Join-Path $VenvDir "Scripts\python.exe"
    Info "安装基础依赖..."
    if ($HasUV) {
        try {
            uv pip install --python $PythonBin fastapi uvicorn python-multipart httpx pydub
        } catch {
            & $PythonBin -m pip install fastapi uvicorn python-multipart httpx pydub
        }
    } else {
        & $PythonBin -m pip install --upgrade pip
        & $PythonBin -m pip install fastapi uvicorn python-multipart httpx pydub
    }
    Success "基础依赖安装完成"
}
# ── 情况 D：TTS=cloud + 复用已有 venv ─────────────────────────────────────────
elseif (-not $EnableLocalTTS -and $PythonEnvChoice -eq "existing") {
    $venvInput = Read-Host "  请输入现有 venv 根目录路径"
    $ExistingVenv = $venvInput.TrimEnd('\', '/') -replace "^~", $env:USERPROFILE

    $PythonBin = Join-Path $ExistingVenv "Scripts\python.exe"
    if (-not (Test-Path $PythonBin)) {
        ErrorMsg "未在 $ExistingVenv\Scripts\ 找到 python.exe"
        exit 1
    }
    Success "使用现有 venv: $PythonBin"
}

# =============================================================================
# A4. 额外依赖：ASR=local 需要 faster-whisper
# =============================================================================
if ($EnableLocalASR) {
    Info "安装 faster-whisper（本地 ASR 依赖）..."
    if ($HasUV) {
        try {
            uv pip install --python $PythonBin faster-whisper 2>$null
        } catch {
            & $PythonBin -m pip install faster-whisper
        }
    } else {
        & $PythonBin -m pip install faster-whisper
    }
    # 验证安装
    $fwCheck = & $PythonBin -c "import faster_whisper; print('ok')" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Success "faster-whisper 安装成功"
    } else {
        Warn "faster-whisper 安装后验证失败，请手动检查"
    }
}

Write-Host ""

# =============================================================================
# A5. 模型下载
# =============================================================================
Hr
Info "检查/下载模型文件..."
Hr

# ASR=local + 暂不下载
if ($EnableLocalASR -and -not $DownloadAsrModel) {
    $WhisperDir = Join-Path $RepoRoot "models\whisper-small"
    if (-not (Test-Path $WhisperDir)) { New-Item -ItemType Directory -Path $WhisperDir -Force | Out-Null }
    Warn "选择「暂不下载 Whisper 模型」—— 跳过下载"
    Write-Host "  之后请把模型文件放到: $WhisperDir\"
    Write-Host "  下载方式（任一）:"
    Write-Host "    huggingface-cli download Systran/faster-whisper-small --local-dir=$WhisperDir"
    Write-Host "    或: git clone https://huggingface.co/Systran/faster-whisper-small $WhisperDir"
    Write-Host "    国内镜像: `$env:HF_ENDPOINT = 'https://hf-mirror.com' 后再运行上面命令"
}
# ASR=local + 自动下载
elseif ($EnableLocalASR) {
    $WhisperDir = Join-Path $RepoRoot "models\whisper-small"
    if (-not (Test-Path $WhisperDir)) { New-Item -ItemType Directory -Path $WhisperDir -Force | Out-Null }

    $WhisperModel = Join-Path $WhisperDir "model.bin"
    if (Test-Path $WhisperModel) {
        Success "Whisper 模型已存在，跳过下载: $WhisperDir"
    } else {
        Info "下载 Whisper 模型（Systran/faster-whisper-small，~466MB）..."
        Warn "网络环境不佳时可能较慢，请耐心等待"

        $DownloadSuccess = $false

        # 方式 1：huggingface-cli
        if (Get-Command huggingface-cli -ErrorAction SilentlyContinue) {
            Info "使用 huggingface-cli 下载..."
            try {
                huggingface-cli download Systran/faster-whisper-small `
                    --local-dir="$WhisperDir" `
                    model.bin config.json tokenizer.json vocabulary.txt `
                    tokenizer_config.json preprocessor_config.json
                $DownloadSuccess = $true
            } catch { }
        }

        # 方式 2：Python huggingface_hub
        if (-not $DownloadSuccess) {
            Info "使用 huggingface_hub Python API 下载..."
            try {
                & $PythonBin -m pip install huggingface-hub -q 2>$null
            } catch { }
            try {
                $dlScript = @"
from huggingface_hub import snapshot_download
snapshot_download(
    'Systran/faster-whisper-small',
    local_dir=r'$WhisperDir',
    ignore_patterns=['*.msgpack', '*.h5', 'flax_model*', 'tf_model*']
)
print('ok')
"@
                & $PythonBin -c $dlScript
                $DownloadSuccess = $true
            } catch { }
        }

        # 方式 3：git clone（镜像）
        if (-not $DownloadSuccess) {
            Info "尝试 git clone 镜像站..."
            try {
                git clone --depth=1 "https://hf-mirror.com/Systran/faster-whisper-small" $WhisperDir
                $DownloadSuccess = $true
            } catch {
                try {
                    git clone --depth=1 "https://huggingface.co/Systran/faster-whisper-small" $WhisperDir
                    $DownloadSuccess = $true
                } catch { }
            }
        }

        if (-not $DownloadSuccess) {
            ErrorMsg "Whisper 模型下载失败！"
            Write-Host ""
            Write-Host "手动下载方式:"
            Write-Host "  git clone --depth=1 https://huggingface.co/Systran/faster-whisper-small ``"
            Write-Host "      $WhisperDir"
            Write-Host ""
            Write-Host "或使用国内镜像:"
            Write-Host "  git clone --depth=1 https://hf-mirror.com/Systran/faster-whisper-small ``"
            Write-Host "      $WhisperDir"
            exit 1
        }

        Success "Whisper 模型下载完成: $WhisperDir"
    }
}

Write-Host ""

# =============================================================================
# A6. 写默认配置 config.json
# =============================================================================
Hr
Info "准备配置文件..."
Hr

$ConfigDir  = Join-Path $RepoRoot "webapp\config"
$ConfigFile = Join-Path $ConfigDir "config.json"
if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }

# 构建 tts 配置节
if ($EnableLocalTTS) {
    $TtsJson = '"tts": {"type": "local", "api_base": "http://127.0.0.1:9800/v1", "api_key": "", "model": "indextts"}'
} else {
    Write-Host ""
    Write-Host "  云端 TTS 配置（稍后也可在设置页修改）:"
    $TtsApiBase = Read-Host "  TTS API Base URL（如 https://api.openai.com/v1）"
    $TtsApiKey  = Read-Host "  TTS API Key"
    $TtsModel   = Read-Host "  TTS 模型名（如 tts-1）"
    if ([string]::IsNullOrWhiteSpace($TtsApiBase)) { $TtsApiBase = "https://api.openai.com/v1" }
    if ([string]::IsNullOrWhiteSpace($TtsModel))   { $TtsModel   = "tts-1" }
    $TtsJson = """tts"": {""type"": ""cloud"", ""api_base"": ""$TtsApiBase"", ""api_key"": ""$TtsApiKey"", ""model"": ""$TtsModel""}"
}

# 构建 asr 配置节
if ($EnableLocalASR) {
    $AsrJson = '"asr": {"type": "local", "api_base": "http://127.0.0.1:9900/v1", "api_key": "", "model": "whisper-small", "language": "zh"}'
} else {
    Write-Host ""
    Write-Host "  云端 ASR 配置（稍后也可在设置页修改）:"
    $AsrApiBase = Read-Host "  ASR API Base URL（如 https://api.openai.com/v1）"
    $AsrApiKey  = Read-Host "  ASR API Key"
    $AsrModel   = Read-Host "  ASR 模型名（如 whisper-1）"
    if ([string]::IsNullOrWhiteSpace($AsrApiBase)) { $AsrApiBase = "https://api.openai.com/v1" }
    if ([string]::IsNullOrWhiteSpace($AsrModel))   { $AsrModel   = "whisper-1" }
    $AsrJson = """asr"": {""type"": ""cloud"", ""api_base"": ""$AsrApiBase"", ""api_key"": ""$AsrApiKey"", ""model"": ""$AsrModel"", ""language"": ""zh""}"
}

function Write-Config {
    <#
    Business Logic: 生成 webapp 所需的 config.json，让 settings.py 能直接读取。
    Code Logic: 将 LLM/TTS/ASR 三节拼合为标准 JSON 格式写入 webapp\config\config.json。
    #>
    $content = @"
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
  $TtsJson,
  $AsrJson
}
"@
    Set-Content -Path $ConfigFile -Value $content -Encoding UTF8
}

if (Test-Path $ConfigFile) {
    Warn "config.json 已存在: $ConfigFile"
    $overInput = Read-Host "  是否覆盖？[y/N，默认 N]"
    if ([string]::IsNullOrWhiteSpace($overInput)) { $overInput = "N" }
    if ($overInput -match "^[Yy]$") {
        Write-Config
        Success "config.json 已更新"
    } else {
        Info "保留现有 config.json"
    }
} else {
    Write-Config
    Success "config.json 已创建: $ConfigFile"
}

Write-Host ""

# =============================================================================
# A7. 写运行时元数据 .runtime/paths.env
# =============================================================================
Hr
Info "写入运行时元数据..."
Hr

$RuntimeDir = Join-Path $RepoRoot ".runtime"
$LogsDir    = Join-Path $RuntimeDir "logs"
$PidsDir    = Join-Path $RuntimeDir "pids"
foreach ($d in @($RuntimeDir, $LogsDir, $PidsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$PathsEnvFile = Join-Path $RuntimeDir "paths.env"

$SkipPathsWrite = $false
if (Test-Path $PathsEnvFile) {
    Warn ".runtime\paths.env 已存在"
    $overInput = Read-Host "  是否覆盖？[y/N，默认 N]"
    if ([string]::IsNullOrWhiteSpace($overInput)) { $overInput = "N" }
    if ($overInput -notmatch "^[Yy]$") {
        Info "保留现有 paths.env"
        $SkipPathsWrite = $true
    }
}

if (-not $SkipPathsWrite) {
    $pathsLines = @(
        "# EmotionTTS 运行时路径配置（由 install.ps1 生成，勿手动修改）",
        "# 重新运行 .\install.ps1 可重新生成",
        "",
        "PYTHON_BIN=$PythonBin"
    )
    if ($EnableLocalTTS -and $IndexTTSModelDir) {
        $pathsLines += "INDEXTTS_MODEL_DIR=$IndexTTSModelDir"
    }
    $enableTTSStr = ($EnableLocalTTS).ToString().ToLower()
    $enableASRStr = ($EnableLocalASR).ToString().ToLower()
    $pathsLines += "ENABLE_LOCAL_TTS=$enableTTSStr"
    $pathsLines += "ENABLE_LOCAL_ASR=$enableASRStr"

    Set-Content -Path $PathsEnvFile -Value ($pathsLines -join "`r`n") -Encoding UTF8
    Success ".runtime\paths.env 写入完成"
}

Write-Host ""

# =============================================================================
# A8. 打印下一步指引
# =============================================================================
Hr
Bold "部署完成！"
Hr
Write-Host ""
Success "所有组件已就绪"
Write-Host ""
Bold "下一步操作："
Write-Host ""
Write-Host "  " -NoNewline; Write-Host "1. 启动服务" -ForegroundColor Cyan
Write-Host "     .\start.ps1"
Write-Host ""
Write-Host "  " -NoNewline; Write-Host "2. 访问 Web UI" -ForegroundColor Cyan
Write-Host "     浏览器打开: http://127.0.0.1:9880"
Write-Host ""
Write-Host "  " -NoNewline; Write-Host "3. 配置 LLM（必须）" -ForegroundColor Cyan
Write-Host "     前往设置页 → LLM 配置，填入你的 LLM API 地址和 Key"
Write-Host "     默认配置为本地 Ollama，模型: qwen2.5:7b"
Write-Host ""
if ($EnableLocalTTS) {
    Write-Host "  " -NoNewline; Write-Host "4. 本地 TTS 说明" -ForegroundColor Cyan
    Write-Host "     start.ps1 会自动启动 tts_service（端口 9800）"
    Write-Host "     首次加载模型较慢，请耐心等待"
    Write-Host ""
}
if ($EnableLocalASR) {
    Write-Host "  " -NoNewline; Write-Host "5. 本地 ASR 说明" -ForegroundColor Cyan
    Write-Host "     start.ps1 会自动启动 asr_service（端口 9900）"
    Write-Host ""
}
Write-Host "  " -NoNewline; Write-Host "查看完整使用文档" -ForegroundColor Cyan
Write-Host "     Get-Content docs\DEPLOY.md"
Write-Host ""
Bold "服务管理命令:"
Write-Host "  .\start.ps1           # 启动所有服务"
Write-Host "  .\start.ps1 status    # 查看服务状态"
Write-Host "  .\start.ps1 stop      # 停止所有服务"
Write-Host "  .\start.ps1 restart   # 重启所有服务"
Write-Host "  .\start.ps1 logs      # 查看日志（webapp/asr/tts）"
Write-Host ""
