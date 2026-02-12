(function () {
  /* ── i18n ヘルパー ────────────────────────────── */
  function t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  /** data-i18n / data-i18n-title / data-i18n-placeholder を一括適用 */
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  /* ── DOM 参照 ──────────────────────────────────── */
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const downloadList = document.getElementById('downloadList');
  const detailSection = document.getElementById('detailSection');
  const detailFilename = document.getElementById('detailFilename');
  const detailUrl = document.getElementById('detailUrl');
  const detailPath = document.getElementById('detailPath');
  const detailStart = document.getElementById('detailStart');
  const detailEnd = document.getElementById('detailEnd');
  const detailSize = document.getElementById('detailSize');
  const detailSpeed = document.getElementById('detailSpeed');
  const btnPauseResume = document.getElementById('btnPauseResume');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnClear = document.getElementById('btnClear');
  const btnResume = document.getElementById('btnResume');
  const btnFinder = document.getElementById('btnFinder');

  let allDownloads = [];
  let selectedId = null;
  let hideCompleted = false;

  /* ── ドラッグ重複ダウンロード自動消去 ─────────── */
  var dragInfo = null;           // { url, origId, time }
  var dragDupeIds = new Set();   // ドラッグで生じた重複のID群（表示抑制用）

  /** ポーリング結果から重複を検出し、非表示にしつつ完了後に消去 */
  function sweepDragDupes(results) {
    // 1) ドラッグ中なら新しい重複を検出
    if (dragInfo) {
      results.forEach(function (dl) {
        if (dl.id === dragInfo.origId) return;
        if (dragDupeIds.has(dl.id)) return;
        if (dl.url !== dragInfo.url) return;
        var dlTime = dl.startTime ? new Date(dl.startTime).getTime() : 0;
        if (dlTime >= dragInfo.time - 2000) {   // 2秒マージン
          dragDupeIds.add(dl.id);
        }
      });
    }
    // 2) 既知の重複は dragInfo の有無に関わらず常に消去を試みる
    if (dragDupeIds.size === 0) return;
    dragDupeIds.forEach(function (dupeId) {
      var dl = results.find(function (r) { return r.id === dupeId; });
      if (!dl) { dragDupeIds.delete(dupeId); return; }
      if (dl.state === 'complete' || dl.state === 'interrupted') {
        chrome.downloads.erase({ id: dupeId });
        dragDupeIds.delete(dupeId);
      }
    });
  }

  /* ── エラー理由の i18n マップ ──────────────────── */
  var reasonKeyMap = {
    'USER_CANCELED': 'errCanceled',
    'USER_SHUTDOWN': 'errShutdown',
    'NETWORK_FAILED': 'errNetworkFailed',
    'NETWORK_TIMEOUT': 'errNetworkTimeout',
    'SERVER_FAILED': 'errServerFailed',
    'FILE_FAILED': 'errFileFailed',
    'FILE_ACCESS_DENIED': 'errAccessDenied',
    'FILE_NO_SPACE': 'errNoSpace',
    'FILE_NAME_TOO_LONG': 'errNameTooLong',
    'FILE_TOO_LARGE': 'errTooLarge',
    'FILE_VIRUS_INFECTED': 'errVirus',
    'FILE_SECURITY_CHECK_FAILED': 'errSecurityFailed'
  };

  function localizedReason(reason) {
    var key = reasonKeyMap[reason];
    return key ? t(key) : reason;
  }

  /* ── ユーティリティ ────────────────────────────── */
  function openFolderForItem(item) {
    if (item && item.id) {
      chrome.downloads.show(item.id);
    } else {
      chrome.downloads.showDefaultFolder();
    }
  }

  function formatBytes(bytes) {
    if (bytes === undefined || bytes === 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatDate(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function formatTimeOnly(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  var fallbackFileIcon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>');
  var iconCache = {};

  function setFileIcon(el, downloadId) {
    if (!downloadId) {
      el.innerHTML = '<img src="' + fallbackFileIcon + '" alt="" width="20" height="20">';
      return;
    }
    if (iconCache[downloadId]) {
      el.innerHTML = '<img src="' + iconCache[downloadId] + '" alt="" width="20" height="20">';
      return;
    }
    el.innerHTML = '<img src="' + fallbackFileIcon + '" alt="" width="20" height="20">';
    var img = el.querySelector('img');
    chrome.downloads.getFileIcon(downloadId, { size: 32 }, function (iconUrl) {
      if (chrome.runtime.lastError || !iconUrl) {
        iconCache[downloadId] = fallbackFileIcon;
        return;
      }
      iconCache[downloadId] = iconUrl;
      if (img && img.parentNode) img.src = iconUrl;
    });
  }

  function calcSpeed(item) {
    var bytes = item.totalBytes || item.fileSize || 0;
    var start = item.startTime ? new Date(item.startTime).getTime() : 0;
    var end = item.endTime ? new Date(item.endTime).getTime() : 0;
    if (!bytes || !start || !end || end <= start) return null;
    var sec = (end - start) / 1000;
    return (bytes / 1024 / 1024 / sec).toFixed(2) + ' ' + t('speedUnit');
  }

  function toTime(item) {
    var tt = item.startTime;
    if (!tt) return 0;
    return typeof tt === 'number' ? tt : new Date(tt).getTime();
  }

  function toSize(item) {
    return item.totalBytes || item.fileSize || 0;
  }

  function toName(item) {
    return (item.filename || '').replace(/^.*[\\/]/, '').toLowerCase();
  }

  function toExt(item) {
    var name = (item.filename || '').replace(/^.*[\\/]/, '');
    var ext = name.split('.').pop().toLowerCase();
    return ext || '';
  }

  /* ── フィルタ & ソート ─────────────────────────── */
  function filterAndSort() {
    var query = (searchInput.value || '').trim().toLowerCase();
    var sort = sortSelect.value;
    var list = allDownloads.filter(function (item) {
      if (!item.filename) return false;
      if (dragDupeIds.has(item.id)) return false;
      if (hideCompleted && item.state === 'complete') return false;
      if (!query) return true;
      var name = (item.filename || '').toLowerCase();
      return name.includes(query);
    });
    list = list.slice().sort(function (a, b) {
      switch (sort) {
        case 'newest':  return toTime(b) - toTime(a);
        case 'oldest':  return toTime(a) - toTime(b);
        case 'sizeDesc': return toSize(b) - toSize(a);
        case 'sizeAsc':  return toSize(a) - toSize(b);
        case 'nameAsc':  return toName(a).localeCompare(toName(b));
        case 'nameDesc': return toName(b).localeCompare(toName(a));
        case 'urlAsc':   return (a.url || '').localeCompare(b.url || '');
        case 'urlDesc':  return (b.url || '').localeCompare(a.url || '');
        case 'type':     return toExt(a).localeCompare(toExt(b)) || toName(a).localeCompare(toName(b));
        default:         return toTime(b) - toTime(a);
      }
    });
    return list;
  }

  /* ── リスト描画 ────────────────────────────────── */
  function renderList() {
    var list = filterAndSort();
    downloadList.innerHTML = '';
    if (list.length === 0) {
      var li = document.createElement('li');
      li.className = 'empty-list';
      li.textContent = t('emptyList');
      downloadList.appendChild(li);
      return;
    }
    list.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'download-item' + (selectedId === item.id ? ' selected' : '');
      if (item.state === 'interrupted' || item.error) li.classList.add('item-error');
      li.dataset.id = String(item.id);
      var name = item.filename ? item.filename.replace(/^.*[\\/]/, '') : '—';

      // icon
      var fileIconSpan = document.createElement('span');
      fileIconSpan.className = 'file-icon';
      setFileIcon(fileIconSpan, item.id);
      li.appendChild(fileIconSpan);

      // info
      var fileInfo = document.createElement('div');
      fileInfo.className = 'file-info';

      // name
      var nameDiv = document.createElement('div');
      nameDiv.className = 'file-name';
      nameDiv.textContent = name;
      fileInfo.appendChild(nameDiv);

      // status line
      if (item.state === 'in_progress') {
        var pct = 0;
        if (item.totalBytes > 0) {
          pct = Math.round((item.bytesReceived / item.totalBytes) * 100);
        }
        var progressWrap = document.createElement('div');
        progressWrap.className = 'progress-wrap';
        var progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        var progressFill = document.createElement('div');
        progressFill.className = 'progress-fill' + (item.paused ? ' paused' : '');
        progressFill.style.width = pct + '%';
        progressBar.appendChild(progressFill);
        progressWrap.appendChild(progressBar);

        var progressText = document.createElement('span');
        progressText.className = 'progress-text';
        if (item.paused) {
          progressText.textContent = t('paused') + ' — ' + formatBytes(item.bytesReceived) + ' / ' + formatBytes(item.totalBytes);
        } else if (item.totalBytes > 0) {
          progressText.textContent = formatBytes(item.bytesReceived) + ' / ' + formatBytes(item.totalBytes) + '  (' + pct + '%)';
        } else {
          progressText.textContent = formatBytes(item.bytesReceived);
        }
        progressWrap.appendChild(progressText);
        fileInfo.appendChild(progressWrap);
      } else if (item.state === 'interrupted') {
        var statusDiv = document.createElement('div');
        statusDiv.className = 'file-status status-error';
        var reason = item.error || 'interrupted';
        statusDiv.textContent = localizedReason(reason);
        fileInfo.appendChild(statusDiv);
      } else {
        // complete
        var sizeDiv = document.createElement('div');
        sizeDiv.className = 'file-size';
        sizeDiv.textContent = formatBytes(item.totalBytes || item.fileSize);
        fileInfo.appendChild(sizeDiv);
      }

      li.appendChild(fileInfo);

      // drag-and-drop (complete items only)
      if (item.state === 'complete' && item.url) {
        li.draggable = true;
        li.addEventListener('dragstart', function (e) {
          var fname = item.filename ? item.filename.replace(/^.*[\\/]/, '') : 'download';
          var mime = item.mime || 'application/octet-stream';
          e.dataTransfer.setData('DownloadURL', mime + ':' + fname + ':' + item.url);
          e.dataTransfer.effectAllowed = 'copy';
          var iconImg = li.querySelector('.file-icon img');
          if (iconImg) {
            e.dataTransfer.setDragImage(iconImg, 10, 10);
          }
          li.classList.add('dragging');
          // ドラッグ由来の重複ダウンロードを追跡開始
          dragInfo = { url: item.url, origId: item.id, time: Date.now() };
        });
        li.addEventListener('dragend', function () {
          li.classList.remove('dragging');
          // 少し待ってからフラグをクリア（onCreated が遅延する場合に備える）
          setTimeout(function () { dragInfo = null; }, 5000);
        });
      }

      // folder button (only for complete)
      if (item.state === 'complete') {
        var folderBtn = document.createElement('button');
        folderBtn.type = 'button';
        folderBtn.className = 'btn-folder';
        folderBtn.title = t('openFolder');
        folderBtn.innerHTML = '<svg class="icon" width="16" height="16"><use href="#icon-folder"></use></svg>';
        li.appendChild(folderBtn);
        folderBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openFolderForItem(item);
        });
      } else if (item.state === 'in_progress' && !item.paused) {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-folder';
        cancelBtn.title = t('cancel');
        cancelBtn.innerHTML = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        li.appendChild(cancelBtn);
        cancelBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          chrome.downloads.cancel(item.id);
        });
      } else if (item.state === 'in_progress' && item.paused) {
        var resumeBtn = document.createElement('button');
        resumeBtn.type = 'button';
        resumeBtn.className = 'btn-folder';
        resumeBtn.title = t('btnResume');
        resumeBtn.innerHTML = '<svg class="icon" width="16" height="16"><use href="#icon-play"></use></svg>';
        li.appendChild(resumeBtn);
        resumeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          chrome.downloads.resume(item.id);
        });
      }

      li.addEventListener('click', function () {
        selectedId = item.id;
        renderList();
        showDetail(item);
      });
      li.addEventListener('dblclick', function (e) {
        e.preventDefault();
        if (item.state === 'complete') {
          chrome.downloads.open(item.id);
        }
      });
      downloadList.appendChild(li);
    });
  }

  /* ── 詳細パネル ────────────────────────────────── */
  function setPauseResumeIcon(isPause) {
    var iconId = isPause ? 'icon-pause' : 'icon-play';
    btnPauseResume.innerHTML = '<svg class="icon" width="16" height="16"><use href="#' + iconId + '"></use></svg>';
  }

  function showDetail(item) {
    if (!item) {
      detailSection.classList.add('hidden');
      return;
    }
    detailSection.classList.remove('hidden');
    var name = item.filename ? item.filename.replace(/^.*[\\/]/, '') : '—';
    detailFilename.textContent = name;
    detailUrl.textContent = item.url || '—';
    detailPath.textContent = item.filename || '—';
    detailStart.textContent = formatDate(item.startTime);
    detailEnd.textContent = item.endTime ? formatTimeOnly(item.endTime) : '—';
    detailSize.textContent = formatBytes(item.totalBytes || item.fileSize);
    detailSpeed.textContent = calcSpeed(item) || '—';
    setPauseResumeIcon(!item.paused && item.state === 'in_progress');
  }

  /* ── データ読込 ────────────────────────────────── */
  function loadDownloads() {
    chrome.downloads.search({}, function (results) {
      sweepDragDupes(results);
      allDownloads = results;
      if (selectedId && !results.some(function (r) { return r.id === selectedId; })) {
        selectedId = null;
      }
      if (selectedId) {
        var sel = results.find(function (r) { return r.id === selectedId; });
        showDetail(sel || null);
      } else {
        selectedId = null;
        showDetail(null);
      }
      renderList();
    });
  }

  /* ── イベントリスナー ──────────────────────────── */
  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);

  btnRefresh.addEventListener('click', loadDownloads);

  btnClear.addEventListener('click', function () {
    if (!confirm(t('confirmClear'))) return;
    chrome.downloads.erase({}, function () {
      selectedId = null;
      showDetail(null);
      loadDownloads();
    });
  });

  btnPauseResume.addEventListener('click', function () {
    if (!selectedId) return;
    chrome.downloads.search({ id: selectedId }, function (items) {
      var item = items[0];
      if (!item) return;
      if (item.state === 'in_progress') {
        chrome.downloads.pause(selectedId);
        setPauseResumeIcon(false);
      } else if (item.paused) {
        chrome.downloads.resume(selectedId);
        setPauseResumeIcon(true);
      }
    });
  });

  btnResume.addEventListener('click', function () {
    if (!selectedId) return;
    chrome.downloads.search({ id: selectedId }, function (items) {
      var item = items[0];
      if (!item) return;
      if (item.paused) {
        chrome.downloads.resume(selectedId);
      }
    });
  });

  btnFinder.addEventListener('click', function () {
    var item = selectedId ? allDownloads.find(function (r) { return r.id === selectedId; }) : null;
    openFolderForItem(item);
  });

  /* ── 初期化 ────────────────────────────────────── */
  applyI18n();
  loadDownloads();

  // 1秒ごとにポーリングして一覧を更新
  setInterval(loadDownloads, 1000);
})();
