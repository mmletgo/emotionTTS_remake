// ==========================================
// synth.js - 核心业务逻辑与渲染流水线
// ==========================================

// 🌟 共享的全局状态定义
var globalLibraryCache = [];
var currentCandidates = [];
var synthAbortController = null;
var manualTargetEmotion = null;

var activeEmoVector = null;
var activeEmoAlpha = 0.65;
var editingVectorSegId = null;

var currentLibraryTarget = 'single';
var currentEmotionTarget = 'single';

var longTextSegments = [];

// 🎨 监听滑动条事件初始化
document.addEventListener('DOMContentLoaded', () => {
    const rangeInputs = document.querySelectorAll('.slider-group input[type="range"]');
    rangeInputs.forEach(slider => {
        updateSliderProgress(slider); // 初始化
        slider.addEventListener('input', function() {
            updateSliderProgress(this);
        });
    });
});

// ==========================================
// 🎬 模式 A：单句合成台
// ==========================================
function clearSingleSynthState() {
    currentCandidates = [];
    manualTargetEmotion = null;

    const manualDisp = document.getElementById('manualEmotionDisplay');
    if (manualDisp) manualDisp.style.display = 'none';

    const outWrapper = document.getElementById('outputWrapper');
    if (outWrapper) outWrapper.style.display = 'none';

    const resArea = document.getElementById('resultArea');
    if (resArea) resArea.style.display = 'none';

    const tgtEmo = document.getElementById('targetEmotion');
    if (tgtEmo) tgtEmo.innerHTML = '';
}

function setSynthLoadingState(isMatching, isSynthesizing) {
    const aiBtn = document.getElementById('oneClickBtn');
    const manualBtn = document.querySelector('button[onclick="openLibraryModal(\'single\')"]');
    const reBtn = document.getElementById('reSynthBtn');
    const stopBtn = document.getElementById('stopSynthBtn');

    if (aiBtn) { aiBtn.disabled = false; aiBtn.innerText = "🚀 一键 AI 智能匹配并合成"; }
    if (manualBtn) manualBtn.disabled = false;

    // 🌟 恢复初始状态时，显示“合成”按钮，隐藏“停止”按钮
    if (reBtn) { reBtn.disabled = false; reBtn.innerText = "用此参考合成"; reBtn.style.display = 'inline-flex'; }
    if (stopBtn) stopBtn.style.display = 'none';

    if (isMatching) {
        if (aiBtn) { aiBtn.disabled = true; aiBtn.innerText = "⏳ 正在诊断匹配情绪..."; }
        if (manualBtn) manualBtn.disabled = true;
        if (reBtn) reBtn.disabled = true;
    } else if (isSynthesizing) {
        if (aiBtn) { aiBtn.disabled = true; aiBtn.innerText = "⏳ 正在合成音频..."; }
        if (manualBtn) manualBtn.disabled = true;
        // 🌟 核心修改：合成时隐藏“合成”按钮，让“停止”按钮原地顶替它
        if (reBtn) { reBtn.style.display = 'none'; }
        if (stopBtn) stopBtn.style.display = 'inline-flex';
    }
}

