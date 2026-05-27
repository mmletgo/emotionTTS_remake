#Requires -Version 5.1
# =============================================================================
# EmotionTTS 一键启动脚本（PowerShell Windows 版）
# 用法:
#   .\start.ps1                              启动所有服务（默认）
#   .\start.ps1 start                        启动所有需要的服务
#   .\start.ps1 status                       查看各服务状态
#   .\start.ps1 stop                         停止所有服务
#   .\start.ps1 restart                      重启所有服务
#   .\start.ps1 logs [webapp|asr|tts|all]    查看日志（默认 webapp）
#   .\start.ps1 --help                       显示帮助
# =============================================================================

# 顶层错误处理策略：函数内部自行 try/catch，入口层捕获意外异常
$ErrorActionPreference = "Stop"

# ─────────────────────────────── 颜色辅助函数 ───────────────────────────────

function Info {
    <#
    Business Logic: 输出蓝色进度信息，等价 bash info()
    Code Logic: 用 Write-Host 配合蓝色前景输出带 ▶ 前缀的消息
    #>
    param([string]$Message)
    Write-Host "▶ $Message" -ForegroundColor Blue
}

function Success {
    <#
    Business Logic: 输出绿色成功信息，等价 bash success()
    Code Logic: 用 Write-Host 配合绿色前景输出带 ✓ 前缀的消息
    #>
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Warn {
    <#
    Business Logic: 输出黄色警告信息，等价 bash warn()
    Code Logic: 用 Write-Host 配合黄色前景输出带 ⚠ 前缀的消息
    #>
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function ErrorMsg {
    <#
    Business Logic: 输出红色错误信息，等价 bash error()（避开内置 Error 命令冲突）
    Code Logic: 用 Write-Host 配合红色前景输出带 ✗ 前缀的消息到标准输出
    #>
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Bold {
    <#
    Business Logic: 输出醒目的白色文字，等价 bash bold()
    Code Logic: 用 Write-Host 配合白色前景高亮输出
    #>
    param([string]$Message)
    Write-Host $Message -ForegroundColor White
}

function Hr {
    <#
    Business Logic: 输出青色分隔线，等价 bash hr()
    Code Logic: 用 Write-Host 配合青色前景输出固定宽度分隔线
    #>
    Write-Host "──────────────────────────────────────────────────" -ForegroundColor Cyan
}

# ─────────────────────────────── 路径常量 ───────────────────────────────────

# 脚本所在目录（仓库根）
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# 运行时目录
$RuntimeDir  = Join-Path $RepoRoot ".runtime"
$PathsEnv    = Join-Path $RuntimeDir "paths.env"
$PidsDir     = Join-Path $RuntimeDir "pids"
$LogsDir     = Join-Path $RuntimeDir "logs"

# config.json 路径
$ConfigFile  = Join-Path $RepoRoot "webapp\config\config.json"

# 运行时变量（从 paths.env / config.json 填充）
$script:PythonBin        = ""
$script:IndexTTSModelDir = ""
$script:EnableLocalTTS   = "false"
$script:EnableLocalASR   = "false"
$script:TtsType          = "local"
$script:AsrType          = "local"

# ─────────────────────────────── 读取 paths.env ─────────────────────────────

function TryLoadPathsEnv {
    <#
    Business Logic: 软加载 .runtime/paths.env，缺失时返回 $false，不退出脚本
    Code Logic: 逐行解析 KEY=value 格式，忽略注释行和空行，赋值到 script 作用域变量
    #>
    if (-not (Test-Path $PathsEnv)) {
        return $false
    }
    try {
        $lines = Get-Content -Path $PathsEnv -Encoding UTF8
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            # 忽略注释和空行
            if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
            # 解析 KEY=value（value 可以含等号）
            $eqIdx = $trimmed.IndexOf("=")
            if ($eqIdx -lt 0) { continue }
            $key   = $trimmed.Substring(0, $eqIdx).Trim()
            $value = $trimmed.Substring($eqIdx + 1).Trim()
            switch ($key) {
                "PYTHON_BIN"         { $script:PythonBin        = $value }
                "INDEXTTS_MODEL_DIR" { $script:IndexTTSModelDir = $value }
                "ENABLE_LOCAL_TTS"   { $script:EnableLocalTTS   = $value }
                "ENABLE_LOCAL_ASR"   { $script:EnableLocalASR   = $value }
            }
        }
        return $true
    }
    catch {
        Warn "读取 $PathsEnv 时出错：$_"
        return $false
    }
}

function LoadPathsEnv {
    <#
    Business Logic: 硬加载 .runtime/paths.env，缺失时报错退出，供 start/restart 调用
    Code Logic: 调用 TryLoadPathsEnv，若返回 $false 则打印提示并 exit 1
    #>
    $ok = TryLoadPathsEnv
    if (-not $ok) {
        ErrorMsg ".runtime/paths.env 不存在，请先运行："
        Write-Host "  .\install.ps1"
        exit 1
    }
}

# ─────────────────────────────── 读取 config.json ───────────────────────────

function LoadConfig {
    <#
    Business Logic: 从 webapp/config/config.json 读取 tts.type 和 asr.type，
                    不存在时默认 local，等价 bash load_config()
    Code Logic: 用 ConvertFrom-Json 解析 JSON，捕获异常时回退默认值
    #>
    if (Test-Path $ConfigFile) {
        try {
            $raw = Get-Content -Path $ConfigFile -Raw -Encoding UTF8
            $cfg = $raw | ConvertFrom-Json
            # 安全访问嵌套属性，不存在时回退 local
            $tts = $cfg.tts
            $asr = $cfg.asr
            $script:TtsType = if ($tts -and $tts.type) { $tts.type } else { "local" }
            $script:AsrType = if ($asr -and $asr.type) { $asr.type } else { "local" }
        }
        catch {
            Warn "解析 config.json 失败，使用默认值（tts=local, asr=local）：$_"
            $script:TtsType = "local"
            $script:AsrType = "local"
        }
    }
    else {
        # config.json 在 webapp 首次启动时自动创建，这里用默认值
        $script:TtsType = "local"
        $script:AsrType = "local"
    }
}

# ─────────────────────────────── 进程管理辅助 ───────────────────────────────

function Get-PidFile {
    <#
    Business Logic: 返回指定服务的 PID 文件路径，等价 bash pid_file()
    Code Logic: Join-Path 拼接 PidsDir 和服务名
    #>
    param([string]$Name)
    return Join-Path $PidsDir "$Name.pid"
}

function Get-LogFile {
    <#
    Business Logic: 返回指定服务的标准输出日志路径，等价 bash log_file()
    Code Logic: Join-Path 拼接 LogsDir 和服务名（stdout）
    #>
    param([string]$Name)
    return Join-Path $LogsDir "$Name.log"
}

function Get-ErrLogFile {
    <#
    Business Logic: 返回指定服务的标准错误日志路径
    Code Logic: PowerShell Start-Process 不能将 stdout/stderr 重定向到同一文件，
                所以 stderr 单独放 .err.log，logs 子命令同时跟踪两个文件
    #>
    param([string]$Name)
    return Join-Path $LogsDir "$Name.err.log"
}

function Get-StoredPid {
    <#
    Business Logic: 读取 pidfile 中存储的 PID 值，等价 bash get_pid()
    Code Logic: 读文件内容并转为整数，文件不存在或内容无效时返回 0
    #>
    param([string]$Name)
    $pidFile = Get-PidFile $Name
    if (-not (Test-Path $pidFile)) { return 0 }
    try {
        $content = (Get-Content -Path $pidFile -Raw).Trim()
        if ($content -match '^\d+$') { return [int]$content }
    }
    catch { }
    return 0
}

function Test-ServiceRunning {
    <#
    Business Logic: 判断命名服务进程是否还活着，等价 bash is_running()
    Code Logic:
        1. 读 pidfile 拿 PID，为 0 则视为未运行
        2. 用 Get-Process -Id 查进程是否存在
        3. 附加校验：进程名含 "python"（降低 PID 复用误判概率）
        注意：Windows PID 会被复用，Get-Process 成功不等于是我们的进程；
              所以同时检查 ProcessName 包含 python 做二次确认
    #>
    param([string]$Name)
    $pid = Get-StoredPid $Name
    if ($pid -eq 0) { return $false }
    try {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($null -eq $proc) { return $false }
        # 校验进程名含 python，防止 PID 复用误判
        if ($proc.ProcessName -notmatch "python") { return $false }
        return $true
    }
    catch {
        return $false
    }
}

function Wait-ForPort {
    <#
    Business Logic: 轮询等待指定端口 HTTP 服务就绪，等价 bash wait_for_port()
    Code Logic:
        依次尝试 /、/healthz、/health 三个端点；
        用 Invoke-WebRequest 捕获连接异常（非 2xx 也算「端口已开」）；
        每秒轮询，超时返回 $false
    #>
    param(
        [int]$Port,
        [int]$TimeoutSec = 30
    )
    $endpoints = @("/", "/healthz", "/health")
    $elapsed = 0
    while ($elapsed -lt $TimeoutSec) {
        foreach ($ep in $endpoints) {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port$ep" `
                    -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
                # 任意 HTTP 响应（含 4xx）都表示端口已开
                return $true
            }
            catch {
                # 区分"连接被拒绝"与"HTTP 错误"——HTTP 错误表明服务已在监听
                $exMsg = $_.Exception.Message
                if ($exMsg -match "4\d\d|5\d\d|Unauthorized|Forbidden|Not Found") {
                    return $true
                }
                # 连接拒绝/超时：继续等待
            }
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    return $false
}

function Stop-Service {
    <#
    Business Logic: 停止命名服务进程，等价 bash kill_service()
    Code Logic:
        1. 若 pidfile 存在且进程活着，先 Stop-Process（优雅），等 5 秒，
           仍存活则 Stop-Process -Force（强杀）
        2. 兜底：用 Get-NetTCPConnection 查端口残留进程强杀
        3. 最后删除 pidfile
    #>
    param(
        [string]$Name,
        [int]$Port
    )
    $pidFile = Get-PidFile $Name
    $storedPid = Get-StoredPid $Name

    if (Test-ServiceRunning $Name) {
        Info "停止 $Name (PID $storedPid)..."
        try {
            Stop-Process -Id $storedPid -ErrorAction SilentlyContinue
        }
        catch { }

        # 等待最多 5 秒
        $i = 0
        while ($i -lt 5) {
            Start-Sleep -Seconds 1
            $i++
            $proc = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
            if ($null -eq $proc) { break }
        }

        # 仍存活则强杀
        $proc = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            Warn "$Name 未在 5 秒内退出，强制 Kill..."
            try { Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue } catch { }
        }
        Success "$Name 已停止"
    }

    # 兜底：用端口查残留进程
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conns) {
            $ownerPids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($opid in $ownerPids) {
                if ($opid -gt 0) {
                    $leftover = Get-Process -Id $opid -ErrorAction SilentlyContinue
                    if ($null -ne $leftover) {
                        Warn "端口 $Port 仍有进程残留 (PID $opid)，强制清理..."
                        try { Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue } catch { }
                    }
                }
            }
        }
    }
    catch { }

    # 清空 PID 文件
    if (Test-Path $pidFile) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

function Start-BackgroundService {
    <#
    Business Logic: 以后台无窗口方式启动 Python 服务并记录 PID，等价 bash nohup 启动
    Code Logic:
        用 Start-Process 的 -WindowStyle Hidden 实现后台运行；
        stdout → $Name.log，stderr → $Name.err.log（分两文件，避免 PowerShell 写锁冲突）；
        -PassThru 拿到进程对象，PID 写入 pidfile
    #>
    param(
        [string]$Name,
        [string]$ScriptPath,
        [hashtable]$EnvVars = @{}
    )
    $logFile    = Get-LogFile $Name
    $errLogFile = Get-ErrLogFile $Name

    # 设置子进程环境变量（继承父进程 env，再叠加本次额外变量）
    $savedEnv = @{}
    foreach ($k in $EnvVars.Keys) {
        $savedEnv[$k] = [System.Environment]::GetEnvironmentVariable($k)
        [System.Environment]::SetEnvironmentVariable($k, $EnvVars[$k])
    }

    try {
        $proc = Start-Process `
            -FilePath       $script:PythonBin `
            -ArgumentList   $ScriptPath `
            -WorkingDirectory $RepoRoot `
            -WindowStyle    Hidden `
            -RedirectStandardOutput $logFile `
            -RedirectStandardError  $errLogFile `
            -PassThru

        $pidFile = Get-PidFile $Name
        Set-Content -Path $pidFile -Value $proc.Id -NoNewline -Encoding ASCII
        return $proc.Id
    }
    finally {
        # 恢复环境变量（避免污染父进程后续操作）
        foreach ($k in $savedEnv.Keys) {
            $v = $savedEnv[$k]
            if ($null -eq $v) {
                [System.Environment]::SetEnvironmentVariable($k, "")
            }
            else {
                [System.Environment]::SetEnvironmentVariable($k, $v)
            }
        }
    }
}

# =============================================================================
# 子命令：start
# =============================================================================
function Invoke-Start {
    <#
    Business Logic: 启动所有需要的服务，等价 bash cmd_start()
    Code Logic:
        1. 硬加载 paths.env，校验 PYTHON_BIN 可执行
        2. 按配置决定是否启动 tts_service(9800) 和 asr_service(9900)
        3. 始终启动 webapp(9880)
        4. 健康探活：webapp 等 60 秒，asr 等 30 秒，tts 等 120 秒
    #>
    Hr
    Bold "        EmotionTTS 启动中..."
    Hr
    Write-Host ""

    LoadPathsEnv
    LoadConfig

    # 确保运行时目录存在
    New-Item -ItemType Directory -Force -Path $PidsDir | Out-Null
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

    # 校验 PYTHON_BIN
    if ([string]::IsNullOrEmpty($script:PythonBin) -or -not (Test-Path $script:PythonBin)) {
        ErrorMsg "PYTHON_BIN 无效: $(if($script:PythonBin){'$($script:PythonBin)'}else{'（未设置）'})"
        Write-Host "  请重新运行：.\install.ps1"
        exit 1
    }

    # ── 启动 tts_service（端口 9800） ─────────────────────────────────────────
    if ($script:EnableLocalTTS -eq "true" -and $script:TtsType -eq "local") {
        if (Test-ServiceRunning "tts") {
            $tpid = Get-StoredPid "tts"
            Warn "tts_service 已在运行 (PID $tpid)，跳过启动（如需重启请用 restart）"
        }
        else {
            Info "启动 tts_service（端口 9800）..."
            $modelDir = if ($script:IndexTTSModelDir) { $script:IndexTTSModelDir } else { "" }
            if ([string]::IsNullOrEmpty($modelDir)) {
                Warn "INDEXTTS_MODEL_DIR 未配置，tts_service 可能无法加载模型"
            }
            $envVars = @{}
            if (-not [string]::IsNullOrEmpty($modelDir)) {
                $envVars["INDEXTTS_MODEL_DIR"] = $modelDir
            }
            $ttsScript = Join-Path $RepoRoot "tts_service\server.py"
            $newPid = Start-BackgroundService -Name "tts" -ScriptPath $ttsScript -EnvVars $envVars
            $ttsLog = Get-LogFile "tts"
            Success "tts_service 已启动 (PID $newPid)，日志: $ttsLog"
        }
    }

    # ── 启动 asr_service（端口 9900） ─────────────────────────────────────────
    if ($script:EnableLocalASR -eq "true" -and $script:AsrType -eq "local") {
        if (Test-ServiceRunning "asr") {
            $apid = Get-StoredPid "asr"
            Warn "asr_service 已在运行 (PID $apid)，跳过启动（如需重启请用 restart）"
        }
        else {
            Info "启动 asr_service（端口 9900）..."
            $whisperDir = Join-Path $RepoRoot "models\whisper-small"
            $envVars = @{ "WHISPER_MODEL_DIR" = $whisperDir }
            $asrScript = Join-Path $RepoRoot "asr_service\server.py"
            $newPid = Start-BackgroundService -Name "asr" -ScriptPath $asrScript -EnvVars $envVars
            $asrLog = Get-LogFile "asr"
            Success "asr_service 已启动 (PID $newPid)，日志: $asrLog"
        }
    }

    # ── 启动 webapp（端口 9880，始终启动） ───────────────────────────────────
    if (Test-ServiceRunning "webapp") {
        $wpid = Get-StoredPid "webapp"
        Warn "webapp 已在运行 (PID $wpid)，跳过启动（如需重启请用 restart）"
    }
    else {
        Info "启动 webapp（端口 9880）..."
        $webScript = Join-Path $RepoRoot "main.py"
        $newPid = Start-BackgroundService -Name "webapp" -ScriptPath $webScript
        $webLog = Get-LogFile "webapp"
        Success "webapp 已启动 (PID $newPid)，日志: $webLog"
    }

    # ── 健康探活 ─────────────────────────────────────────────────────────────
    Write-Host ""
    Info "等待服务就绪（最多 60 秒）..."

    $webappOk = $false
    $asrOk    = $false
    $ttsOk    = $false

    # webapp
    Info "探活 webapp:9880 ..."
    if (Wait-ForPort -Port 9880 -TimeoutSec 60) {
        Success "webapp 已就绪: http://127.0.0.1:9880"
        $webappOk = $true
    }
    else {
        Warn "webapp 未在 60 秒内响应，请检查日志：$(Get-LogFile 'webapp')"
    }

    # asr_service
    if ($script:EnableLocalASR -eq "true" -and $script:AsrType -eq "local") {
        Info "探活 asr_service:9900 ..."
        if (Wait-ForPort -Port 9900 -TimeoutSec 30) {
            Success "asr_service 已就绪: http://127.0.0.1:9900"
            $asrOk = $true
        }
        else {
            Warn "asr_service 未在 30 秒内响应（Whisper 首次加载需要时间），请检查日志：$(Get-LogFile 'asr')"
        }
    }

    # tts_service（首次加载模型很慢，等更长时间）
    if ($script:EnableLocalTTS -eq "true" -and $script:TtsType -eq "local") {
        Info "探活 tts_service:9800 ..."
        if (Wait-ForPort -Port 9800 -TimeoutSec 120) {
            Success "tts_service 已就绪: http://127.0.0.1:9800"
            $ttsOk = $true
        }
        else {
            Warn "tts_service 未在 120 秒内响应（IndexTTS2 首次加载可能需要更长时间）"
            Warn "请稍后用 .\start.ps1 status 检查状态，或查看日志：$(Get-LogFile 'tts')"
        }
    }

    Write-Host ""
    Hr
    if ($webappOk) {
        Success "启动完成！"
        Write-Host ""
        Write-Host "  " -NoNewline
        Write-Host "访问地址: " -NoNewline -ForegroundColor White
        Write-Host "http://127.0.0.1:9880" -ForegroundColor Cyan
    }
    else {
        Warn "webapp 可能尚未完全启动，请稍后访问 http://127.0.0.1:9880"
    }
    Write-Host ""
    Write-Host "  .\start.ps1 status   # 查看服务状态"
    Write-Host "  .\start.ps1 logs     # 查看日志"
    Write-Host "  .\start.ps1 stop     # 停止所有服务"
    Hr
}

# =============================================================================
# 子命令：status
# =============================================================================
function Invoke-Status {
    <#
    Business Logic: 打印各服务当前运行状态表格，等价 bash cmd_status()
    Code Logic:
        软加载 paths.env（失败不退出），从 config.json 读模式；
        对每个服务调用 Print-ServiceRow 输出一行彩色状态
    #>
    TryLoadPathsEnv | Out-Null
    LoadConfig

    Write-Host ""
    Bold "EmotionTTS 服务状态"
    Hr
    # 表头（固定宽度）
    Write-Host ("{0,-12} {1,-6} {2,-12} {3,-8} {4}" -f "SERVICE", "PORT", "PID", "STATUS", "LOG")
    Hr

    # 内部辅助：打印单行
    function Print-ServiceRow {
        <#
        Business Logic: 输出一个服务的状态行，RUN=绿/DEAD=红/OFF=黄/CLOUD=青
        Code Logic: 检查进程存活，拼接固定宽度字段，用 Write-Host 着色输出 STATUS 列
        #>
        param(
            [string]$Name,
            [string]$Port,
            [string]$DisplayName
        )
        $storedPid = Get-StoredPid $Name
        $pidStr    = "-"
        $logStr    = "-"
        $statusTxt = "OFF"
        $statusClr = "Yellow"

        if (Test-ServiceRunning $Name) {
            $pidStr    = "$storedPid"
            $statusTxt = "RUN"
            $statusClr = "Green"
            $logStr    = Get-LogFile $Name
        }
        elseif ($storedPid -gt 0) {
            $pidStr    = "${storedPid}(dead)"
            $statusTxt = "DEAD"
            $statusClr = "Red"
        }

        # 输出固定宽度前三列
        Write-Host ("{0,-12} {1,-6} {2,-12} " -f $DisplayName, $Port, $pidStr) -NoNewline
        # STATUS 列着色
        Write-Host ("{0,-8}" -f $statusTxt) -ForegroundColor $statusClr -NoNewline
        Write-Host $logStr
    }

    # webapp 始终显示
    Print-ServiceRow -Name "webapp" -Port "9880" -DisplayName "webapp"

    # asr_service
    if ($script:EnableLocalASR -eq "true") {
        Print-ServiceRow -Name "asr" -Port "9900" -DisplayName "asr_svc"
    }
    else {
        Write-Host ("{0,-12} {1,-6} {2,-12} " -f "asr_svc", "9900", "-") -NoNewline
        Write-Host ("{0,-8}" -f "CLOUD") -ForegroundColor Cyan -NoNewline
        Write-Host "(云端 API 模式)"
    }

    # tts_service
    if ($script:EnableLocalTTS -eq "true") {
        Print-ServiceRow -Name "tts" -Port "9800" -DisplayName "tts_svc"
    }
    else {
        Write-Host ("{0,-12} {1,-6} {2,-12} " -f "tts_svc", "9800", "-") -NoNewline
        Write-Host ("{0,-8}" -f "CLOUD") -ForegroundColor Cyan -NoNewline
        Write-Host "(云端 API 模式)"
    }

    Hr
    Write-Host ""
}

# =============================================================================
# 子命令：stop
# =============================================================================
function Invoke-Stop {
    <#
    Business Logic: 停止所有正在运行的服务，等价 bash cmd_stop()
    Code Logic: 软加载 paths.env（失败不退出），按依赖倒序停止：webapp → asr → tts
    #>
    TryLoadPathsEnv | Out-Null
    LoadConfig

    Hr
    Info "停止所有服务..."
    Hr

    # 按依赖倒序停：先 webapp，再 asr，再 tts
    Stop-Service -Name "webapp" -Port 9880

    if ($script:EnableLocalASR -eq "true") {
        Stop-Service -Name "asr" -Port 9900
    }

    if ($script:EnableLocalTTS -eq "true") {
        Stop-Service -Name "tts" -Port 9800
    }

    Success "所有服务已停止"
    Hr
}

# =============================================================================
# 子命令：restart
# =============================================================================
function Invoke-Restart {
    <#
    Business Logic: 重启所有服务，等价 bash cmd_restart()
    Code Logic: 依次调用 Invoke-Stop 和 Invoke-Start
    #>
    Invoke-Stop
    Write-Host ""
    Invoke-Start
}

# =============================================================================
# 子命令：logs
# =============================================================================
function Invoke-Logs {
    <#
    Business Logic: 实时跟踪服务日志，等价 bash cmd_logs()
    Code Logic:
        单个目标（webapp/asr/tts）：同时用 Start-Job 跟踪 .log 和 .err.log 两个文件，
            主进程轮询 Receive-Job 输出，Ctrl+C 时清理 Job
        all 目标：为每个存在的日志文件各启动一个 Start-Job，最多 6 个 Job（3 服务×2文件），
            主进程同样轮询直到 Ctrl+C
        多 Job 方案是 PowerShell 下实现 multi-tail 的惯用做法
    #>
    param([string]$Target = "webapp")

    # 辅助：起一组 job 跟踪日志文件列表，然后进入轮询循环
    function Start-TailJobs {
        param([string[]]$LogFiles, [string]$Label)

        $existingFiles = @()
        foreach ($f in $LogFiles) {
            if (Test-Path $f) {
                $existingFiles += $f
            }
        }
        if ($existingFiles.Count -eq 0) {
            Warn "没有找到任何日志文件（服务尚未启动？）"
            return
        }

        Bold "=== $Label 日志 ==="
        Write-Host "跟踪文件：$($existingFiles -join ', ')" -ForegroundColor Cyan
        Write-Host "按 Ctrl+C 停止跟踪" -ForegroundColor Yellow
        Write-Host ""

        $jobs = @()
        foreach ($f in $existingFiles) {
            $capturedF = $f   # 闭包捕获
            $jobs += Start-Job -ScriptBlock {
                param($path)
                Get-Content -Path $path -Wait -Tail 50
            } -ArgumentList $capturedF
        }

        try {
            while ($true) {
                foreach ($job in $jobs) {
                    $output = Receive-Job -Job $job 2>$null
                    if ($output) {
                        foreach ($line in $output) {
                            Write-Host $line
                        }
                    }
                }
                Start-Sleep -Milliseconds 300
            }
        }
        finally {
            # Ctrl+C 或异常：清理 jobs
            foreach ($job in $jobs) {
                Stop-Job  -Job $job  -ErrorAction SilentlyContinue
                Remove-Job -Job $job -ErrorAction SilentlyContinue
            }
        }
    }

    switch ($Target.ToLower()) {
        { $_ -in @("webapp", "web") } {
            $logFiles = @(
                (Get-LogFile    "webapp"),
                (Get-ErrLogFile "webapp")
            )
            Start-TailJobs -LogFiles $logFiles -Label "webapp"
        }
        "asr" {
            $logFiles = @(
                (Get-LogFile    "asr"),
                (Get-ErrLogFile "asr")
            )
            Start-TailJobs -LogFiles $logFiles -Label "asr_service"
        }
        "tts" {
            $logFiles = @(
                (Get-LogFile    "tts"),
                (Get-ErrLogFile "tts")
            )
            Start-TailJobs -LogFiles $logFiles -Label "tts_service"
        }
        "all" {
            $logFiles = @(
                (Get-LogFile    "webapp"),
                (Get-ErrLogFile "webapp"),
                (Get-LogFile    "asr"),
                (Get-ErrLogFile "asr"),
                (Get-LogFile    "tts"),
                (Get-ErrLogFile "tts")
            )
            Start-TailJobs -LogFiles $logFiles -Label "所有服务"
        }
        default {
            ErrorMsg "未知目标：$Target"
            Write-Host "  可用：webapp | asr | tts | all"
            exit 1
        }
    }
}

# =============================================================================
# --help
# =============================================================================
function Show-Help {
    <#
    Business Logic: 打印完整帮助信息，等价 bash --help 分支
    Code Logic: Write-Host 静态文本
    #>
    Bold "EmotionTTS 一键启动脚本（Windows PowerShell 版）"
    Write-Host ""
    Write-Host "用法："
    Write-Host "  .\start.ps1                              启动所有需要的服务"
    Write-Host "  .\start.ps1 start                        启动所有需要的服务"
    Write-Host "  .\start.ps1 status                       查看各服务状态"
    Write-Host "  .\start.ps1 stop                         停止所有服务"
    Write-Host "  .\start.ps1 restart                      重启所有服务"
    Write-Host "  .\start.ps1 logs [webapp|asr|tts|all]    查看日志（默认 webapp）"
    Write-Host "  .\start.ps1 --help                       显示此帮助"
    Write-Host ""
    Write-Host "服务端口："
    Write-Host "  webapp     9880   Web 中枢（始终启动）"
    Write-Host "  asr_svc    9900   本地 Whisper ASR（按配置启动）"
    Write-Host "  tts_svc    9800   本地 IndexTTS2（按配置启动）"
    Write-Host ""
    Write-Host "日志文件："
    Write-Host "  .runtime\logs\webapp.log / webapp.err.log"
    Write-Host "  .runtime\logs\asr.log    / asr.err.log"
    Write-Host "  .runtime\logs\tts.log    / tts.err.log"
    Write-Host ""
    Write-Host "前置条件：先运行 .\install.ps1"
}

# =============================================================================
# 入口路由
# =============================================================================
$subcommand = if ($args.Count -gt 0) { $args[0] } else { "start" }

switch ($subcommand) {
    { $_ -in @("--help", "-h") } {
        Show-Help
        exit 0
    }
    "start"   { Invoke-Start }
    "status"  { Invoke-Status }
    "stop"    { Invoke-Stop }
    "restart" { Invoke-Restart }
    "logs"    {
        $logsTarget = if ($args.Count -gt 1) { $args[1] } else { "webapp" }
        Invoke-Logs -Target $logsTarget
    }
    default {
        ErrorMsg "未知子命令：$subcommand"
        Write-Host "  可用子命令：start | status | stop | restart | logs"
        Write-Host "  运行 .\start.ps1 --help 查看完整用法"
        exit 1
    }
}
