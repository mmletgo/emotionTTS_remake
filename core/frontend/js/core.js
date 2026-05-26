let pollInterval = null;
let globalCharacters = [];
let previewAudioObj = new Audio();
let currentCharGridTarget = 'single';

let currentLlmConfigs = {};
let currentActiveLlmType = 'ollama';

let currentPreviewUrl = '';

const tunnelHeaders = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '69420', 'Bypass-Tunnel-Reminder': 'true' };
const EMO_PRIMARIES = ["喜", "怒", "哀", "惧", "惊", "厌", "平"];
const EMO_INTENSITIES = ["Low", "Medium", "High"];

document.addEventListener('DOMContentLoaded', () => {
    checkConfigStatus();
    loadCharacters();

    // 监听音频的暂停与结束事件，安全重置所有的 UI 按钮
    previewAudioObj.addEventListener('ended', resetAllPlayButtons);
    previewAudioObj.addEventListener('pause', resetAllPlayButtons);

    // 🌟 初始化动态加载帮助说明视频与外部跳转的链接
    if (typeof HELP_LINKS !== 'undefined') {
        const linkConfig = document.getElementById('helpLinkConfig');
        if (linkConfig) linkConfig.href = HELP_LINKS.config;

        const linkSingle = document.getElementById('helpLinkSingle');
        if (linkSingle) linkSingle.href = HELP_LINKS.single;

        const linkLong = document.getElementById('helpLinkLong');
        if (linkLong) linkLong.href = HELP_LINKS.long;

        const linkChar = document.getElementById('helpLinkChar');
        if (linkChar) linkChar.href = HELP_LINKS.character;

        // 🌟 新增：绑定线上角色库的跳转链接
        const linkOnline = document.getElementById('helpLinkOnlineLibrary');
        if (linkOnline) linkOnline.href = HELP_LINKS.online_library;
    }
});

function resetAllPlayButtons() {
    document.querySelectorAll('.play-overlay-btn').forEach(btn => {
        btn.classList.remove('playing');
        btn.innerHTML = '▶';
    });
    document.querySelectorAll('.play-preview-btn').forEach(btn => {
        btn.classList.remove('playing');
        btn.innerHTML = '▶ 试听音色';
    });
}

function playPreview(url, event, btnElement) {
    if (event) event.stopPropagation();

    if (!url || url === 'null' || url === 'undefined') {
        alert("尚未处理出有效音频！");
        return;
    }

    if (currentPreviewUrl === url) {
        if (!previewAudioObj.paused) {
            previewAudioObj.pause();
        } else {
            resetAllPlayButtons();
            previewAudioObj.play().then(() => {
                if (btnElement) {
                    btnElement.classList.add('playing');
                    btnElement.innerHTML = btnElement.classList.contains('play-overlay-btn') ? '⏸' : '⏸ 暂停音色';
                }
            }).catch(e => console.error("恢复播放失败:", e));
        }
        return;
    }

    currentPreviewUrl = url;
    previewAudioObj.src = url;
    resetAllPlayButtons();

    previewAudioObj.play().then(() => {
        if (btnElement) {
            btnElement.classList.add('playing');
            btnElement.innerHTML = btnElement.classList.contains('play-overlay-btn') ? '⏸' : '⏸ 暂停音色';
        }
    }).catch(e => {
        console.error("播放音频失败:", e);
        currentPreviewUrl = '';
        alert("音频播放失败，可能文件已被删除或损坏！");
    });
}

function handleLlmTypeChange() {
    if (currentLlmConfigs[currentActiveLlmType]) {
        currentLlmConfigs[currentActiveLlmType].api_base = document.getElementById('llmBaseUrl').value.trim();
        currentLlmConfigs[currentActiveLlmType].api_key = document.getElementById('llmApiKey').value.trim();
        currentLlmConfigs[currentActiveLlmType].model = document.getElementById('llmModel').value.trim();
    }

    currentActiveLlmType = document.getElementById('llmType').value;
    renderLlmInputs();
}