function renderCurrentCandidate() {
    if (currentCandidates.length === 0) return;
    const c = currentCandidates[0];

    // 获取安全的音频地址，并加上时间戳防止缓存
    const audioUrl = `${c.ref_audio_url}?t=${Date.now()}`;

    // 🌟 核心修改：恢复单行布局，增加一个 140px 的固定宽度容器，让它和【下载音频】按钮大小一致
    document.getElementById('singleCandidateView').innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; background: white; padding: 12px 18px; border-radius: 8px; border: 1px solid #e1f0fa; box-shadow: 0 2px 6px rgba(52,152,219,0.05);">

            <div style="display: flex; align-items: center; gap: 15px; flex: 1; min-width: 0;">
                <button class="btn-info btn-sm play-preview-btn"
                        onclick="playPreview('${audioUrl}', event, this)"
                        style="margin: 0; flex-shrink: 0; padding: 6px 16px; font-size: 13px;">
                    ▶ 试听参考音
                </button>

                <div style="font-size: 14px; color: #576574; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${c.text}">
                    <strong style="color: #34495e; margin-right: 5px;">参考:</strong>"${c.text}"
                </div>
            </div>

            <div style="width: 140px; flex-shrink: 0; display: flex; justify-content: flex-end;">
                <button class="btn-primary" id="reSynthBtn" onclick="reSynthesize()" style="width: 100%; height: 40px; padding: 0; border-radius: 6px; font-weight: bold; font-size: 14px; margin: 0; box-shadow: 0 4px 10px rgba(52,152,219,0.2); justify-content: center;">
                    用此参考合成
                </button>
                <button class="btn-danger" id="stopSynthBtn" onclick="stopSynthesize()" style="display: none; width: 100%; height: 40px; padding: 0; border-radius: 6px; font-weight: bold; font-size: 14px; margin: 0; justify-content: center;">
                    🛑 停止
                </button>
            </div>
        </div>
    `;
}

function stopSynthesize() { if (synthAbortController) { synthAbortController.abort(); synthAbortController = null; } }

async function oneClickSynthesize() {
    const id = document.getElementById('charSelect').value; const txt = document.getElementById('inputText').value;
    if (!id || !txt) return alert("请选择角色并输入文案！");

    setSynthLoadingState(true, false);
    document.getElementById('outputWrapper').style.display = 'none';
    document.getElementById('resultArea').style.display = 'none';

    const payload = { char_id: id, text: txt };
    if (manualTargetEmotion) payload.manual_emotion = manualTargetEmotion;

    try {
        const matchData = await apiMatchEmotion(payload);
        document.getElementById('targetEmotion').innerHTML = renderEmotionBadges(matchData.target_emotion);
        currentCandidates = matchData.candidates;

        // 🌟 新增核心：自动接管并点亮前端的情绪向量状态
        if (matchData.emo_vector) {
            activeEmoVector = matchData.emo_vector;
            activeEmoAlpha = matchData.emo_alpha !== undefined ? matchData.emo_alpha : 0.65;

            const btn = document.getElementById('vectorEmoBtn');
            const clearBtn = document.getElementById('clearVectorEmoBtn');
            if(btn) {
                btn.className = 'btn-outline-danger btn-sm'; // 变成红色的醒目状态
                btn.innerHTML = '🎛️ 情绪向量已自动注入';
            }
            if(clearBtn) {
                clearBtn.style.display = 'block'; // 显示取消按钮
            }
        } else {
            // 如果后端没有返回（比如手动强制情绪模式），则清理上次的向量状态
            clearVectorSettings('single');
        }

        renderCurrentCandidate();
        document.getElementById('outputWrapper').style.display = 'block';
    } catch (e) {
        alert("❌ 匹配分析失败: " + e.message);
        setSynthLoadingState(false, false);
        return;
    }

    await executeSynthesis(id, txt, currentCandidates[0].filename);
}

async function reSynthesize() {
    if (currentCandidates.length === 0) return; const id = document.getElementById('charSelect').value; const txt = document.getElementById('inputText').value;
    if (!id || !txt) return alert("文案不能为空！"); await executeSynthesis(id, txt, currentCandidates[0].filename);
}

async function executeSynthesis(charId, text, refFilename) {
    synthAbortController = new AbortController(); setSynthLoadingState(false, true); document.getElementById('resultArea').style.display = 'none';
    try {
        const payload = {
            text: text,
            char_id: charId,
            ref_audio_filename: refFilename
        };

        if (activeEmoVector !== null) {
            payload.emo_vector = activeEmoVector;
            payload.emo_alpha = activeEmoAlpha;
        }

        const synthData = await apiSynthesize(payload, synthAbortController.signal);
        const audio = document.getElementById('audioPlayer'); const finalUrl = synthData.audio_url + "?t=" + Date.now();

        const safeName = getSafeFilename(text, "synthesized_audio");
        document.getElementById('downloadLink').download = `${safeName}.wav`;

        audio.src = finalUrl; document.getElementById('downloadLink').href = finalUrl; document.getElementById('resultArea').style.display = 'block'; audio.play();
    } catch (e) {
        if (e.name !== 'AbortError') alert("❌ 语音合成失败：" + e.message);
    } finally {
        setSynthLoadingState(false, false); synthAbortController = null;
    }
}

// ==========================================
// 📑 模式 B：长文本配音流水线
// ==========================================

async function handleImportTxt(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));

    let combinedText = "";
    for (let file of files) {
        try {
            const text = await file.text();
            combinedText += text + "\n\n";
        } catch (e) {
            console.error(`无法读取文件 ${file.name}:`, e);
        }
    }

    const textArea = document.getElementById('longInputText');
    if (textArea.value.trim()) {
        textArea.value = textArea.value.trim() + "\n\n" + combinedText.trim();
    } else {
        textArea.value = combinedText.trim();
    }
    event.target.value = '';
}

async function splitLongText() {
    const text = document.getElementById('longInputText').value;
    const minLen = parseInt(document.getElementById('longMinLen').value) || 10;
    const globalCharId = document.getElementById('longCharSelect').value;

    if (!text.trim()) return alert("请输入大段台词！");
    if (!globalCharId) return alert("请在上方设置全局发音人角色！");

    const btn = document.querySelector('button[onclick="splitLongText()"]');
    const origBtnText = btn.innerText;
    btn.innerText = "⏳ 正在调用高级引擎智能拆分...";
    btn.disabled = true;

    try {
        const data = await apiSplitText(text, minLen, 150);

        longTextSegments = [];
        data.segments.forEach((chunk, index) => {
            longTextSegments.push({
                id: Date.now() + index,
                text: chunk,
                charId: globalCharId,
                candidates: [],
                audioUrl: null,
                selected: false,
                target_emotion: null,
                hasAuditioned: false,
                emo_vector: null,
                emo_alpha: 0.65
            });
        });

        document.getElementById('longSelectAll').checked = false;
        if(document.getElementById('longSegFilter')) document.getElementById('longSegFilter').value = 'all';

        document.getElementById('longBatchBar').style.display = longTextSegments.length > 0 ? 'flex' : 'none';
        renderLongTextSegments();

    } catch (e) {
        alert("❌ 拆分失败: " + e.message);
    } finally {
        btn.innerText = origBtnText;
        btn.disabled = false;
    }
}

function updateLongSegmentChar(segId, newCharId) {
    const seg = longTextSegments.find(s => s.id == segId);
    if(seg) { seg.charId = newCharId; seg.candidates = []; renderLongTextSegments(); }
}

function updateLongSegmentText(segId, text) {
    const seg = longTextSegments.find(s => s.id == segId);
    if(seg) { seg.text = text; updateBatchButtonsState(); }
}

function openLibraryModalForSeg(segId) {
    const seg = longTextSegments.find(s => s.id == segId);
    if(seg) { openLibraryModal('long_seg_' + segId, seg.charId); }
}

function toggleSegSelection(segId, isChecked) {
    const seg = longTextSegments.find(s => s.id == segId);
    if(seg) seg.selected = isChecked;

    const card = document.getElementById(`seg_card_${segId}`);
    const badge = document.getElementById(`seg_badge_${segId}`);
    if (card) {
        if (isChecked) card.classList.add('selected-card');
        else card.classList.remove('selected-card');
    }
    if (badge) {
        if (isChecked) badge.classList.add('selected-badge');
        else badge.classList.remove('selected-badge');
    }

    updateBatchButtonsState();
}

function toggleSelectAllLongSegs() {
    const isChecked = document.getElementById('longSelectAll').checked;
    const filterEl = document.getElementById('longSegFilter');
    const filter = filterEl ? filterEl.value : 'all';

    longTextSegments.forEach(seg => {
        let isVisible = true;
        if (filter === 'no_ref') isVisible = !seg.candidates || seg.candidates.length === 0;
        else if (filter === 'no_audio') isVisible = !seg.audioUrl;
        else if (filter === 'no_audition') isVisible = seg.audioUrl && !seg.hasAuditioned;

        if (isVisible) {
            seg.selected = isChecked;
            const card = document.getElementById(`seg_card_${seg.id}`);
            const badge = document.getElementById(`seg_badge_${seg.id}`);
            if (card) isChecked ? card.classList.add('selected-card') : card.classList.remove('selected-card');
            if (badge) isChecked ? badge.classList.add('selected-badge') : badge.classList.remove('selected-badge');
        }
    });

    document.querySelectorAll('.seg-checkbox').forEach(cb => {
        const segId = cb.value;
        const seg = longTextSegments.find(s => s.id == segId);
        if (seg) cb.checked = seg.selected;
    });

    updateBatchButtonsState();
}

function updateBatchButtonsState() {
    const filterEl = document.getElementById('longSegFilter');
    const filter = filterEl ? filterEl.value : 'all';

    const visibleSegs = longTextSegments.filter(seg => {
        if (filter === 'no_ref') return !seg.candidates || seg.candidates.length === 0;
        if (filter === 'no_audio') return !seg.audioUrl;
        if (filter === 'no_audition') return seg.audioUrl && !seg.hasAuditioned;
        return true;
    });

    const selectedVisibleCount = visibleSegs.filter(s => s.selected).length;
    const selectAllCb = document.getElementById('longSelectAll');
    if (selectAllCb) {
        selectAllCb.checked = (visibleSegs.length > 0 && selectedVisibleCount === visibleSegs.length);
    }

    const selectedSegs = longTextSegments.filter(s => s.selected);
    const selectedCount = selectedSegs.length;

    const readyToSynthCount = selectedSegs.filter(s => s.candidates && s.candidates.length > 0).length;
    const readyToExportCount = selectedSegs.filter(s => s.audioUrl).length;

    const btnMatch = document.getElementById('btnBatchMatch');
    const btnSynth = document.getElementById('btnBatchSynth');
    const btnDownload = document.getElementById('btnBatchDownload');

    if(btnMatch) {
        btnMatch.disabled = selectedCount === 0;
        btnMatch.innerText = `🤖 智能选参考音频 (${selectedCount})`;
    }
    if(btnSynth) {
        btnSynth.disabled = readyToSynthCount === 0;
        btnSynth.innerText = `🚀 全部合成 (${readyToSynthCount})`;
    }
    if(btnDownload) {
        btnDownload.disabled = readyToExportCount === 0;
        btnDownload.innerText = `💾 下载音频 (${readyToExportCount}) ▾`;
    }

    const btnPlay = document.getElementById('btnBatchPlay');
    if(btnPlay) {
        btnPlay.disabled = readyToExportCount === 0;

        const currentUrls = selectedSegs.filter(s => s.audioUrl).map(s => s.audioUrl).join('|');
        if (currentUrls !== lastSelectedUrls) {
            resetBatchPlayState(readyToExportCount);
            lastSelectedUrls = currentUrls;
        } else if (batchAudioObj.paused) {
            if (isBatchPlayStarted && currentBatchIndex < batchPlayQueue.length) {
                btnPlay.innerText = "▶️ 继续播放";
            } else {
                btnPlay.innerText = `▶️ 从头播放 (${readyToExportCount})`;
            }
        }
    }
}

function toggleExportMenu(e) {
    if(e) e.stopPropagation();
    const menu = document.getElementById('exportDropdown');
    if (menu.style.display === 'none' || menu.style.display === '') {
        menu.style.display = 'flex';
    } else {
        menu.style.display = 'none';
    }
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('exportDropdown');
    const btn = document.getElementById('btnBatchDownload');
    if (menu && menu.style.display === 'flex' && e.target !== btn && !menu.contains(e.target)) {
        menu.style.display = 'none';
    }
});

function markSegAuditioned(segId) {
    const seg = longTextSegments.find(s => s.id == segId);
    if (seg && !seg.hasAuditioned) {
        seg.hasAuditioned = true;
        const dot = document.getElementById(`red_dot_${segId}`);
        if (dot) dot.style.display = 'none';
        updateBatchButtonsState();
    }
}

function renderLongTextSegments() {
    const container = document.getElementById('longSegmentsContainer');
    const filterEl = document.getElementById('longSegFilter');
    const filter = filterEl ? filterEl.value : 'all';

    const filteredItems = longTextSegments.map((seg, index) => ({ seg, originalIndex: index })).filter(item => {
        if (filter === 'no_ref') return !item.seg.candidates || item.seg.candidates.length === 0;
        if (filter === 'no_audio') return !item.seg.audioUrl;
        if (filter === 'no_audition') return item.seg.audioUrl && !item.seg.hasAuditioned;
        return true;
    });

    container.innerHTML = filteredItems.map((item) => {
        const seg = item.seg;
        const index = item.originalIndex;
        const char = globalCharacters.find(c => c.id === seg.charId) || {name: '未知'};

        const avatarHtml = `
            <div class="clickable-avatar" onclick="openCharGridModal('long_seg_${seg.id}')" title="点击更换配音员" style="margin-top: 5px;">
                ${renderAvatarHTML(char, 'avatar-lg')}
                <div class="char-name-tag">${char.name}</div>
            </div>`;

        let btnHtmlTop = `<button class="btn-outline-primary btn-sm" style="width: 100%; padding: 8px; margin: 0; border-width: 1.5px;" onclick="openLibraryModalForSeg(${seg.id})">🗂️ 选参考音频</button>`;
        let refHtmlRow = '';

        if (seg.candidates[0]) {
            btnHtmlTop = `<button class="btn-outline-primary btn-sm" style="width: 100%; padding: 8px; margin: 0; border-width: 1.5px;" onclick="openLibraryModalForSeg(${seg.id})">🔄 重选参考</button>`;

            refHtmlRow = `
            <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px; width: 100%;">
                <div style="flex: 1; display: flex; align-items: center; gap: 10px; background: #f4f9fd; padding: 10px 12px; border-radius: 8px; border: 1.5px dashed #3498db; overflow: hidden; min-width: 0;">
                    <button class="btn-info btn-sm play-preview-btn" onclick="toggleSegAudio(this, '${seg.candidates[0].ref_audio_url}', '▶ 试听')" style="margin:0; flex-shrink: 0; padding: 4px 10px;">▶ 试听</button>
                    <span style="font-size: 13px; color: #2c3e50; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;" title="${seg.candidates[0].text}"><strong>参考:</strong> "${seg.candidates[0].text}"</span>
                </div>
                <div style="width: 170px; flex-shrink: 0; display: flex; flex-direction: column;">
                    <button class="btn-outline-primary btn-sm" style="width: 100%; padding: 8px; font-size: 13px; margin: 0; border-width: 1.5px;" onclick="inlineSynthSegment(${seg.id})" id="btn_inline_syn_${seg.id}">
                        ${seg.audioUrl ? '🚀 重新合成' : '🚀 开始合成'}
                    </button>
                </div>
            </div>`;
        }

        let resultHtmlRow = '';
        if (seg.audioUrl) {
            const safeDownloadName = getSafeFilename(seg.text, `片段_${index+1}`);
            const redDotHtml = !seg.hasAuditioned ? `<span class="red-dot" id="red_dot_${seg.id}" title="未试听"></span>` : '';

            resultHtmlRow = `
            <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px; width: 100%;">
                <div style="flex: 1; display: flex; align-items: center; gap: 10px; background: #f2fbf5; padding: 8px 12px; border-radius: 8px; border: 1px solid #2ecc71; position: relative; min-width: 0;">
                    ${redDotHtml}
                    <span style="color: #27ae60; font-weight: bold; font-size: 13px; flex-shrink: 0;">✅ 合成结果</span>
                    <audio src="${seg.audioUrl}" controls style="height: 35px; flex: 1; outline: none;" onplay="markSegAuditioned(${seg.id})"></audio>
                </div>
                <div style="width: 170px; flex-shrink: 0;">
                    <a href="${seg.audioUrl}" download="${safeDownloadName}.wav" style="display: block; width: 100%;">
                        <button class="btn-outline-success btn-sm" style="width: 100%; padding: 8px; margin: 0; border-width: 1.5px;">💾 下载音频</button>
                    </a>
                </div>
            </div>`;
        }

        let emotionHtml = '';
        let targetEmo = seg.target_emotion;
        if (targetEmo) {
            emotionHtml = `<div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 3px; justify-content: flex-start; width: 100%; transform: scale(0.95); transform-origin: top left;">
                ${renderEmotionBadges(targetEmo, true)}
            </div>`;
        }

        // 🌟 核心优化：动态组装情绪向量按钮与取消按钮
        let vectorHtml = `
            <button class="${seg.emo_vector ? 'btn-outline-danger' : 'btn-outline-primary'}"
                    style="padding: 6px 16px; font-size: 13px; font-weight: 500; border-radius: 16px; background: white; box-shadow: 0 3px 8px rgba(0,0,0,0.06);"
                    onclick="openVectorEmotionModal(${seg.id})">
                ${seg.emo_vector ? '🎛️ 情绪向量已设置' : '🎛️ 设置情绪向量'}
            </button>
        `;

        if (seg.emo_vector) {
            vectorHtml += `
            <button class="btn-outline-danger"
                    style="padding: 6px 12px; font-size: 13px; font-weight: bold; border-radius: 16px; background: #fff2f0; box-shadow: 0 3px 8px rgba(0,0,0,0.06); border: 1px solid #ffccc7;"
                    onclick="clearVectorSettings(${seg.id})" title="一键取消设置">
                ✖ 取消
            </button>`;
        }

        return `
        <div id="seg_card_${seg.id}" class="segment-card ${seg.selected ? 'selected-card' : ''}" style="position: relative; background: #fff; border: 1px solid #e0e6ed; border-radius: 10px; padding: 15px; padding-top: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); margin-bottom: 10px;">

            <div style="position: absolute; top: -12px; left: 15px;">
                <label id="seg_badge_${seg.id}" class="segment-badge-label ${seg.selected ? 'selected-badge' : ''}">
                    <input type="checkbox" class="seg-checkbox" value="${seg.id}" ${seg.selected ? 'checked' : ''} onchange="toggleSegSelection(${seg.id}, this.checked)" style="margin: 0; cursor: pointer; width: 14px; height: 14px;">
                    片段 ${index + 1}
                </label>
            </div>

            <div style="position: absolute; top: -16px; right: 15px; display: flex; gap: 8px;">
                ${vectorHtml}
            </div>

            <div style="display: flex; gap: 15px; align-items: flex-start;">
                ${avatarHtml}
                <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">

                    <div style="display: flex; gap: 15px; align-items: flex-start; width: 100%;">
                        <div style="flex: 1; display: flex; flex-direction: column;">
                            <textarea class="text-input" style="flex: 1; height: 74px; font-size: 16px; border-color: #bdc3c7; line-height: 1.5; margin-bottom: 4px;" maxlength="200" onchange="updateLongSegmentText(${seg.id}, this.value)" oninput="document.getElementById('count_${seg.id}').innerText = this.value.length">${seg.text}</textarea>
                            <div style="text-align: right; font-size: 12px; color: #95a5a6;"><span id="count_${seg.id}">${seg.text.length}</span> / 200 字</div>
                        </div>

                        <div style="width: 170px; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-start;">
                            ${btnHtmlTop.replace('<button', `<button id="btn_match_${seg.id}"`)}

                            <div id="match_status_${seg.id}" style="font-size: 13px; color: #e67e22; font-weight: bold; margin-top: 6px; width: 100%; text-align: center;"></div>

                            ${emotionHtml}
                        </div>
                    </div>

                    ${refHtmlRow}
                    ${resultHtmlRow}

                </div>

                <div style="display: flex; flex-direction: column; gap: 10px; justify-content: center; margin-top: 5px; padding-left: 15px; border-left: 1px dashed #e0e6ed;">
                    <button class="btn-outline btn-sm" style="padding: 8px 10px; font-size: 14px; border-radius: 8px; background: #f8f9fa; border-color: #dcdde1;" onclick="addSegmentBelow(${seg.id})" title="在下方插入新片段">➕</button>
                    <button class="btn-outline-danger btn-sm" style="padding: 8px 10px; font-size: 14px; border-radius: 8px; background: #fdf2f0;" onclick="deleteSegment(${seg.id})" title="删除此片段">🗑️</button>
                </div>

            </div>
        </div>`;
    }).join('');

    updateBatchButtonsState();
}

function deleteSegment(segId) {
    if (!confirm("确定要删除这个片段吗？")) return;
    longTextSegments = longTextSegments.filter(s => s.id !== segId);

    if (longTextSegments.length === 0) {
        document.getElementById('longBatchBar').style.display = 'none';
    }

    renderLongTextSegments();
}

function addSegmentBelow(segId) {
    const index = longTextSegments.findIndex(s => s.id === segId);
    if (index === -1) return;

    const globalCharId = document.getElementById('longCharSelect').value || (globalCharacters[0] ? globalCharacters[0].id : null);

    const newSeg = {
        id: Date.now() + Math.floor(Math.random() * 10000),
        text: "",
        charId: longTextSegments[index].charId || globalCharId,
        candidates: [],
        audioUrl: null,
        selected: false,
        target_emotion: null,
        hasAuditioned: false,
        emo_vector: null,
        emo_alpha: 0.65
    };

    longTextSegments.splice(index + 1, 0, newSeg);
    renderLongTextSegments();
}

async function inlineSynthSegment(segId, signal = null) {
    const seg = longTextSegments.find(s => s.id == segId);
    if (!seg || !seg.candidates[0]) return;

    const btn = document.getElementById(`btn_inline_syn_${segId}`);
    if(btn) { btn.disabled = true; btn.innerText = "⏳ 合成中..."; }

    try {
        const payload = {
            text: seg.text,
            char_id: seg.charId,
            ref_audio_filename: seg.candidates[0].filename
        };

        if (seg.emo_vector) {
            payload.emo_vector = seg.emo_vector;
            payload.emo_alpha = seg.emo_alpha !== undefined ? seg.emo_alpha : 0.65;
        }

        const data = await apiSynthesize(payload, signal);
        seg.audioUrl = data.audio_url + "?t=" + Date.now();
        seg.hasAuditioned = false;

        renderLongTextSegments();

    } catch(e) {
        if (e.name !== 'AbortError') {
            alert(`❌ [片段合成失败]: ${e.message}`);
        }
        if(btn) {
            btn.disabled = false;
            btn.innerText = seg.audioUrl ? "🚀 重新合成" : "🚀 开始合成";
        }
    }
}

async function batchSynthSelected() {
    const readySegs = longTextSegments.filter(s => s.selected && s.candidates && s.candidates.length > 0);
    if (readySegs.length === 0) return;

    const btn = document.getElementById('btnBatchSynth');
    const stopBtn = document.getElementById('btnBatchStop');

    const origText = btn.innerText;
    btn.disabled = true; btn.innerText = "⏳ 正在排队合成...";
    if(stopBtn) stopBtn.style.display = 'inline-block';

    if(synthAbortController) { synthAbortController.abort(); }
    synthAbortController = new AbortController();

    try {
        for (let seg of readySegs) {
            if (!synthAbortController || synthAbortController.signal.aborted) {
                break;
            }
            await inlineSynthSegment(seg.id, synthAbortController.signal);
        }
    } finally {
        if(stopBtn) stopBtn.style.display = 'none';
        if(btn) { btn.innerText = origText; btn.disabled = false; }
        updateBatchButtonsState();
    }
}

function stopBatchSynth() {
    if (!confirm("⚠️ 确定要立刻终止批量合成任务吗？")) return;

    if (synthAbortController) {
        synthAbortController.abort();
    }

    fetch('/api/kill_tts_service', { method: 'POST', headers: tunnelHeaders })
        .catch(e => console.log("发送后端急停指令..."));
}

async function batchMatchSelected() {
    const selectedSegs = longTextSegments.filter(s => s.selected);
    if (selectedSegs.length === 0) return;

    // 🌟 获取全局向量权重
    const globalWeight = parseFloat(document.getElementById('longGlobalAlphaWeight').value) || 0.6;

    const btn = document.getElementById('btnBatchMatch');
    const origText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "⏳ 正在分析情绪与权重...";

    for (let seg of selectedSegs) {
        try {
            // 🌟 修复：在发起 API 请求前，立刻让当前片段显示“正在分析...”
            const statusDiv = document.getElementById(`match_status_${seg.id}`);
            const matchBtn = document.getElementById(`btn_match_${seg.id}`);
            if (statusDiv) statusDiv.innerHTML = "⏳ 正在分析...";
            if (matchBtn) matchBtn.disabled = true; // 锁定按钮防误触

            const payload = { char_id: seg.charId, text: seg.text };
            const data = await apiMatchEmotion(payload);

            seg.candidates = data.candidates;
            seg.target_emotion = data.target_emotion;

            // 处理情绪向量逻辑
            if (data.emo_vector) {
                seg.emo_vector = data.emo_vector;

                // 🌟 核心逻辑：后端计算好的 alpha 再乘上前台设置的全局权重
                let backendAlpha = data.emo_alpha !== undefined ? data.emo_alpha : 0.65;
                seg.emo_alpha = parseFloat((backendAlpha * globalWeight).toFixed(2));

                console.log(`[片段 ${seg.id}] 后端Alpha: ${backendAlpha}, 全局权重: ${globalWeight}, 最终Alpha: ${seg.emo_alpha}`);
            } else {
                seg.emo_vector = null;
                seg.emo_alpha = 0.65;
            }

            renderLongTextSegments(); // 实时更新 UI 显示

        } catch(e) {
            console.error(`❌ [片段 ${seg.id} 匹配失败]:`, e);
        }
    }

    btn.innerText = origText;
    btn.disabled = false;
    updateBatchButtonsState();
}

async function mergeExportSelected() {
    document.getElementById('exportDropdown').style.display = 'none';

    const validSegs = longTextSegments.filter(s => s.selected && s.audioUrl);
    const validUrls = validSegs.map(s => s.audioUrl);
    if(validUrls.length === 0) return;

    const btn = document.getElementById('btnBatchDownload');
    const origText = btn.innerText;
    btn.innerText = "⏳ 缝合打包中..."; btn.disabled = true;

    try {
        const data = await apiMergeAudio(validUrls);
        const firstSafeName = getSafeFilename(validSegs[0].text, "批量合并");

        const link = document.createElement('a');
        link.href = data.audio_url;
        link.download = `${firstSafeName}_等合并.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        alert("合并失败：" + e.message);
    } finally {
        btn.innerText = origText; btn.disabled = false;
    }
}

