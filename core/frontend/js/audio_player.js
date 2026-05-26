// ==========================================
// audio_player.js - 音频播放控制器
// ==========================================

let segAudioGlobal = new Audio();
let currentlyPlayingBtn = null;
let currentlyPlayingDefaultText = '';
let currentSegAudioUrl = '';

let batchAudioObj = new Audio();
let batchPlayQueue = [];
let currentBatchIndex = 0;
let lastSelectedUrls = "";
let isBatchPlayStarted = false;

// 监听全局音频暂停和结束事件，用于重置按钮状态
segAudioGlobal.addEventListener('pause', () => {
    if (currentlyPlayingBtn) { currentlyPlayingBtn.innerHTML = currentlyPlayingDefaultText; }
});
segAudioGlobal.addEventListener('ended', () => {
    if (currentlyPlayingBtn) { currentlyPlayingBtn.innerHTML = currentlyPlayingDefaultText; currentlyPlayingBtn = null; }
});

// 批量播放结束事件：自动播放下一条
batchAudioObj.addEventListener('ended', () => {
    currentBatchIndex++;
    if (currentBatchIndex < batchPlayQueue.length) {
        playBatchAudioAt(currentBatchIndex);
    } else {
        resetBatchPlayState();
    }
});

function resetBatchPlayState(count) {
    batchAudioObj.pause();
    batchPlayQueue = [];
    currentBatchIndex = 0;
    isBatchPlayStarted = false;
    const btn = document.getElementById('btnBatchPlay');
    if (!btn) return;
    let c = count !== undefined ? count : longTextSegments.filter(s => s.selected && s.audioUrl).length;
    btn.innerText = `▶️ 从头播放 (${c})`;
}

function toggleBatchPlay() {
    const btn = document.getElementById('btnBatchPlay');
    const validSegs = longTextSegments.filter(s => s.selected && s.audioUrl);
    if (validSegs.length === 0) return;

    const currentUrls = validSegs.map(s => s.audioUrl).join('|');
    if (currentUrls !== lastSelectedUrls || batchPlayQueue.length === 0) {
        batchPlayQueue = validSegs.map(s => ({url: s.audioUrl, segId: s.id}));
        lastSelectedUrls = currentUrls;
        currentBatchIndex = 0;
        isBatchPlayStarted = false;
    }

    if (batchAudioObj.paused) {
        if (!isBatchPlayStarted) {
            isBatchPlayStarted = true;
            playBatchAudioAt(currentBatchIndex);
        } else {
            batchAudioObj.play();
        }
        btn.innerText = "⏸ 暂停";
    } else {
        batchAudioObj.pause();
        btn.innerText = "▶️ 继续播放";
    }
}

function playBatchAudioAt(index) {
    if (index >= batchPlayQueue.length) return;
    const item = batchPlayQueue[index];

    if (typeof markSegAuditioned === 'function') {
        markSegAuditioned(item.segId);
    }

    if (!segAudioGlobal.paused) segAudioGlobal.pause();
    if (typeof previewAudioObj !== 'undefined' && !previewAudioObj.paused) previewAudioObj.pause();

    batchAudioObj.src = item.url;
    batchAudioObj.play().catch(e => {
        console.error("批量播放异常", e);
        batchAudioObj.dispatchEvent(new Event('ended'));
    });
}

function toggleSegAudio(btnElement, url, defaultText = '▶ 试听') {
    if (typeof batchAudioObj !== 'undefined' && !batchAudioObj.paused) {
        batchAudioObj.pause();
        const btnPlay = document.getElementById('btnBatchPlay');
        if (btnPlay) btnPlay.innerText = "▶️ 继续播放";
    }

    if (!url || url === 'null' || url === 'undefined') return;

    if (currentSegAudioUrl === url) {
        if (!segAudioGlobal.paused) {
            segAudioGlobal.pause();
        } else {
            if (currentlyPlayingBtn) currentlyPlayingBtn.innerHTML = currentlyPlayingDefaultText;
            currentlyPlayingBtn = btnElement;
            currentlyPlayingDefaultText = defaultText;

            segAudioGlobal.play().then(() => {
                btnElement.innerHTML = '⏸ 暂停';
            }).catch(e => console.error("恢复播放失败", e));
        }
        return;
    }

    if (currentlyPlayingBtn) currentlyPlayingBtn.innerHTML = currentlyPlayingDefaultText;

    currentSegAudioUrl = url;
    segAudioGlobal.src = url;
    currentlyPlayingBtn = btnElement;
    currentlyPlayingDefaultText = defaultText;

    segAudioGlobal.play().then(() => {
        btnElement.innerHTML = '⏸ 暂停';
    }).catch(e => {
        console.error("播放音频失败", e);
        currentlyPlayingBtn.innerHTML = currentlyPlayingDefaultText;
        currentSegAudioUrl = '';
    });
}