function renderLlmInputs() {
    const cfg = currentLlmConfigs[currentActiveLlmType] || { api_base: "", api_key: "", model: "" };

    let base = cfg.api_base || "";
    let key = cfg.api_key || "";
    let model = cfg.model || "";

    const promoLink = document.getElementById('llmPromoLink');
    const apiKeyGroup = document.getElementById('llmApiKeyGroup');

    // 🌟 核心修复：根据当前选中的 LLM 类型，动态展示专属文案并补全默认值
    if (currentActiveLlmType === 'siliconflow') {
        if (!base) base = 'https://api.siliconflow.cn/v1';
        if (!model) model = 'deepseek-ai/DeepSeek-V3.2';
        if (promoLink) promoLink.style.display = 'none';
        if (apiKeyGroup) apiKeyGroup.style.display = 'block';
    } else if (currentActiveLlmType === 'youzhi') {
        if (!base) base = 'https://api.modelverse.cn/v1';
        if (!model) model = 'deepseek-chat';
        if (promoLink) promoLink.style.display = 'none';
        if (apiKeyGroup) apiKeyGroup.style.display = 'block';
    } else if (currentActiveLlmType === 'deepseek') {
        if (!base) base = 'https://api.deepseek.com/v1';
        if (!model) model = 'deepseek-chat';
        if (promoLink) promoLink.style.display = 'none';
        if (apiKeyGroup) apiKeyGroup.style.display = 'block';
    } else if (currentActiveLlmType === 'ollama') {
        if (!base) base = 'http://127.0.0.1:11434/v1';
        if (!model) model = 'qwen2.5:7b';
        if (promoLink) promoLink.style.display = 'none';
        if (apiKeyGroup) apiKeyGroup.style.display = 'none';
    } else {
        if (promoLink) promoLink.style.display = 'none';
        if (apiKeyGroup) apiKeyGroup.style.display = 'block';
    }

    // 统一赋值到页面
    document.getElementById('llmBaseUrl').value = base;
    document.getElementById('llmApiKey').value = key;
    document.getElementById('llmModel').value = model;
}

function handleTtsTypeChange() {
    const type = document.getElementById('ttsType').value;
    if (type === 'cloud') {
        document.getElementById('ttsCloudConfig').style.display = 'block';
        document.getElementById('ttsLocalConfig').style.display = 'none';
    } else {
        document.getElementById('ttsCloudConfig').style.display = 'none';
        document.getElementById('ttsLocalConfig').style.display = 'block';
    }
}

async function checkConfigStatus() {
    const badge = document.getElementById('keyStatusBadge');
    if (!badge) return;
    badge.className = "badge badge-gray";
    badge.innerText = "⏳ 检测中...";

    try {
        const confRes = await fetch('/api/config', { headers: tunnelHeaders });
        const confData = await confRes.json();
        const cfg = confData.config;

        if (cfg.llm && cfg.llm.configs) {
            currentLlmConfigs = cfg.llm.configs;
            currentActiveLlmType = cfg.llm.active_type || 'ollama';
            if (document.getElementById('llmType')) {
                document.getElementById('llmType').value = currentActiveLlmType;
            }
            renderLlmInputs();
        }

        if (document.getElementById('ttsType')) document.getElementById('ttsType').value = cfg.tts.type || 'local';
        if (document.getElementById('ttsApiBase')) {
            document.getElementById('ttsApiBase').value = cfg.tts.api_base || '';
        }
        if (document.getElementById('ttsApiKey')) {
            document.getElementById('ttsApiKey').value = cfg.tts.api_key || '';
        }

        handleTtsTypeChange();

        const resVerify = await fetch('/api/config/verify_active', { headers: tunnelHeaders });
        const verifyData = await resVerify.json();

        if (verifyData.status === 'success') {
            badge.className = "badge badge-green";
            badge.innerText = "🟢 已连接";
        } else {
            badge.className = "badge badge-red";
            let errs = [];
            if (verifyData.llm_status === 'error') errs.push('大模型异常');
            if (verifyData.tts_status === 'error') errs.push('引擎异常');
            badge.innerText = "🔴 " + (errs.join(" + ") || "配置校验失败");
        }
    } catch (e) {
        badge.className = "badge badge-red";
        badge.innerText = "服务连接异常";
        console.error("配置校验过程出错：", e);
    }
}