async function batchExportZipSelected() {
    document.getElementById('exportDropdown').style.display = 'none';

    const validSegs = longTextSegments.filter(s => s.selected && s.audioUrl);
    if(validSegs.length === 0) return;

    const btn = document.getElementById('btnBatchDownload');
    const origText = btn.innerText;
    btn.innerText = "⏳ ZIP 打包中..."; btn.disabled = true;

    try {
        const zip = new JSZip();
        for(let i = 0; i < validSegs.length; i++) {
            const seg = validSegs[i];
            const safeName = getSafeFilename(seg.text, `片段_${i+1}`);
            const fileName = `${String(i+1).padStart(3, '0')}_${safeName}.wav`;

            const response = await fetch(seg.audioUrl);
            if (!response.ok) throw new Error("无法获取音频文件");
            const blob = await response.blob();
            zip.file(fileName, blob);
        }

        const zipBlob = await zip.generateAsync({ type:"blob" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);

        const firstSafeName = getSafeFilename(validSegs[0].text, "批量音频");
        link.download = `${firstSafeName}_等批量导出.zip`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (e) {
        alert("打包失败：" + e.message);
    } finally {
        btn.innerText = origText; btn.disabled = false;
    }
}

/* ==========================================
   🌟 新增：处理 SRT 字幕文件的解析与自动分段
   ========================================== */
function handleImportSrt(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        parseSrtToSegments(content);
        event.target.value = ''; // 清空选择，允许下次重复导入同一个文件
    };
    // 默认按照 UTF-8 编码读取字幕文件
    reader.readAsText(file, 'utf-8');
}

function parseSrtToSegments(srtContent) {
    // 1. 规范化换行符，并按照空行（双换行）拆分出每一个独立的字幕块
    const blocks = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/);

    // 2. 获取当前全局选择的角色 ID（保证导入的文本默认带上角色）
    const globalCharSelect = document.getElementById('longCharSelect');
    const globalCharId = globalCharSelect ? globalCharSelect.value : null;

    let newSegments = [];
    let baseId = Date.now();

    blocks.forEach((block, index) => {
        const lines = block.trim().split('\n');

        // 🛡️ 严格校验：SRT 块标准格式为 第一行序号，第二行时间轴，第三行及以后是文本
        if (lines.length >= 3 && lines[1].includes('-->')) {
            // 提取从第 3 行开始的所有文本（防止有些字幕分两行显示，这里将其合并为空格相连的单句）
            let text = lines.slice(2).join(' ').trim();
            // 去除字幕中可能自带的 HTML 样式标签
            text = text.replace(/<[^>]+>/g, '').trim();

            if (text) {
                // 🌟 修正：完全对齐现有的长文本切片数据结构
                newSegments.push({
                    id: baseId + index,
                    text: text,
                    charId: globalCharId,        // 统一使用 camelCase
                    candidates: [],              // 统一使用 candidates 数组存放参考音
                    audioUrl: null,              // 统一使用 audioUrl
                    selected: false,
                    target_emotion: null,
                    hasAuditioned: false,
                    emo_vector: null,
                    emo_alpha: 0.65
                });
            }
        }
    });

    if (newSegments.length === 0) {
        alert("❌ 未能从该 SRT 文件中解析出有效的字幕文本，请检查文件格式！");
        return;
    }

    // 3. 🌟 核心：直接覆盖全局的长文本切片数组，这相当于完成了“自动切分”
    longTextSegments = newSegments;

    // 4. 将纯文本也反填到上方的输入框中，方便预览
    const fullText = newSegments.map(seg => seg.text).join('\n');
    const inputArea = document.getElementById('longInputText');
    if (inputArea) {
        inputArea.value = fullText;
    }

    // 5. 🌟 核心：显示批量控制栏，并立刻渲染下方的分段卡片
    const batchBar = document.getElementById('longBatchBar');
    if (batchBar) batchBar.style.display = 'flex';

    if (typeof renderLongTextSegments === 'function') {
        renderLongTextSegments(); // 自动生成所有卡片！
    }
    if (typeof updateBatchButtonsState === 'function') {
        updateBatchButtonsState(); // 自动更新全选和按钮状态
    }

    alert(`✅ 成功导入并按字幕行自动拆分出了 ${newSegments.length} 条配音片段！`);
}

// 🌟 新增：一键取消情绪向量设置的全局方法
function clearVectorSettings(target) {
    if (target === 'single') {
        // 清除单句配音的全局状态
        activeEmoVector = null;
        activeEmoAlpha = 0.65;

        const btn = document.getElementById('vectorEmoBtn');
        const clearBtn = document.getElementById('clearVectorEmoBtn');

        // 恢复按钮初始状态
        if(btn) {
            btn.className = 'btn-outline-primary btn-sm';
            btn.innerHTML = '🎛️ 设置情绪向量';
        }
        // 隐藏取消按钮
        if(clearBtn) clearBtn.style.display = 'none';

    } else {
        // 清除长文本中指定卡片的状态
        const seg = longTextSegments.find(s => s.id == target);
        if (seg) {
            seg.emo_vector = null;
            seg.emo_alpha = 0.65;
            // 重新渲染卡片列表以刷新 UI
            if(typeof renderLongTextSegments === 'function') renderLongTextSegments();
        }
    }
}