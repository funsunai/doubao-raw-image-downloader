// ==UserScript==
// @name         豆包无水印图片选择下载
// @namespace    funsunai/doubao-raw-image-downloader
// @version      1.0.0
// @description  抓取豆包无水印原图，按住 Alt 选择图片并下载选中项。
// @author       funsunai
// @match        https://www.doubao.com/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const RAW_MAP = new Map();
  const SELECTED = new Set();
  const TOOLBAR_ID = 'db-raw-toolbar';
  const STYLE_MARKER_ID = 'db-raw-style-marker';
  const IMG_SELECTED_ATTR = 'data-db-raw-selected';
  let toolbarCount = null;
  let toolbarDownload = null;
  let toolbarClear = null;
  let busy = false;

  if (PAGE.__doubaoRawSelectorInstalled) return;
  PAGE.__doubaoRawSelectorInstalled = true;

  function normalizeUrl(url) {
    return typeof url === 'string' ? url.replace(/\\u0026/g, '&').trim() : '';
  }

  function findAllKeysInJson(node, targetKey, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) {
      node.forEach((item) => findAllKeysInJson(item, targetKey, result));
      return result;
    }
    Object.keys(node).forEach((key) => {
      if (key === targetKey) result.push(node[key]);
      findAllKeysInJson(node[key], targetKey, result);
    });
    return result;
  }

  function storeRawMapping(rawUrl, ...sourceUrls) {
    const normalizedRaw = normalizeUrl(rawUrl);
    if (!normalizedRaw) return;
    RAW_MAP.set(normalizedRaw, normalizedRaw);
    sourceUrls.forEach((sourceUrl) => {
      const normalizedSource = normalizeUrl(sourceUrl);
      if (normalizedSource) RAW_MAP.set(normalizedSource, normalizedRaw);
    });
  }

  function getRawUrl(url) {
    const normalized = normalizeUrl(url);
    return RAW_MAP.get(normalized) || '';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_MARKER_ID)) return;
    GM_addStyle(`
      img[${IMG_SELECTED_ATTR}="true"] {
        outline: 4px solid rgba(37, 99, 235, .98);
        outline-offset: 2px;
        box-shadow: 0 0 0 2px rgba(255,255,255,.92);
      }
      #${TOOLBAR_ID} {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 100000;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,.92);
        box-shadow: 0 8px 24px rgba(0,0,0,.12);
        backdrop-filter: blur(8px);
      }
      #${TOOLBAR_ID} button {
        border: 0;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 13px;
        line-height: 1.1;
        cursor: pointer;
      }
    `);
    const marker = document.createElement('meta');
    marker.id = STYLE_MARKER_ID;
    document.head.appendChild(marker);
  }

  function updateToolbar() {
    if (!toolbarCount || !toolbarDownload || !toolbarClear) return;
    toolbarCount.textContent = `Alt选中 ${SELECTED.size}`;
    toolbarDownload.textContent = busy ? '下载中...' : `下载选中 (${SELECTED.size})`;
    toolbarDownload.disabled = busy || SELECTED.size === 0;
    toolbarClear.disabled = busy || SELECTED.size === 0;
  }

  function clearSelection() {
    SELECTED.clear();
    document.querySelectorAll(`img[${IMG_SELECTED_ATTR}="true"]`).forEach((img) => {
      img.setAttribute(IMG_SELECTED_ATTR, 'false');
    });
    updateToolbar();
  }

  function guessFileName(url, index) {
    try {
      const parsed = new URL(url, location.href);
      const last = parsed.pathname.split('/').filter(Boolean).pop() || `doubao-${Date.now()}-${index + 1}`;
      return /\.[a-z0-9]+$/i.test(last) ? last : `${last}.png`;
    } catch {
      return `doubao-${Date.now()}-${index + 1}.png`;
    }
  }

  function fetchBlobViaGM(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        onload: (response) => {
          if (response.status >= 200 && response.status < 300 && response.response) {
            resolve(response.response);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error('GM_xmlhttpRequest failed')),
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
      });
    });
  }

  async function downloadSelected() {
    const urls = [...SELECTED];
    if (!urls.length || busy) return;
    busy = true;
    updateToolbar();
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        let blob;
        try {
          const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            credentials: 'include',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
          blob = await response.blob();
        } catch (fetchError) {
          blob = await fetchBlobViaGM(url);
        }
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = guessFileName(url, i);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      }
      clearSelection();
    } catch (error) {
      console.error('[Doubao Raw Selector] download failed:', error);
      alert(`下载失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      busy = false;
      updateToolbar();
    }
  }

  function createToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    ensureStyles();
    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;

    toolbarCount = document.createElement('span');
    toolbarCount.style.fontSize = '13px';
    toolbarCount.style.color = '#111827';
    toolbarCount.style.whiteSpace = 'nowrap';

    toolbarDownload = document.createElement('button');
    toolbarDownload.style.background = '#ea580c';
    toolbarDownload.style.color = '#fff';
    toolbarDownload.addEventListener('click', downloadSelected);

    toolbarClear = document.createElement('button');
    toolbarClear.textContent = '清空';
    toolbarClear.style.background = '#cbd5e1';
    toolbarClear.style.color = '#111827';
    toolbarClear.addEventListener('click', clearSelection);

    toolbar.append(toolbarCount, toolbarDownload, toolbarClear);
    document.documentElement.appendChild(toolbar);
    updateToolbar();
  }

  function installAltClickSelection() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!event.altKey) return;
      const rawUrl = getRawUrl(target.currentSrc || target.src);
      if (!rawUrl) return;
      event.preventDefault();
      event.stopPropagation();
      const selected = SELECTED.has(rawUrl);
      if (selected) {
        SELECTED.delete(rawUrl);
        target.setAttribute(IMG_SELECTED_ATTR, 'false');
      } else {
        SELECTED.add(rawUrl);
        target.setAttribute(IMG_SELECTED_ATTR, 'true');
      }
      updateToolbar();
    }, true);
  }

  function installJsonHook() {
    const originalParse = PAGE.JSON.parse.bind(PAGE.JSON);
    PAGE.JSON.parse = function patchedJsonParse(data, reviver) {
      const jsonData = originalParse(data, reviver);
      if (typeof data !== 'string' || !data.includes('creations')) return jsonData;
      try {
        const creations = findAllKeysInJson(jsonData, 'creations');
        creations.forEach((creation) => {
          if (!Array.isArray(creation)) return;
          creation.forEach((item) => {
            const image = item?.image;
            const rawUrl = image?.image_ori_raw?.url;
            if (!rawUrl) return;
            storeRawMapping(
              rawUrl,
              image?.image_ori?.url,
              image?.image_preview?.url,
              image?.image_thumb?.url
            );
          });
        });
      } catch (error) {
        console.error('[Doubao Raw Selector] JSON hook failed:', error);
      }
      return jsonData;
    };
  }

  installJsonHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createToolbar();
      installAltClickSelection();
    }, { once: true });
  } else {
    createToolbar();
    installAltClickSelection();
  }
})();