function openModal() {
    document.getElementById('configModal').style.display = 'flex';
    document.getElementById('verifyMsg').innerText = "";
}

function closeModal() {
    document.getElementById('configModal').style.display = 'none';
}

async function verifyAndSaveKey() {
    const msgBox = document.getElementById('verifyMsg');
    const btn = document.getElementById('verifyBtn');

    currentActiveLlmType = document.getElementById('llmType').value;
    if (!currentLlmConfigs[currentActiveLlmType]) currentLlmConfigs[currentActiveLlmType] = {};

    currentLlmConfigs[currentActiveLlmType].api_base = document.getElementById('llmBaseUrl').value.trim();
    currentLlmConfigs[currentActiveLlmType].api_key = document.getElementById('llmApiKey').value.trim();
    currentLlmConfigs[currentActiveLlmType].model = document.getElementById('llmModel').value.trim();

    const ttsType = document.getElementById('ttsType').value;
    const ttsApiBaseEl = document.getElementById('ttsApiBase');
    const ttsApiKeyEl = document.getElementById('ttsApiKey');
    const payload = {
        llm_active_type: currentActiveLlmType,
        llm_configs: currentLlmConfigs,
        tts: {
            type: ttsType,
            api_base: ttsApiBaseEl ? ttsApiBaseEl.value.trim() : '',
            api_key: ttsApiKeyEl ? ttsApiKeyEl.value.trim() : ''
        }
    };

    msgBox.style.color = "#3498db";
    msgBox.innerText = "⏳ 正在双路并发执行网络探活校验...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/config/validate', {
            method: 'POST',
            headers: tunnelHeaders,
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            msgBox.style.color = "#2ecc71";
            msgBox.innerText = "✅ " + data.msg;
            setTimeout(() => {
                closeModal();
                checkConfigStatus();
            }, 2000);
        } else {
            msgBox.style.color = "#e74c3c";
            msgBox.innerText = "❌ " + (data.detail || "校验保存失败");
        }
    } catch (e) {
        msgBox.style.color = "#e74c3c";
        msgBox.innerText = "❌ 网络异常，无法连接到服务端";
    } finally {
        btn.disabled = false;
    }
}

function switchTab(tabId, evt) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    if (evt && evt.currentTarget && evt.currentTarget.classList) {
        evt.currentTarget.classList.add('active');
    }
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    if (tabId === 'configTab' && typeof showList === 'function') showList();
}

function renderAvatarHTML(char, sizeClass = '') {
    if (char && char.avatar) return `<img src="${char.avatar}?t=${Date.now()}" class="avatar ${sizeClass}" alt="${char.name}">`;
    const firstChar = (char && char.name) ? char.name.charAt(0) : '?';
    return `<div class="default-avatar ${sizeClass}">${firstChar}</div>`;
}

function getCharAvatarStr(charId) {
    const char = globalCharacters.find(c => c.id === charId);
    return char ? (char.avatar ? `${char.avatar}?t=${Date.now()}` : null) : null;
}

async function loadCharacters() {
    try {
        const res = await fetch('/api/characters', { headers: tunnelHeaders });
        globalCharacters = await res.json();

        if (typeof refreshLibraryList === 'function') refreshLibraryList();

        const singleInput = document.getElementById('charSelect');
        if (singleInput) {
            if (globalCharacters.length > 0 && !globalCharacters.find(c => c.id == singleInput.value)) {
                selectCharacter(globalCharacters[0].id, 'single');
            } else if (globalCharacters.length > 0) {
                selectCharacter(singleInput.value, 'single');
            } else {
                singleInput.value = "";
                const display = document.getElementById('selectedCharDisplay');
                if (display) display.innerHTML = `<div class="default-avatar">?</div><div class="char-name-audio"><span class="name">无可用角色</span></div>`;
            }
        }

        const longInput = document.getElementById('longCharSelect');
        if (longInput) {
            if (globalCharacters.length > 0 && !globalCharacters.find(c => c.id == longInput.value)) {
                selectCharacter(globalCharacters[0].id, 'long_global');
            } else if (globalCharacters.length > 0) {
                selectCharacter(longInput.value, 'long_global');
            } else {
                longInput.value = "";
                const longDisplay = document.getElementById('longGlobalCharDisplay');
                if (longDisplay) longDisplay.innerHTML = `<div class="default-avatar">?</div><div class="char-name-audio"><span class="name">无可用角色</span></div>`;
            }
        }

    } catch (e) {
        console.error("加载角色库失败", e);
    }
}

