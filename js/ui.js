/**
 * Odoo Code Analyzer - UI Module
 * ===============================
 * Manages all UI components and user interactions including:
 *   - Navigation system (sidebar, hamburger menu)
 *   - File uploader with drag-and-drop and ZIP extraction
 *   - Dashboard rendering with animated counters & health gauge
 *   - Error list with filtering (severity, category, file, search)
 *   - Code viewer with syntax highlighting
 *   - Side-by-side diff view
 *   - File tree explorer
 *   - Report rendering
 *   - Toast notifications
 *   - Loading overlay
 *   - Export to PDF, Word, and JSON
 *
 * Dependencies (loaded before this file):
 *   - JSZip          (for ZIP extraction)
 *   - hljs           (highlight.js for syntax highlighting)
 *   - html2pdf       (for PDF export)
 *
 * Exposes: window.OdooAnalyzer.UI
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};

window.OdooAnalyzer.UI = (function () {
  'use strict';

  // ============================================================
  // Internal State
  // ============================================================

  /** @type {Array<{name: string, path: string, type: string, content: string}>} */
  let _files = [];

  /** Callback invoked when files change (set by initFileUploader) */
  let _onFilesChanged = null;

  /** Debounce timer for search input */
  let _searchDebounceTimer = null;

  /** Valid file extensions for upload */
  const VALID_EXTENSIONS = ['.py', '.xml', '.csv', '.zip', '.txt'];

  /** Icon map for file extensions */
  const FILE_ICONS = {
    '.py': '🐍',
    '.xml': '📋',
    '.csv': '📊',
    '.zip': '📦',
    '.txt': '📄',
  };

  // ============================================================
  // Navigation System
  // ============================================================

  /**
   * Initialise click handlers on all .nav-item elements and the
   * hamburger toggle for mobile sidebar.
   */
  function initNavigation() {
    try {
      // Mobile hamburger toggle
      const hamburger = document.getElementById('hamburger-toggle');
      const sidebar = document.getElementById('sidebar');
      if (hamburger && sidebar) {
        hamburger.addEventListener('click', () => {
          sidebar.classList.toggle('open');
        });
      }

      // Close sidebar when clicking main content on mobile
      const mainContent = document.getElementById('main-content');
      if (mainContent && sidebar) {
        mainContent.addEventListener('click', () => {
          if (window.innerWidth < 768) {
            sidebar.classList.remove('open');
          }
        });
      }
    } catch (err) {
      console.error('[UI] initNavigation error:', err);
    }
  }

  /**
   * Switch visible section and update active nav item.
   * @param {string} sectionId - ID suffix for the target section (e.g. 'dashboard' or 'section-dashboard')
   */
  function navigateTo(sectionId) {
    try {
      if (!sectionId) return;

      // Normalize to short name (e.g. 'section-dashboard' -> 'dashboard')
      const shortId = sectionId.startsWith('section-') ? sectionId.replace('section-', '') : sectionId;

      // Hide all sections
      const sections = document.querySelectorAll('.section, .content-section');
      sections.forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
      });

      // Show target section
      const target =
        document.getElementById(shortId) ||
        document.getElementById(`section-${shortId}`);
      if (target) {
        target.classList.add('active');
        target.style.display = '';
      }

      // Update nav items
      document.querySelectorAll('.nav-item').forEach(item => {
        const itemSection = item.getAttribute('data-section') || '';
        const itemShort = itemSection.startsWith('section-') ? itemSection.replace('section-', '') : itemSection;
        item.classList.toggle('active', itemShort === shortId);
      });

      // Close mobile sidebar
      const sidebar = document.getElementById('sidebar');
      if (sidebar && window.innerWidth < 768) {
        sidebar.classList.remove('open');
      }
    } catch (err) {
      console.error('[UI] navigateTo error:', err);
    }
  }

  // ============================================================
  // File Uploader
  // ============================================================

  /**
   * Initialise the file upload area with drag-and-drop and click support.
   * @param {Function} [onFilesChanged] - Callback invoked when files are added/removed
   */
  function initFileUploader(onFilesChanged) {
    try {
      _onFilesChanged = onFilesChanged || null;

      const dropZone = document.getElementById('drop-zone');
      const fileInput = document.getElementById('file-input');

      if (!dropZone || !fileInput) {
        console.warn('[UI] drop-zone or file-input element not found.');
        return;
      }

      // Drag-over: visual feedback
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });

      // Drag-leave: remove feedback
      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });

      // Drop handler
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');

        const droppedFiles = e.dataTransfer ? e.dataTransfer.files : null;
        if (droppedFiles && droppedFiles.length > 0) {
          await _processFiles(droppedFiles);
        }
      });

      // Click on drop zone opens file dialog
      dropZone.addEventListener('click', () => {
        fileInput.click();
      });

      // File input change
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
          await _processFiles(fileInput.files);
          // Reset input so the same file can be re-selected
          fileInput.value = '';
        }
      });
    } catch (err) {
      console.error('[UI] initFileUploader error:', err);
    }
  }

  /**
   * Process a FileList: filter by extension, extract ZIPs, read contents.
   * @param {FileList} fileList
   * @private
   */
  async function _processFiles(fileList) {
    try {
      showLoading('Memproses file...');

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const ext = _getExtension(file.name);

        if (!VALID_EXTENSIONS.includes(ext)) {
          showToast(`File "${file.name}" ditolak: Format tidak didukung.`, 'error');
          continue; // Skip invalid extensions
        }

        if (file.size > 10 * 1024 * 1024) {
          showToast(`File "${file.name}" ditolak: Ukuran melebihi batas 10MB.`, 'error');
          continue; // Skip file larger than 10MB
        }

        try {
          if (ext === '.zip') {
            // Extract ZIP using JSZip
            await _extractZip(file);
          } else {
            // Read text file
            const content = await _readFileAsText(file);
            _files.push({
              name: file.name,
              path: file.name,
              type: ext.replace('.', ''),
              content: content,
            });
          }
        } catch (innerErr) {
          console.error(`[UI] Error reading file ${file.name}:`, innerErr);
          showToast(`Gagal membaca "${file.name}": ${innerErr.message}`, 'error');
        }
      }

      renderFileList();
      _updateFileCount();

      if (_onFilesChanged) {
        _onFilesChanged(_files);
      }

      hideLoading();
    } catch (err) {
      hideLoading();
      console.error('[UI] _processFiles error:', err);
      showToast('Gagal memproses file: ' + err.message, 'error');
    }
  }

  /**
   * Extract a ZIP file and add inner files that match valid extensions.
   * @param {File} zipFile
   * @private
   */
  async function _extractZip(zipFile) {
    if (typeof window.JSZip === 'undefined') {
      showToast('JSZip tidak tersedia. ZIP tidak dapat diekstrak.', 'error');
      return;
    }

    try {
      const arrayBuffer = await _readFileAsArrayBuffer(zipFile);
      const zip = await window.JSZip.loadAsync(arrayBuffer);

      const entries = Object.keys(zip.files);
      for (const entryName of entries) {
        const entry = zip.files[entryName];
        if (entry.dir) continue;

        const ext = _getExtension(entryName);
        // Filter inner files by valid extension (excluding .zip to avoid recursion)
        if (['.py', '.xml', '.csv', '.txt'].includes(ext)) {
          try {
            const content = await entry.async('string');
            _files.push({
              name: entryName.split('/').pop() || entryName,
              path: entryName,
              type: ext.replace('.', ''),
              content: content,
            });
          } catch (innerErr) {
            console.error(`[UI] Error extracting inner file ${entryName}:`, innerErr);
            showToast(`Gagal mengekstrak "${entryName}": ${innerErr.message}`, 'error');
          }
        }
      }
    } catch (err) {
      console.error('[UI] _extractZip error:', err);
      showToast('Gagal mengekstrak ZIP: ' + err.message, 'error');
    }
  }

  /**
   * Render the list of uploaded files in #file-list or #upload-workspace.
   */
  function renderFileList() {
    const fileListEl = document.getElementById('file-list');
    const uploadWorkspace = document.getElementById('upload-workspace');
    const uploadFileTree = document.getElementById('upload-file-tree');
    const uploadFilePreview = document.getElementById('upload-file-preview');

    if (uploadWorkspace && uploadFileTree && uploadFilePreview) {
      if (_files.length === 0) {
        uploadWorkspace.style.display = 'none';
        if (fileListEl) {
          fileListEl.style.display = 'block';
          fileListEl.innerHTML = '<div class="empty-state"><span class="empty-icon">📂</span><p>Belum ada file yang diunggah.</p></div>';
        }
        return;
      }

      if (fileListEl) fileListEl.style.display = 'none';
      uploadWorkspace.style.display = 'grid';

      renderFileTree('upload-file-tree', _files);

      // Keep preview placeholder empty/reset
      uploadFilePreview.innerHTML = `
        <p class="file-preview__empty" style="color: var(--text-secondary); margin: auto; text-align: center;">Klik file pada tree untuk melihat isinya.</p>
      `;
      return;
    }

    if (!fileListEl) return;

    fileListEl.innerHTML = '';

    if (_files.length === 0) {
      fileListEl.innerHTML =
        '<div class="empty-state"><span class="empty-icon">📂</span><p>Belum ada file yang diunggah.</p></div>';
      return;
    }

    const maxDisplay = 100;
    const filesToDisplay = _files.slice(0, maxDisplay);

    filesToDisplay.forEach((file, index) => {
      const ext = '.' + file.type;
      const icon = FILE_ICONS[ext] || '📄';
      const sizeStr = file.content ? _formatBytes(file.content.length) : '0 B';

      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name" title="${_escapeHtml(file.path)}">${_escapeHtml(file.name)}</span>
        <span class="file-size">${sizeStr}</span>
        <button class="file-remove-btn" data-index="${index}" title="Hapus file">&times;</button>
      `;

      // Remove button handler
      const removeBtn = item.querySelector('.file-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _files.splice(index, 1);
          renderFileList();
          _updateFileCount();
          if (_onFilesChanged) _onFilesChanged(_files);
        });
      }

      fileListEl.appendChild(item);
    });

    if (_files.length > maxDisplay) {
      const moreItem = document.createElement('div');
      moreItem.className = 'file-item-more';
      moreItem.style.padding = 'var(--space-2) var(--space-4)';
      moreItem.style.color = 'var(--text-secondary)';
      moreItem.style.fontSize = 'var(--font-size-sm)';
      moreItem.style.textAlign = 'center';
      moreItem.style.borderTop = '1px dashed var(--glass-border)';
      moreItem.textContent = `... dan ${_files.length - maxDisplay} file lainnya telah dimuat`;
      fileListEl.appendChild(moreItem);
    }
  }

  /**
   * Remove all uploaded files.
   */
  function clearFiles() {
    _files = [];
    renderFileList();
    _updateFileCount();
    if (_onFilesChanged) _onFilesChanged(_files);
  }

  /**
   * Return the current array of uploaded files.
   * @returns {Array<{name: string, path: string, type: string, content: string}>}
   */
  function getFiles() {
    return _files;
  }

  /**
   * Update the #file-count element with the current count.
   * @private
   */
  function _updateFileCount() {
    const fileCountEl = document.getElementById('file-count');
    if (fileCountEl) {
      fileCountEl.textContent = `${_files.length} file`;
    }
  }

  // ============================================================
  // Dashboard
  // ============================================================

  /**
   * Render dashboard stat cards with animated counters.
   * @param {Object} stats
   * @param {number} stats.modules
   * @param {number} stats.models - alias: stats.totalModels
   * @param {number} stats.fields
   * @param {number} stats.methods
   * @param {number} stats.views
   * @param {string} [stats.odooVersion]
   */
  function renderDashboard(stats) {
    if (!stats) return;

    try {
      // Map of element ID → stat value
      const cardMap = {
        'stat-modules': stats.modules || stats.totalModules || 0,
        'stat-models': stats.models || stats.totalModels || 0,
        'stat-fields': stats.fields || stats.totalFields || 0,
        'stat-methods': stats.methods || stats.totalMethods || 0,
        'stat-views': stats.views || stats.totalViews || 0,
      };

      Object.entries(cardMap).forEach(([id, value]) => {
        const card = document.getElementById(id);
        if (card) {
          const valEl = card.querySelector('.stat-card__value') || card;
          animateCounter(valEl, value, 1000);
        }
      });

      // Odoo version badge
      const versionBadge = document.getElementById('odoo-version');
      if (versionBadge && stats.odooVersionDetected) {
        versionBadge.textContent = `Versi Odoo: ${stats.odooVersionDetected}`;
      } else if (versionBadge && stats.odooVersion) {
        versionBadge.textContent = `Versi Odoo: ${stats.odooVersion}`;
      }

      // Health gauge
      if (typeof stats.healthScore === 'number') {
        renderHealthGauge(stats.healthScore);
      }

      // Update health score label text
      const healthLabel = document.getElementById('health-score-label');
      if (healthLabel && typeof stats.healthScore === 'number') {
        const score = stats.healthScore;
        const lang = localStorage.getItem('lang') || 'id';
        if (lang === 'en') {
          healthLabel.textContent = score >= 70 ? 'Excellent' : (score >= 40 ? 'Needs Attention' : 'Critical');
        } else {
          healthLabel.textContent = score >= 70 ? 'Baik' : (score >= 40 ? 'Perlu Perhatian' : 'Kritis');
        }
      }

      // Issues summary
      if (stats.issues) {
        renderIssuesSummary(stats.issues);
      } else if (stats.issuesBySeverity) {
        const criticalEl = document.getElementById('issues-critical');
        const warningEl = document.getElementById('issues-warning');
        const infoEl = document.getElementById('issues-info');

        if (criticalEl) {
          const valEl = criticalEl.querySelector('.issue-card__count') || criticalEl;
          animateCounter(valEl, stats.issuesBySeverity.critical || 0, 800);
        }
        if (warningEl) {
          const valEl = warningEl.querySelector('.issue-card__count') || warningEl;
          animateCounter(valEl, stats.issuesBySeverity.warning || 0, 800);
        }
        if (infoEl) {
          const valEl = infoEl.querySelector('.issue-card__count') || infoEl;
          animateCounter(valEl, stats.issuesBySeverity.info || 0, 800);
        }
      }

      // Category SVG bar chart inside #quick-stats
      const lang = localStorage.getItem('lang') || 'id';
      const catLabels = {
        id: {
          deprecated: '⏳ Deprecated',
          security: '🔒 Keamanan',
          performance: '⚡ Performa',
          bad_practice: '⚠️ Bad Practice',
          missing: '❓ Komponen Hilang',
          inheritance: '🔗 Inheritance',
          data_integrity: '💾 Data Integrity',
        },
        en: {
          deprecated: '⏳ Deprecated',
          security: '🔒 Security',
          performance: '⚡ Performance',
          bad_practice: '⚠️ Bad Practice',
          missing: '❓ Missing Components',
          inheritance: '🔗 Inheritance',
          data_integrity: '💾 Data Integrity',
        }
      }[lang];

      const catColors = {
        deprecated: '#7c5cfc',
        security: '#ff6b6b',
        performance: '#ffc048',
        bad_practice: '#ffa502',
        missing: '#74b9ff',
        inheritance: '#00d4aa',
        data_integrity: '#00b894'
      };

      const quickStatsEl = document.getElementById('quick-stats');
      if (quickStatsEl) {
        quickStatsEl.style.display = 'none';
      }

      // Render Severity Donut Chart
      const chartSeverityEl = document.getElementById('chart-severity-container');
      if (chartSeverityEl) {
        chartSeverityEl.innerHTML = '';
        
        let critical = 0, warning = 0, info = 0;
        if (stats.issues) {
          critical = stats.issues.filter(i => i.severity === 'critical' || i.severity === 'error').length;
          warning = stats.issues.filter(i => i.severity === 'warning').length;
          info = stats.issues.filter(i => i.severity === 'info').length;
        } else if (stats.issuesBySeverity) {
          critical = stats.issuesBySeverity.critical || 0;
          warning = stats.issuesBySeverity.warning || 0;
          info = stats.issuesBySeverity.info || 0;
        }

        const total = critical + warning + info;
        
        if (total === 0) {
          const emptyText = lang === 'en' ? 'No issues detected' : 'Tidak ada masalah terdeteksi';
          chartSeverityEl.innerHTML = `<div style="color:var(--text-secondary); font-size:0.9rem;">${emptyText}</div>`;
        } else {
          const pCrit = critical / total;
          const pWarn = warning / total;
          const pInfo = info / total;

          const cCrit = 314.159 * pCrit;
          const cWarn = 314.159 * pWarn;
          const cInfo = 314.159 * pInfo;

          const offsetCrit = 0;
          const offsetWarn = -cCrit;
          const offsetInfo = -(cCrit + cWarn);

          chartSeverityEl.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; width:100%;">
              <svg width="180" height="180" viewBox="0 0 200 200">
                <!-- Background track -->
                <circle cx="100" cy="100" r="50" fill="transparent" stroke="rgba(255,255,255,0.03)" stroke-width="14"></circle>
                <!-- Critical Segment -->
                ${critical > 0 ? `
                  <circle cx="100" cy="100" r="50" fill="transparent" stroke="#ff6b6b" stroke-width="14" 
                    stroke-dasharray="${cCrit} 314.159" stroke-dashoffset="${offsetCrit}" 
                    transform="rotate(-90 100 100)" style="cursor:pointer; transition: stroke-width 0.2s;"
                    class="donut-segment" data-severity="critical" title="Critical: ${critical}">
                  </circle>
                ` : ''}
                <!-- Warning Segment -->
                ${warning > 0 ? `
                  <circle cx="100" cy="100" r="50" fill="transparent" stroke="#ffc048" stroke-width="14" 
                    stroke-dasharray="${cWarn} 314.159" stroke-dashoffset="${offsetWarn}" 
                    transform="rotate(-90 100 100)" style="cursor:pointer; transition: stroke-width 0.2s;"
                    class="donut-segment" data-severity="warning" title="Warning: ${warning}">
                  </circle>
                ` : ''}
                <!-- Info Segment -->
                ${info > 0 ? `
                  <circle cx="100" cy="100" r="50" fill="transparent" stroke="#74b9ff" stroke-width="14" 
                    stroke-dasharray="${cInfo} 314.159" stroke-dashoffset="${offsetInfo}" 
                    transform="rotate(-90 100 100)" style="cursor:pointer; transition: stroke-width 0.2s;"
                    class="donut-segment" data-severity="info" title="Info: ${info}">
                  </circle>
                ` : ''}
                <!-- Center Text -->
                <text x="100" y="98" text-anchor="middle" fill="#e8e8f0" font-size="22" font-family="Inter, sans-serif" font-weight="700">${total}</text>
                <text x="100" y="118" text-anchor="middle" fill="#8888a8" font-size="10" font-family="Inter, sans-serif" font-weight="600" letter-spacing="1">TEMUAN</text>
              </svg>
              <div class="donut-legend" style="display:flex; justify-content:center; gap:12px; font-size:0.8rem; margin-top:16px; flex-wrap:wrap; color:#e8e8f0;">
                <span class="legend-item" style="display:flex; align-items:center; gap:4px; cursor:pointer;" data-severity="critical"><span style="width:8px; height:8px; background:#ff6b6b; border-radius:50%; display:inline-block;"></span> Critical (${critical})</span>
                <span class="legend-item" style="display:flex; align-items:center; gap:4px; cursor:pointer;" data-severity="warning"><span style="width:8px; height:8px; background:#ffc048; border-radius:50%; display:inline-block;"></span> Warning (${warning})</span>
                <span class="legend-item" style="display:flex; align-items:center; gap:4px; cursor:pointer;" data-severity="info"><span style="width:8px; height:8px; background:#74b9ff; border-radius:50%; display:inline-block;"></span> Info (${info})</span>
              </div>
            </div>
          `;

          // Add click handlers
          chartSeverityEl.querySelectorAll('.donut-segment, .legend-item').forEach(el => {
            el.addEventListener('click', () => {
              const severity = el.getAttribute('data-severity');
              if (severity && window.OdooAnalyzer.App) {
                window.OdooAnalyzer.App.state.filters.severity = severity;
                window.OdooAnalyzer.App.navigateTo('errors');
              }
            });
          });
        }
      }

      // Render Category Bar Chart
      const chartCategoryEl = document.getElementById('chart-category-container');
      if (chartCategoryEl && stats.issuesByCategory) {
        chartCategoryEl.innerHTML = '';
        
        const categories = Object.keys(stats.issuesByCategory);
        const maxVal = Math.max(...Object.values(stats.issuesByCategory), 1);
        
        let svgRows = '';
        const rowHeight = 35;
        const chartWidth = 500;
        const barStart = 160; // offset for labels
        const barMaxWidth = chartWidth - barStart - 40;

        categories.forEach((cat, idx) => {
          const val = stats.issuesByCategory[cat] || 0;
          const barWidth = (val / maxVal) * barMaxWidth;
          const y = idx * rowHeight + 20;
          const label = catLabels[cat] || cat;
          const color = catColors[cat] || '#7c5cfc';

          svgRows += `
            <g class="category-bar-group" data-category="${cat}" style="cursor:pointer;">
              <text x="10" y="${y + 13}" fill="#8888a8" font-size="11" font-family="Inter, sans-serif" font-weight="500">${_escapeHtml(label)}</text>
              <rect x="${barStart}" y="${y}" width="${barMaxWidth}" height="16" rx="4" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
              <rect x="${barStart}" y="${y}" width="${barWidth}" height="16" rx="4" fill="${color}">
                <animate attributeName="width" from="0" to="${barWidth}" dur="0.8s" fill="freeze" />
              </rect>
              <text x="${barStart + barWidth + 8}" y="${y + 12}" fill="#e8e8f0" font-size="11" font-family="Inter, sans-serif" font-weight="600">${val}</text>
            </g>
          `;
        });

        const svgHeight = categories.length * rowHeight + 30;

        chartCategoryEl.innerHTML = `
          <div style="width: 100%; overflow-x: auto;">
            <svg width="100%" height="${svgHeight}" viewBox="0 0 ${chartWidth} ${svgHeight}" preserveAspectRatio="xMinYMin meet" style="min-width: 450px;">
              ${svgRows}
            </svg>
          </div>
        `;

        // Add click handlers for category bars
        chartCategoryEl.querySelectorAll('.category-bar-group').forEach(group => {
          group.addEventListener('click', () => {
            const category = group.getAttribute('data-category');
            if (category && window.OdooAnalyzer.App) {
              window.OdooAnalyzer.App.state.filters.category = category;
              window.OdooAnalyzer.App.navigateTo('errors');
            }
          });
        });
      }
    } catch (err) {
      console.error('[UI] renderDashboard error:', err);
    }
  }

  /**
   * Animate a numeric counter from 0 to target over duration ms.
   * @param {HTMLElement} element
   * @param {number} target
   * @param {number} duration - milliseconds
   */
  function animateCounter(element, target, duration) {
    if (!element) return;

    const startTime = performance.now();
    const startValue = 0;
    target = Math.round(target);

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.round(startValue + (target - startValue) * easedProgress);

      element.textContent = currentValue.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = target.toLocaleString();
      }
    }

    requestAnimationFrame(update);
  }

  /**
   * Render an SVG health gauge (arc) with a score from 0-100.
   * @param {number} score - 0 to 100
   */
  function renderHealthGauge(score) {
    const container = document.getElementById('health-gauge');
    if (!container) return;

    score = Math.max(0, Math.min(100, Math.round(score)));

    // Determine colour based on score
    let strokeColor;
    let gradientId = 'health-gradient';
    if (score < 40) {
      strokeColor = '#ff4757'; // red
    } else if (score < 70) {
      strokeColor = '#ffa502'; // yellow/amber
    } else {
      strokeColor = '#2ed573'; // green
    }

    // SVG dimensions
    const size = 180;
    const strokeWidth = 14;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - score / 100);
    const center = size / 2;

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="health-gauge-svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="${strokeColor}" stop-opacity="1"/>
          </linearGradient>
          <filter id="gauge-glow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <!-- Background circle -->
        <circle
          cx="${center}" cy="${center}" r="${radius}"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
        />

        <!-- Foreground arc -->
        <circle
          cx="${center}" cy="${center}" r="${radius}"
          fill="none"
          stroke="url(#${gradientId})"
          stroke-width="${strokeWidth}"
          stroke-linecap="round"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${circumference}"
          transform="rotate(-90 ${center} ${center})"
          filter="url(#gauge-glow)"
          class="health-gauge-arc"
          data-target-offset="${dashOffset}"
        />

        <!-- Score text -->
        <text x="${center}" y="${center - 8}" text-anchor="middle" dominant-baseline="central"
              fill="#e8e8f0" font-size="42" font-weight="700" font-family="Inter, sans-serif">
          ${score}
        </text>

        <!-- Label -->
        <text x="${center}" y="${center + 28}" text-anchor="middle" dominant-baseline="central"
              fill="#8888a8" font-size="13" font-family="Inter, sans-serif">
          ${localStorage.getItem('lang') === 'en' ? 'Health Score' : 'Skor Kesehatan'}
        </text>
      </svg>
    `;

    container.innerHTML = svg;

    // Animate the arc drawing
    requestAnimationFrame(() => {
      const arc = container.querySelector('.health-gauge-arc');
      if (arc) {
        // Trigger reflow so the initial dashoffset is applied
        arc.getBoundingClientRect();
        arc.style.transition = 'stroke-dashoffset 1.5s ease-out';
        arc.style.strokeDashoffset = dashOffset;
      }
    });
  }

  /**
   * Update issue summary counters.
   * @param {Array<{severity: string}>} issues
   */
  function renderIssuesSummary(issues) {
    if (!Array.isArray(issues)) return;

    const counts = { critical: 0, warning: 0, info: 0 };
    issues.forEach(issue => {
      const sev = (issue.severity || '').toLowerCase();
      if (sev === 'critical' || sev === 'error') counts.critical++;
      else if (sev === 'warning') counts.warning++;
      else counts.info++;
    });

    const criticalEl = document.getElementById('issues-critical');
    const warningEl = document.getElementById('issues-warning');
    const infoEl = document.getElementById('issues-info');

    if (criticalEl) {
      const valEl = criticalEl.querySelector('.issue-card__count') || criticalEl;
      animateCounter(valEl, counts.critical, 800);
    }
    if (warningEl) {
      const valEl = warningEl.querySelector('.issue-card__count') || warningEl;
      animateCounter(valEl, counts.warning, 800);
    }
    if (infoEl) {
      const valEl = infoEl.querySelector('.issue-card__count') || infoEl;
      animateCounter(valEl, counts.info, 800);
    }
  }

  // ============================================================
  // Error List
  // ============================================================

  /**
   * Render a list of error / issue cards.
   * @param {Array} issues - Array of issue objects
   * @param {Object} filters - { severity, category, file, search }
   */
  function renderErrorList(issues, filters) {
    const container = document.getElementById('error-list');
    if (!container) return;

    try {
      let filtered = Array.isArray(issues) ? [...issues] : [];

      // Apply filters
      if (filters) {
        if (filters.severity && filters.severity !== 'all') {
          filtered = filtered.filter(i => i.severity === filters.severity);
        }
        if (filters.category && filters.category !== 'all') {
          filtered = filtered.filter(i => i.category === filters.category);
        }
        if (filters.file && filters.file !== 'all') {
          filtered = filtered.filter(i => i.file === filters.file);
        }
        if (filters.search) {
          const q = filters.search.toLowerCase();
          filtered = filtered.filter(i =>
            (i.title || '').toLowerCase().includes(q) ||
            (i.description || '').toLowerCase().includes(q) ||
            (i.rule || i.ruleId || '').toLowerCase().includes(q)
          );
        }
      }

      // Update summary stats
      _updateErrorSummary(filtered);

      const lang = localStorage.getItem('lang') || 'id';

      // Empty state
      if (filtered.length === 0) {
        const emptyText = lang === 'en' 
          ? `No issues found${filters && filters.search ? ' for this search' : ''}.`
          : `Tidak ada masalah yang ditemukan${filters && filters.search ? ' untuk pencarian ini' : ''}.`;
        container.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">🎉</span>
            <p>${emptyText}</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';

      filtered.forEach(issue => {
        const card = _createErrorCard(issue);
        container.appendChild(card);
      });
    } catch (err) {
      console.error('[UI] renderErrorList error:', err);
    }
  }

  /**
   * Create a single error card DOM element.
   * @param {Object} issue
   * @returns {HTMLElement}
   * @private
   */
  function _createErrorCard(issue) {
    const card = document.createElement('div');
    card.className = 'error-card';
    card.setAttribute('data-issue-id', issue.id || '');

    const lang = localStorage.getItem('lang') || 'id';

    // Translate labels
    const labels = {
      id: {
        relatedCode: 'Kode Terkait:',
        suggestedFix: '💡 Saran Perbaikan:',
        viewFix: '🔧 Lihat Perbaikan',
        unknownIssue: 'Masalah Tidak Diketahui'
      },
      en: {
        relatedCode: 'Related Code:',
        suggestedFix: '💡 Suggested Fix:',
        viewFix: '🔧 View Fix',
        unknownIssue: 'Unknown Issue'
      }
    }[lang];

    // Look up rule translation if language is English
    const ruleId = issue.ruleId || issue.id?.split('_')[0];
    let title = issue.title;
    let description = issue.description;
    let suggestion = issue.suggestion || issue.recommendation;

    if (lang === 'en' && window.OdooAnalyzer.RULE_TRANSLATIONS?.[ruleId]) {
      const t = window.OdooAnalyzer.RULE_TRANSLATIONS[ruleId];
      title = t.title;
      description = t.description;
      suggestion = t.suggestion;
    }

    // Category label translation
    const categoryLabels = {
      id: {
        deprecated: '⏳ Deprecated',
        security: '🔒 Keamanan',
        performance: '⚡ Performa',
        bad_practice: '⚠️ Bad Practice',
        missing: '❓ Komponen Hilang',
        inheritance: '🔗 Inheritance',
        data_integrity: '💾 Data Integrity',
      },
      en: {
        deprecated: '⏳ Deprecated',
        security: '🔒 Security',
        performance: '⚡ Performance',
        bad_practice: '⚠️ Bad Practice',
        missing: '❓ Missing Components',
        inheritance: '🔗 Inheritance',
        data_integrity: '💾 Data Integrity',
      }
    }[lang];

    const categoryText = categoryLabels[issue.category] || issue.category;
    const severityText = lang === 'en' ? _capitalize(issue.severity) : {
      critical: 'Kritis',
      warning: 'Peringatan',
      info: 'Info'
    }[issue.severity] || _capitalize(issue.severity);

    // Severity class and label
    const severityClass = _getSeverityClass(issue.severity);

    // File:line reference
    const fileRef = issue.file
      ? `${_escapeHtml(issue.file)}${issue.line ? ':' + issue.line : ''}`
      : '';

    const codeVal = issue.codeSnippet || issue.code;

    card.innerHTML = `
      <div class="error-card-header">
        <div class="error-card-meta">
          <span class="badge badge-${severityClass}">${severityText}</span>
          <span class="badge badge-category">${_escapeHtml(categoryText || '')}</span>
          ${fileRef ? `<span class="error-file-ref">${fileRef}</span>` : ''}
        </div>
        <h4 class="error-card-title">${_escapeHtml(title || labels.unknownIssue)}</h4>
        <p class="error-card-desc">${_escapeHtml(description || '')}</p>
      </div>

      <div class="error-card-details">
        ${codeVal ? `
          <div class="error-code-snippet">
            <h5>${labels.relatedCode}</h5>
            <pre><code class="language-python">${_escapeHtml(codeVal)}</code></pre>
          </div>
        ` : ''}

        ${suggestion ? `
          <div class="error-suggestion">
            <h5>${labels.suggestedFix}</h5>
            <p>${_escapeHtml(suggestion)}</p>
          </div>
        ` : ''}

        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="btn btn-sm btn-accent" data-action="view-fix" data-issue-id="${_escapeHtml(issue.id || '')}">
            ${labels.viewFix}
          </button>
          <button class="btn btn-sm btn-secondary" data-action="open-comments" data-issue-id="${_escapeHtml(issue.id || '')}" style="display: flex; align-items: center; gap: 4px;">
            ${lang === 'en' ? '💬 Discussion' : '💬 Diskusi'}
          </button>
        </div>
      </div>
    `;

    // Toggle expansion on card header click
    const header = card.querySelector('.error-card-header');
    if (header) {
      header.addEventListener('click', () => {
        card.classList.toggle('expanded');
      });
    }

    // Apply syntax highlighting to code snippets
    requestAnimationFrame(() => {
      const codeBlock = card.querySelector('pre code');
      if (codeBlock && typeof hljs !== 'undefined') {
        try {
          hljs.highlightElement(codeBlock);
        } catch (_) { /* ignore highlighting errors */ }
      }
    });

    return card;
  }

  /**
   * Update the error summary badges.
   * @param {Array} filtered
   * @private
   */
  function _updateErrorSummary(filtered) {
    const summaryEl = document.getElementById('error-summary');
    if (!summaryEl) return;

    const total = filtered.length;
    const critical = filtered.filter(i => i.severity === 'critical' || i.severity === 'error').length;
    const warning = filtered.filter(i => i.severity === 'warning').length;
    const info = total - critical - warning;

    summaryEl.innerHTML = `
      <span class="badge badge-critical">${critical} Critical</span>
      <span class="badge badge-warning">${warning} Warning</span>
      <span class="badge badge-info">${info} Info</span>
      <span class="badge badge-total">${total} Total</span>
    `;
  }

  /**
   * Initialise error filter controls.
   */
  function initErrorFilters() {
    try {
      // Severity filter buttons
      document.querySelectorAll('[data-filter-severity]').forEach(btn => {
        btn.addEventListener('click', () => {
          // Toggle active class
          document.querySelectorAll('[data-filter-severity]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      // Search input with debounce
      const searchInput = document.getElementById('error-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(_searchDebounceTimer);
          _searchDebounceTimer = setTimeout(() => {
            // The actual filtering is handled by the app controller
            // which reads the search value and re-renders
            const event = new CustomEvent('error-search-changed', {
              detail: { value: searchInput.value },
            });
            document.dispatchEvent(event);
          }, 300);
        });
      }

      // Category dropdown
      const categoryFilter = document.getElementById('filter-category');
      if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
          const event = new CustomEvent('error-category-changed', {
            detail: { value: categoryFilter.value },
          });
          document.dispatchEvent(event);
        });
      }

      // File dropdown
      const fileFilter = document.getElementById('filter-file');
      if (fileFilter) {
        fileFilter.addEventListener('change', () => {
          const event = new CustomEvent('error-file-changed', {
            detail: { value: fileFilter.value },
          });
          document.dispatchEvent(event);
        });
      }
    } catch (err) {
      console.error('[UI] initErrorFilters error:', err);
    }
  }

  // ============================================================
  // Code Viewer
  // ============================================================

  /**
   * Render code with line numbers and optional highlighted lines.
   * @param {string} containerId - DOM element ID
   * @param {string} content - Source code string
   * @param {string} language - 'python' | 'xml' | 'csv'
   * @param {Array<{line: number, type: string, message: string}>} [highlights]
   */
  function renderCodeViewer(containerId, content, language, highlights) {
    const container = document.getElementById(containerId);
    if (!container || !content) return;

    try {
      const lines = content.split('\n');
      const highlightMap = {};

      if (Array.isArray(highlights)) {
        highlights.forEach(h => {
          highlightMap[h.line] = h;
        });
      }

      let lineNumbersHtml = '';
      let codeHtml = '';

      lines.forEach((line, idx) => {
        const lineNum = idx + 1;
        const highlight = highlightMap[lineNum];
        const highlightClass = highlight ? ` line-${highlight.type}` : '';
        const tooltipAttr = highlight && highlight.message
          ? ` title="${_escapeHtml(highlight.message)}"`
          : '';

        lineNumbersHtml += `<div class="line-number${highlightClass}"${tooltipAttr}>${lineNum}</div>\n`;
        codeHtml += `<div class="code-line${highlightClass}"${tooltipAttr}>${_escapeHtml(line)}</div>\n`;
      });

      // Map language to hljs-compatible class
      const langMap = { python: 'python', xml: 'xml', csv: 'plaintext' };
      const langClass = langMap[language] || 'plaintext';

      container.innerHTML = `
        <div class="code-viewer">
          <div class="line-numbers">${lineNumbersHtml}</div>
          <div class="code-content">
            <pre><code class="language-${langClass}">${codeHtml}</code></pre>
          </div>
        </div>
      `;

      // Apply syntax highlighting
      const codeBlock = container.querySelector('pre code');
      if (codeBlock && typeof hljs !== 'undefined') {
        try {
          hljs.highlightElement(codeBlock);
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.error('[UI] renderCodeViewer error:', err);
    }
  }

  // ============================================================
  // Diff View
  // ============================================================

  /**
   * Render a side-by-side diff view.
   * @param {string} containerId - DOM element ID
   * @param {string} original - Original source code
   * @param {string} fixed - Fixed source code
   * @param {Array<{line: number, type: string, description: string}>} [fixes]
   */
  function renderDiffView(containerId, original, fixed, fixes) {
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : document.getElementById('diff-view');

    // Allow calling with (original, fixed, fixes) when containerId is actually original
    let _original = original;
    let _fixed = fixed;
    let _fixes = fixes;

    if (!container && typeof containerId === 'string') {
      // If containerId doesn't match a DOM element, treat args as shifted
      // (backward compat with app.js calling UI.renderDiffView(original, fixed, fixes))
      const fallbackContainer = document.getElementById('diff-view');
      if (fallbackContainer) {
        _original = containerId;
        _fixed = original;
        _fixes = fixed;
        _renderDiffInto(fallbackContainer, _original, _fixed, _fixes);
        return;
      }
      console.warn('[UI] renderDiffView: container not found');
      return;
    }

    if (container) {
      _renderDiffInto(container, _original, _fixed, _fixes);
    }
  }

  /**
   * Internal: render diff content into a container.
   * @private
   */
  function _renderDiffInto(container, original, fixed, fixes) {
    try {
      const origLines = (original || '').split('\n');
      const fixedLines = (fixed || '').split('\n');

      // Build a fix map: line number → fix info
      const fixMap = {};
      if (Array.isArray(fixes)) {
        fixes.forEach(f => {
          fixMap[f.line] = f;
        });
      }

      const maxLines = Math.max(origLines.length, fixedLines.length);

      let origHtml = '';
      let fixedHtml = '';

      for (let i = 0; i < maxLines; i++) {
        const lineNum = i + 1;
        const origLine = i < origLines.length ? origLines[i] : '';
        const fixedLine = i < fixedLines.length ? fixedLines[i] : '';
        const fix = fixMap[lineNum];

        let origClass = '';
        let fixedClass = '';

        if (fix) {
          switch (fix.type) {
            case 'remove':
              origClass = 'diff-removed';
              break;
            case 'add':
              fixedClass = 'diff-added';
              break;
            case 'modify':
              origClass = 'diff-modified';
              fixedClass = 'diff-modified';
              break;
          }
        } else if (origLine !== fixedLine) {
          // Auto-detect changes
          if (origLine && !fixedLine) origClass = 'diff-removed';
          else if (!origLine && fixedLine) fixedClass = 'diff-added';
          else if (origLine !== fixedLine) {
            origClass = 'diff-modified';
            fixedClass = 'diff-modified';
          }
        }

        const tooltip = fix && fix.description ? ` title="${_escapeHtml(fix.description)}"` : '';

        origHtml += `<div class="diff-line ${origClass}"${tooltip}><span class="diff-line-num">${lineNum}</span><span class="diff-line-content">${_escapeHtml(origLine)}</span></div>\n`;
        fixedHtml += `<div class="diff-line ${fixedClass}"${tooltip}><span class="diff-line-num">${lineNum}</span><span class="diff-line-content">${_escapeHtml(fixedLine)}</span></div>\n`;
      }

      container.innerHTML = `
        <div class="diff-view-container">
          <div class="diff-panel diff-panel-original">
            <div class="diff-panel-header">📄 Original</div>
            <div class="diff-panel-content" id="diff-original-scroll">${origHtml}</div>
          </div>
          <div class="diff-panel diff-panel-fixed">
            <div class="diff-panel-header">✅ Diperbaiki</div>
            <div class="diff-panel-content" id="diff-fixed-scroll">${fixedHtml}</div>
          </div>
        </div>
      `;

      // Sync scrolling between panels
      _syncScroll('diff-original-scroll', 'diff-fixed-scroll');
    } catch (err) {
      console.error('[UI] renderDiffView error:', err);
    }
  }

  /**
   * Synchronise vertical scrolling between two elements.
   * @param {string} id1
   * @param {string} id2
   * @private
   */
  function _syncScroll(id1, id2) {
    const el1 = document.getElementById(id1);
    const el2 = document.getElementById(id2);
    if (!el1 || !el2) return;

    let syncing = false;

    el1.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      el2.scrollTop = el1.scrollTop;
      el2.scrollLeft = el1.scrollLeft;
      syncing = false;
    });

    el2.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      el1.scrollTop = el2.scrollTop;
      el1.scrollLeft = el2.scrollLeft;
      syncing = false;
    });
  }

  // ============================================================
  // File Tree
  // ============================================================

  /**
   * Render a hierarchical file tree.
   * @param {string} containerId - DOM element ID (or pass file array directly for backward compat)
   * @param {Array<{name: string, path: string, type: string, content: string}>} [files]
   */
  function renderFileTree(containerId, files) {
    // Backward compatibility: app.js calls UI.renderFileTree(files) without containerId
    let _files_arr = files;
    let _container;

    if (Array.isArray(containerId)) {
      _files_arr = containerId;
      _container = document.getElementById('file-tree');
    } else {
      _container = document.getElementById(containerId);
    }

    if (!_container) return;
    if (!_files_arr || _files_arr.length === 0) {
      _container.innerHTML =
        '<div class="empty-state"><span class="empty-icon">📂</span><p>Tidak ada file.</p></div>';
      return;
    }

    try {
      // Build tree structure from paths
      const tree = {};
      _files_arr.forEach(file => {
        const parts = (file.path || file.name).split('/');
        let current = tree;
        parts.forEach((part, idx) => {
          if (!current[part]) {
            current[part] = idx === parts.length - 1
              ? { __file: file }
              : {};
          }
          current = current[part];
        });
      });

      _container.innerHTML = '';
      const isUploadTree = _container.id === 'upload-file-tree';
      const treeHtml = _buildTreeHtml(tree, 0, isUploadTree);
      _container.innerHTML = treeHtml;

      // Attach click handlers for folders and files
      _container.querySelectorAll('.tree-folder-header').forEach(header => {
        header.addEventListener('click', () => {
          const folderNode = header.parentElement;
          if (folderNode) folderNode.classList.toggle('collapsed');
        });
      });

      const previewId = isUploadTree ? 'upload-file-preview' : 'test-file-preview';

      _container.querySelectorAll('.tree-file').forEach(fileNode => {
        fileNode.addEventListener('click', (e) => {
          if (e.target.classList.contains('tree-file-remove')) return;

          const filePath = fileNode.getAttribute('data-path');
          const file = _files_arr.find(f => (f.path || f.name) === filePath);
          if (file) {
            _showFilePreview(file, previewId);
          }
        });
      });

      if (isUploadTree) {
        _container.querySelectorAll('.tree-file-remove').forEach(removeBtn => {
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const filePath = removeBtn.getAttribute('data-path');
            const fileIdx = _files.findIndex(f => (f.path || f.name) === filePath);
            if (fileIdx !== -1) {
              _files.splice(fileIdx, 1);
              renderFileList();
              _updateFileCount();
              if (_onFilesChanged) _onFilesChanged(_files);
            }
          });
        });
      }
    } catch (err) {
      console.error('[UI] renderFileTree error:', err);
    }
  }

  /**
   * Recursively build HTML for the file tree.
   * @param {Object} node
   * @param {number} depth
   * @param {boolean} isUploadTree
   * @returns {string}
   * @private
   */
  function _buildTreeHtml(node, depth, isUploadTree) {
    let html = '';
    const indent = depth * 16;

    const entries = Object.entries(node).sort(([a, aVal], [b, bVal]) => {
      const aIsFile = aVal && aVal.__file;
      const bIsFile = bVal && bVal.__file;
      // Folders first, then files
      if (aIsFile && !bIsFile) return 1;
      if (!aIsFile && bIsFile) return -1;
      return a.localeCompare(b);
    });

    entries.forEach(([key, value]) => {
      if (key === '__file') return;

      if (value && value.__file) {
        // It's a file
        const file = value.__file;
        const ext = '.' + (file.type || '');
        const icon = FILE_ICONS[ext] || '📄';
        
        let removeHtml = '';
        if (isUploadTree) {
          removeHtml = `<button class="tree-file-remove" data-path="${_escapeHtml(file.path || file.name)}" title="Hapus file" style="background: none; border: none; color: var(--color-danger); cursor: pointer; padding: 0 4px; font-weight: bold; margin-left: 8px; font-size: 1.1rem; line-height: 1;">&times;</button>`;
        }

        html += `<div class="tree-file" data-path="${_escapeHtml(file.path || file.name)}" style="padding-left: ${indent + 16}px; display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box;">
          <span style="display: flex; align-items: center; gap: var(--space-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <span class="tree-icon">${icon}</span>
            <span class="tree-name">${_escapeHtml(file.name)}</span>
          </span>
          ${removeHtml}
        </div>`;
      } else {
        // It's a folder
        html += `<div class="tree-folder" style="padding-left: ${indent}px">
          <div class="tree-folder-header">
            <span class="tree-icon">📁</span>
            <span class="tree-name">${_escapeHtml(key)}</span>
          </div>
          <div class="tree-folder-children">
            ${_buildTreeHtml(value, depth + 1, isUploadTree)}
          </div>
        </div>`;
      }
    });

    return html;
  }

  /**
   * Show a file's content in the preview area.
   * @param {Object} file
   * @param {string} [previewId]
   * @private
   */
  function _showFilePreview(file, previewId) {
    const targetPreviewId = previewId || 'test-file-preview';
    const preview = document.getElementById(targetPreviewId);
    if (!preview) return;

    const langMap = { py: 'python', xml: 'xml', csv: 'plaintext', txt: 'plaintext' };
    const language = langMap[file.type] || 'plaintext';

    renderCodeViewer(targetPreviewId, file.content, language, []);
  }

  // ============================================================
  // Report
  // ============================================================

  /**
   * Render the full analysis report.
   * @param {Object} analysisResult
   */
  function renderReport(analysisResult) {
    try {
      const container = document.getElementById('report-preview');
      if (!container) return;

      if (window.OdooAnalyzer && window.OdooAnalyzer.Visualizers &&
          typeof window.OdooAnalyzer.Visualizers.generateFullReport === 'function') {
        const reportHtml = window.OdooAnalyzer.Visualizers.generateFullReport(analysisResult);
        container.innerHTML = reportHtml;
      } else {
        container.innerHTML =
          '<div class="empty-state"><span class="empty-icon">📊</span><p>Modul Visualizers belum dimuat.</p></div>';
      }
    } catch (err) {
      console.error('[UI] renderReport error:', err);
    }
  }

  // ============================================================
  // Toast Notifications
  // ============================================================

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success' | 'error' | 'info' | 'warning'} [type='info']
   */
  function showToast(message, type) {
    type = type || 'info';

    try {
      let toastContainer = document.getElementById('toast-container');
      if (!toastContainer) {
        // Create container if it doesn't exist
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
      }

      const iconMap = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️',
      };

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `
        <span class="toast-icon">${iconMap[type] || 'ℹ️'}</span>
        <span class="toast-message">${_escapeHtml(message)}</span>
        <button class="toast-close" title="Tutup">&times;</button>
      `;

      // Close button handler
      const closeBtn = toast.querySelector('.toast-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          _removeToast(toast);
        });
      }

      toastContainer.appendChild(toast);

      // Trigger entrance animation
      requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
      });

      // Auto-remove after 5 seconds
      setTimeout(() => {
        _removeToast(toast);
      }, 5000);
    } catch (err) {
      // Fallback: use console if toast creation fails
      console.warn('[UI] showToast fallback:', message, type);
    }
  }

  /**
   * Remove a toast element with fadeout animation.
   * @param {HTMLElement} toast
   * @private
   */
  function _removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.classList.remove('toast-visible');
    toast.classList.add('toast-fadeout');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400); // Match CSS transition duration
  }

  // ============================================================
  // Loading Overlay
  // ============================================================

  /**
   * Show the loading overlay with a message.
   * @param {string} [message='Memproses...']
   */
  function showLoading(message) {
    message = message || 'Memproses...';

    try {
      let overlay = document.getElementById('loading-overlay');

      if (!overlay) {
        // Create overlay if it doesn't exist
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = `
          <div class="loading-content">
            <div class="loading-spinner"></div>
            <p id="loading-text">${_escapeHtml(message)}</p>
          </div>
        `;
        document.body.appendChild(overlay);
      } else {
        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
          loadingText.textContent = message;
        }
      }

      overlay.classList.add('active');
      overlay.style.display = 'flex';
    } catch (err) {
      console.warn('[UI] showLoading error:', err);
    }
  }

  /**
   * Hide the loading overlay.
   */
  function hideLoading() {
    try {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
      }
    } catch (err) {
      console.warn('[UI] hideLoading error:', err);
    }
  }

  // ============================================================
  // Export Functions
  // ============================================================

  /**
   * Export report HTML to PDF using html2pdf.
   * @param {string} reportHtml
   */
  function exportToPdf(reportHtml) {
    try {
      if (typeof html2pdf === 'undefined') {
        showToast('Library html2pdf tidak tersedia.', 'error');
        return;
      }

      showLoading('Mengekspor ke PDF...');

      // Create a temporary container for the report
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = reportHtml;
      tempDiv.style.padding = '20px';
      tempDiv.style.fontFamily = 'Inter, sans-serif';
      tempDiv.style.color = '#333';
      tempDiv.style.background = '#fff';
      document.body.appendChild(tempDiv);

      const options = {
        margin: 10,
        filename: 'Odoo_Analysis_Report.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait',
        },
      };

      html2pdf()
        .set(options)
        .from(tempDiv)
        .save()
        .then(() => {
          document.body.removeChild(tempDiv);
          hideLoading();
          showToast('Laporan PDF berhasil diunduh!', 'success');
        })
        .catch(err => {
          document.body.removeChild(tempDiv);
          hideLoading();
          console.error('[UI] exportToPdf error:', err);
          showToast('Gagal mengekspor PDF: ' + err.message, 'error');
        });
    } catch (err) {
      hideLoading();
      console.error('[UI] exportToPdf error:', err);
      showToast('Gagal mengekspor PDF: ' + err.message, 'error');
    }
  }

  /**
   * Export report HTML to a Word document (.doc).
   * @param {string} reportHtml
   */
  function exportToWord(reportHtml) {
    try {
      const wordContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <title>Odoo Analysis Report</title>
          <style>
            body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; color: #333; line-height: 1.6; }
            h1 { color: #7c5cfc; font-size: 20pt; border-bottom: 2px solid #7c5cfc; padding-bottom: 5pt; }
            h2 { color: #5a3fd9; font-size: 16pt; margin-top: 15pt; }
            h3 { color: #444; font-size: 13pt; }
            table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
            th, td { border: 1px solid #ddd; padding: 6pt 10pt; text-align: left; }
            th { background-color: #f5f5ff; color: #333; font-weight: bold; }
            .badge { display: inline-block; padding: 2pt 8pt; border-radius: 3pt; font-size: 9pt; font-weight: bold; }
            .badge-critical { background: #ffe0e0; color: #c0392b; }
            .badge-warning { background: #fff3cd; color: #856404; }
            .badge-info { background: #d1ecf1; color: #0c5460; }
            code { font-family: 'Courier New', monospace; background: #f4f4f4; padding: 1pt 4pt; }
            pre { background: #f4f4f4; padding: 10pt; border: 1px solid #ddd; overflow-x: auto; font-size: 9pt; }
          </style>
        </head>
        <body>
          ${reportHtml}
        </body>
        </html>
      `;

      const blob = new Blob(['\ufeff', wordContent], {
        type: 'application/msword',
      });

      _downloadBlob(blob, 'Odoo_Analysis_Report.doc');
      showToast('Laporan Word berhasil diunduh!', 'success');
    } catch (err) {
      console.error('[UI] exportToWord error:', err);
      showToast('Gagal mengekspor Word: ' + err.message, 'error');
    }
  }

  /**
   * Export analysis data as a pretty-printed JSON file.
   * @param {Object} data
   */
  function exportToJson(data) {
    try {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });

      _downloadBlob(blob, 'Odoo_Analysis_Data.json');
      showToast('Data JSON berhasil diunduh!', 'success');
    } catch (err) {
      console.error('[UI] exportToJson error:', err);
      showToast('Gagal mengekspor JSON: ' + err.message, 'error');
    }
  }

  /**
   * Export issues list to a CSV file.
   * @param {Array<Object>} issues
   */
  function exportToCsv(issues) {
    if (!Array.isArray(issues) || issues.length === 0) {
      showToast('Tidak ada masalah untuk diekspor.', 'warning');
      return;
    }

    try {
      const lang = localStorage.getItem('lang') || 'id';
      
      // CSV Headers
      const headers = lang === 'en' 
        ? ['Issue ID', 'Severity', 'Category', 'Title', 'Description', 'File', 'Line', 'Suggestion']
        : ['ID Masalah', 'Tingkat Keparahan', 'Kategori', 'Judul', 'Deskripsi', 'File', 'Baris', 'Saran'];

      const csvRows = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')];

      issues.forEach(issue => {
        const ruleId = issue.ruleId || issue.id?.split('_')[0];
        let title = issue.title;
        let description = issue.description;
        let suggestion = issue.suggestion || issue.recommendation;

        if (lang === 'en' && window.OdooAnalyzer.RULE_TRANSLATIONS?.[ruleId]) {
          const t = window.OdooAnalyzer.RULE_TRANSLATIONS[ruleId];
          title = t.title;
          description = t.description;
          suggestion = t.suggestion;
        }

        const row = [
          issue.ruleId || issue.id || '',
          issue.severity || '',
          issue.category || '',
          title || '',
          description || '',
          issue.file || '',
          issue.line || '',
          suggestion || ''
        ];

        csvRows.push(row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
      });

      const csvContent = '\uFEFF' + csvRows.join('\n'); // Add UTF-8 BOM
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      _downloadBlob(blob, 'Odoo_Analysis_Issues.csv');
      showToast(lang === 'en' ? 'CSV file downloaded successfully!' : 'File CSV berhasil diunduh!', 'success');
    } catch (err) {
      console.error('[UI] exportToCsv error:', err);
      showToast('Gagal mengekspor CSV: ' + err.message, 'error');
    }
  }

  // ============================================================
  // Utility Helpers
  // ============================================================

  /**
   * Read a File as text.
   * @param {File} file
   * @returns {Promise<string>}
   * @private
   */
  function _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file: ' + file.name));
      reader.readAsText(file);
    });
  }

  /**
   * Read a File as ArrayBuffer.
   * @param {File} file
   * @returns {Promise<ArrayBuffer>}
   * @private
   */
  function _readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file: ' + file.name));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Get file extension (lowercase, including dot).
   * @param {string} filename
   * @returns {string}
   * @private
   */
  function _getExtension(filename) {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.substring(dot).toLowerCase() : '';
  }

  /**
   * Format byte count into human-readable string.
   * @param {number} bytes
   * @returns {string}
   * @private
   */
  function _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Escape HTML entities to prevent XSS.
   * @param {string} str
   * @returns {string}
   * @private
   */
  function _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Capitalize the first letter of a string.
   * @param {string} str
   * @returns {string}
   * @private
   */
  function _capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Get a CSS class name for a severity level.
   * @param {string} severity
   * @returns {string}
   * @private
   */
  function _getSeverityClass(severity) {
    const map = {
      critical: 'critical',
      error: 'critical',
      warning: 'warning',
      info: 'info',
    };
    return map[(severity || '').toLowerCase()] || 'info';
  }

  /**
   * Trigger a file download from a Blob.
   * @param {Blob} blob
   * @param {string} filename
   * @private
   */
  /**
   * Render active user details in the header widget.
   * @param {Object|null} user
   */
  function renderUserWidget(user) {
    const widget = document.getElementById('user-profile-widget');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');
    const avatarEl = document.getElementById('user-avatar');

    if (widget) {
      if (user) {
        widget.style.display = 'flex';
        if (nameEl) nameEl.textContent = user.name || '';
        if (roleEl) {
          const lang = localStorage.getItem('lang') || 'id';
          const rolesMap = {
            Admin: lang === 'en' ? 'Admin' : 'Admin',
            Reviewer: lang === 'en' ? 'Reviewer' : 'Peninjau',
            Developer: lang === 'en' ? 'Developer' : 'Pengembang',
            Viewer: lang === 'en' ? 'Viewer' : 'Pelihat'
          };
          roleEl.textContent = rolesMap[user.role] || user.role || '';
        }
        if (avatarEl) {
          avatarEl.src = user.avatar || 'https://open.larksuite.com/static-resource/v1/37bb~no_avatar.png';
        }
      } else {
        widget.style.display = 'none';
      }
    }
  }

  /**
   * Render users and audit logs inside the Admin Console.
   * @param {Array} users
   * @param {Array} logs
   */
  function renderAdminConsole(users, logs) {
    const userListContainer = document.getElementById('admin-user-list');
    const logsContainer = document.getElementById('admin-audit-logs');

    if (userListContainer) {
      userListContainer.innerHTML = '';
      if (Array.isArray(users) && users.length > 0) {
        users.forEach(u => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          
          // Generate select options for roles
          const roles = ['Admin', 'Reviewer', 'Developer', 'Viewer'];
          const selectOptions = roles.map(r => 
            `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`
          ).join('');

          tr.innerHTML = `
            <td style="padding: 10px 8px; display: flex; align-items: center; gap: 8px;">
              <img src="${u.avatar || 'https://open.larksuite.com/static-resource/v1/37bb~no_avatar.png'}" style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1);">
              <span>${_escapeHtml(u.name)}</span>
            </td>
            <td style="padding: 10px 8px; color: #8888a8;">${_escapeHtml(u.email || '-')}</td>
            <td style="padding: 10px 8px;">
              <span class="badge badge-${_getSeverityClass(u.role === 'Admin' ? 'critical' : (u.role === 'Reviewer' ? 'warning' : 'info'))}" style="font-size: 0.7rem;">
                ${u.role}
              </span>
            </td>
            <td style="padding: 10px 8px; text-align: right;">
              <select class="admin-role-select" data-user-id="${u.id}" style="background: #12122a; color: #e8e8f0; border: 1px solid rgba(255,255,255,0.15); padding: 4px; border-radius: 4px; font-size: 0.8rem;">
                ${selectOptions}
              </select>
            </td>
          `;

          // Attach onchange handler directly
          const select = tr.querySelector('.admin-role-select');
          if (select) {
            select.addEventListener('change', (e) => {
              const userId = e.target.getAttribute('data-user-id');
              const newRole = e.target.value;
              if (window.OdooAnalyzer.App && typeof window.OdooAnalyzer.App.updateUserRole === 'function') {
                window.OdooAnalyzer.App.updateUserRole(userId, newRole);
              }
            });
          }

          userListContainer.appendChild(tr);
        });
      } else {
        userListContainer.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #8888a8;">Tidak ada pengguna.</td></tr>';
      }
    }

    if (logsContainer) {
      logsContainer.innerHTML = '';
      if (Array.isArray(logs) && logs.length > 0) {
        logs.forEach(log => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          const timeStr = new Date(log.timestamp).toLocaleString('id-ID');
          tr.innerHTML = `
            <td style="padding: 8px; color: #8888a8; font-size: 0.75rem;">${timeStr}</td>
            <td style="padding: 8px; font-weight: 500;">${_escapeHtml(log.user_name || 'System')}</td>
            <td style="padding: 8px;"><span style="color: #00d4aa;">${_escapeHtml(log.action)}</span></td>
            <td style="padding: 8px; color: #b8b8d0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${_escapeHtml(log.details)}">${_escapeHtml(log.details)}</td>
          `;
          logsContainer.appendChild(tr);
        });
      } else {
        logsContainer.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #8888a8;">Tidak ada catatan audit.</td></tr>';
      }
    }
  }

  /**
   * Render discussion comments inside the drawer.
   * @param {Array} comments
   */
  function renderComments(comments) {
    const listContainer = document.getElementById('drawer-comments-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (Array.isArray(comments) && comments.length > 0) {
      comments.forEach(comment => {
        const commentDiv = document.createElement('div');
        commentDiv.style.background = 'rgba(255, 255, 255, 0.03)';
        commentDiv.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        commentDiv.style.padding = '10px';
        commentDiv.style.borderRadius = '8px';
        commentDiv.style.fontSize = '0.85rem';
        commentDiv.style.display = 'flex';
        commentDiv.style.flexDirection = 'column';
        commentDiv.style.gap = '4px';

        const timeStr = new Date(comment.timestamp).toLocaleString('id-ID');

        commentDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
            <img src="${comment.user_avatar || 'https://open.larksuite.com/static-resource/v1/37bb~no_avatar.png'}" style="width: 20px; height: 20px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1);">
            <span style="font-weight: 600; color: #e8e8f0; font-size: 0.8rem;">${_escapeHtml(comment.user_name)}</span>
            <span style="font-size: 0.7rem; color: #8888a8; margin-left: auto;">${timeStr}</span>
          </div>
          <p style="margin: 0; color: #b8b8d0; line-height: 1.4; white-space: pre-wrap; word-break: break-word;">${_escapeHtml(comment.comment_text)}</p>
        `;
        listContainer.appendChild(commentDiv);
      });
    } else {
      const lang = localStorage.getItem('lang') || 'id';
      const noCommentsText = lang === 'en'
        ? 'No discussion comments on this issue yet. Start the conversation below!'
        : 'Belum ada diskusi untuk masalah ini. Mulai diskusi di bawah!';
      listContainer.innerHTML = `
        <div style="color: #8888a8; font-size: 0.8rem; text-align: center; padding: 20px 10px;">
          ${noCommentsText}
        </div>
      `;
    }
  }

  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ============================================================
  // Auto-initialisation on DOMContentLoaded
  // ============================================================

  function _autoInit() {
    initNavigation();
    initFileUploader();
    initErrorFilters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    // DOM already ready
    _autoInit();
  }



  // ============================================================
  // Public API
  // ============================================================

  return {
    // Navigation
    initNavigation: initNavigation,
    navigateTo: navigateTo,

    // File Uploader
    initFileUploader: initFileUploader,
    getFiles: getFiles,
    clearFiles: clearFiles,
    renderFileList: renderFileList,

    // Dashboard
    renderDashboard: renderDashboard,
    renderHealthGauge: renderHealthGauge,
    renderIssuesSummary: renderIssuesSummary,
    renderUserWidget: renderUserWidget,
    renderAdminConsole: renderAdminConsole,
    renderComments: renderComments,

    // Error List
    renderErrorList: renderErrorList,
    initErrorFilters: initErrorFilters,

    // Code Viewer & Diff
    renderCodeViewer: renderCodeViewer,
    renderDiffView: renderDiffView,

    // File Tree
    renderFileTree: renderFileTree,

    // Report
    renderReport: renderReport,

    // Notifications & Loading
    showToast: showToast,
    showLoading: showLoading,
    hideLoading: hideLoading,

    // Export
    exportToPdf: exportToPdf,
    exportToWord: exportToWord,
    exportToJson: exportToJson,
    exportToCsv: exportToCsv,
  };
})();
