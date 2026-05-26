// ==========================================
// utils.js - 公共工具与纯函数
// ==========================================

function getSafeFilename(text, defaultName) {
    if (!text) return defaultName;
    let safe = text.replace(/[\r\n]+/g, '').trim().substring(0, 10).replace(/[<>\\:"\/|?*]+/g, '');
    return safe || defaultName;
}

function renderEmotionBadges(emoObj, hideIntensity = false) {
    if (!emoObj) return `<span class="badge badge-gray">未知</span>`;
    if (typeof emoObj === 'string') { return `<span class="badge badge-green">${emoObj.trim() || '无标签'}</span>`; }
    const pEmo = emoObj.primary || '平'; const iEmo = emoObj.intensity || 'Medium'; const cEmo = (emoObj.complex || '').trim();
    let iColor = '#95a5a6'; if (iEmo === 'High') iColor = '#e74c3c'; if (iEmo === 'Low') iColor = '#3498db';

    const intensityHtml = hideIntensity ? '' : `<span class="badge" style="background-color: ${iColor};">${iEmo}</span>`;

    return `<div style="display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px;"><span class="badge" style="background-color: #2c3e50;">[${pEmo}]</span>${intensityHtml}${cEmo ? `<span class="badge badge-green">${cEmo}</span>` : ''}</div>`;
}

function updateSliderProgress(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 1;
    const val = parseFloat(slider.value) || 0;
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--percent', `${percent}%`);
}