function openCharGridModal(target = 'single') {
    if (globalCharacters.length === 0) return alert("无可用角色！请先在角色库中创建。");
    currentCharGridTarget = target;
    const container = document.getElementById('charGridContainer');
    const searchInput = document.getElementById('charSearchInput');
    if (searchInput) searchInput.value = "";

    let currentVal = '';
    if (target === 'single') {
        const sel = document.getElementById('charSelect');
        if (sel) currentVal = sel.value;
    } else if (target === 'long_global') {
        const lSel = document.getElementById('longCharSelect');
        if (lSel) currentVal = lSel.value;
    }

    if (container) {
        container.innerHTML = globalCharacters.map(c => `
            <div class="char-grid-item ${c.id === currentVal ? 'selected' : ''}" data-name="${c.name}" onclick="selectCharacter('${c.id}', '${target}')" title="${c.name}">
                <div class="avatar-wrapper">
                    ${renderAvatarHTML(c, 'avatar-lg')}
                    <button class="play-overlay-btn" onclick="playPreview('${c.preview_audio}', event, this)" ${!c.preview_audio ? 'disabled' : ''} title="试听">▶</button>
                </div>
                <span class="name">${c.name}</span>
            </div>`).join('');
    }

    const modal = document.getElementById('charGridModal');
    if (modal) modal.style.display = 'flex';
}

function closeCharGridModal() {
    const modal = document.getElementById('charGridModal');
    if (modal) modal.style.display = 'none';
    previewAudioObj.pause();
}

function selectCharacter(charId, target = currentCharGridTarget) {
    const char = globalCharacters.find(c => c.id == charId);
    if (!char) return;

    if (target === 'single') {
        const sel = document.getElementById('charSelect');
        const disp = document.getElementById('selectedCharDisplay');
        if (sel) sel.value = char.id;
        if (disp) disp.innerHTML = `${renderAvatarHTML(char)}<div class="char-name-audio"><span class="name">${char.name}</span><button class="play-preview-btn" onclick="playPreview('${char.preview_audio}', event, this)" ${!char.preview_audio ? 'disabled' : ''}>▶ 试听音色</button></div>`;
        if (typeof clearSingleSynthState === 'function') clearSingleSynthState();
    }
    else if (target === 'long_global') {
        const lSel = document.getElementById('longCharSelect');
        const lDisp = document.getElementById('longGlobalCharDisplay');
        if (lSel) lSel.value = char.id;
        if (lDisp) lDisp.innerHTML = `${renderAvatarHTML(char)}<div class="char-name-audio"><span class="name" style="color: #8e44ad;">${char.name}</span><button class="play-preview-btn" onclick="playPreview('${char.preview_audio}', event, this)" ${!char.preview_audio ? 'disabled' : ''}>▶ 试听音色</button></div>`;
    }
    else if (target.startsWith('long_seg_')) {
        const segId = parseInt(target.replace('long_seg_', ''));
        if (typeof updateLongSegmentChar === 'function') updateLongSegmentChar(segId, charId);
    }
    closeCharGridModal();
}

function filterCharacters() {
    const input = document.getElementById('charSearchInput');
    if (!input) return;
    const kw = input.value.toLowerCase().trim();
    document.querySelectorAll('.char-grid-item').forEach(item => {
        const name = item.getAttribute('data-name');
        if (name) {
            item.style.display = name.toLowerCase().includes(kw) ? 'flex' : 'none';
        }
    });
}