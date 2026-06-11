/**
 * Odoo Code Analyzer - Main Application Controller
 * ================================================
 * Coordinates all modules: Parsers, Analyzers, UI, Visualizers, CodeFixer, TestData
 * Manages navigation, application state, and event handling.
 * 
 * Dependencies (loaded before this file):
 *   - window.OdooAnalyzer.Parsers
 *   - window.OdooAnalyzer.Analyzers
 *   - window.OdooAnalyzer.CodeFixer
 *   - window.OdooAnalyzer.UI
 *   - window.OdooAnalyzer.Visualizers
 *   - window.OdooAnalyzer.TestData
 */

(function () {
  'use strict';

  // ============================================================
  // Bilingual Translations
  // ============================================================
  const TRANSLATIONS = {
    // English
    en: {
      nav_upload: "Upload & Analyze",
      nav_dashboard: "Dashboard",
      nav_flows: "Business Flow",
      nav_errors: "Issues & Errors",
      nav_fixer: "Code Fixer",
      nav_testbed: "Test Bed",
      nav_report: "Report",
      sec_upload_title: "📁 Upload & Analyze Code",
      sec_upload_desc: "Upload Python (.py), XML (.xml), CSV (.csv), or ZIP (.zip) archives to begin your Odoo code analysis.",
      drop_zone_text: "Drag & Drop Files Here",
      drop_zone_subtext: "or click to select files",
      file_count_selected: "0 files selected",
      btn_clear_files: "Clear All",
      btn_analyze: "Start Analysis",
      sec_dashboard_title: "📊 Analysis Dashboard",
      stat_modules: "Total Modules",
      stat_models: "Total Models",
      stat_fields: "Total Fields",
      stat_methods: "Total Methods",
      stat_views: "Total Views",
      sec_testbed_title: "🧪 Test Bed - Example Module",
      testbed_desc: "This test module contains a complete sample of Odoo code covering common scenarios, including models, views, security, and data. Use this feature to test the analyzer without needing to upload your own files.",
      btn_load_test: "Load Test Data",
      btn_run_tests: "Run Unit Test",
      testbed_empty_preview: "Click on a file in the tree above to view its contents.",
      loading_processing_files: "Processing files...",
      jszip_not_available: "JSZip not available. ZIP extraction failed.",
      exporting_pdf: "Exporting to PDF...",
      pdf_exported_success: "PDF Report downloaded successfully!",
      word_exported_success: "Word Report downloaded successfully!",
      json_exported_success: "JSON Data downloaded successfully!"
    },
    // Indonesian
    id: {
      nav_upload: "Upload & Analisis",
      nav_dashboard: "Dashboard",
      nav_flows: "Business Flow",
      nav_errors: "Masalah & Error",
      nav_fixer: "Perbaikan Kode",
      nav_testbed: "Test Bed",
      nav_report: "Laporan",
      sec_upload_title: "📁 Upload & Analisis Kode",
      sec_upload_desc: "Upload file Python (.py), XML (.xml), CSV (.csv), atau arsip ZIP (.zip) untuk memulai analisis kode Odoo Anda.",
      drop_zone_text: "Seret & Lepas File di Sini",
      drop_zone_subtext: "atau klik untuk memilih file",
      file_count_selected: "0 file dipilih",
      btn_clear_files: "Hapus Semua",
      btn_analyze: "Mulai Analisis",
      sec_dashboard_title: "📊 Dashboard Analisis",
      stat_modules: "Total Modul",
      stat_models: "Total Model",
      stat_fields: "Total Field",
      stat_methods: "Total Method",
      stat_views: "Total View",
      sec_testbed_title: "🧪 Test Bed - Modul Contoh",
      testbed_desc: "Modul test ini berisi contoh kode Odoo lengkap yang mencakup berbagai skenario umum, termasuk model, view, security, dan data. Gunakan fitur ini untuk menguji kemampuan analyzer tanpa perlu mengupload file Anda sendiri.",
      btn_load_test: "Muat Data Test",
      btn_run_tests: "Jalankan Unit Test",
      testbed_empty_preview: "Klik file pada tree di atas untuk melihat isinya.",
      loading_processing_files: "Memproses file...",
      jszip_not_available: "JSZip tidak tersedia. ZIP tidak dapat diekstrak.",
      exporting_pdf: "Mengekspor ke PDF...",
      pdf_exported_success: "Laporan PDF berhasil diunduh!",
      word_exported_success: "Laporan Word berhasil diunduh!",
      json_exported_success: "Data JSON berhasil diunduh!"
    }
  };

  const RULE_TRANSLATIONS = {
    DEP001: {
      title: "Deprecated @api.multi",
      description: "Decorator @api.multi was removed in Odoo 13. Since v13, all methods receive a recordset by default.",
      suggestion: "Remove the @api.multi decorator from this method."
    },
    DEP002: {
      title: "Deprecated @api.one",
      description: "Decorator @api.one was removed in Odoo 13. Loop through self instead.",
      suggestion: "Replace @api.one with a loop over self in the method body."
    },
    DEP003: {
      title: "Deprecated @api.returns",
      description: "Decorator @api.returns is deprecated. Use proper type annotations or return values.",
      suggestion: "Remove @api.returns decorator and return proper recordset objects."
    },
    DEP004: {
      title: "Deprecated osv.osv class",
      description: "Using osv.osv or osv.osv_memory (deprecated since Odoo 8.0). Use models.Model or models.TransientModel.",
      suggestion: "Change inheritance from osv.osv to models.Model."
    },
    DEP005: {
      title: "Deprecated _columns dictionary",
      description: "Using old-style _columns dictionary to define fields. Use class-level field assignments instead.",
      suggestion: "Reformat _columns fields to standard field definitions: name = fields.Char()."
    },
    DEP006: {
      title: "Deprecated _defaults dictionary",
      description: "Using old-style _defaults dictionary. Define defaults directly on the fields using default= parameter.",
      suggestion: "Move defaults from _defaults into individual field parameter definitions."
    },
    DEP007: {
      title: "Old-style Field Type Declarations",
      description: "Using old-style fields.char (lowercase) instead of fields.Char (uppercase).",
      suggestion: "Capitalize the field constructor to fields.Char, fields.Integer, etc."
    },
    SEC001: {
      title: "SQL Injection Vulnerability",
      description: "Using string formatting inside cr.execute() is highly vulnerable to SQL Injection.",
      suggestion: "Use parameterized queries, passing parameters as a tuple/list to execute()."
    },
    SEC002: {
      title: "sudo() Usage Without Justification",
      description: "Using sudo() bypasses access rights and security checks. It should be used sparingly.",
      suggestion: "Ensure there is a valid reason to bypass security. Document the usage or use standard env."
    },
    SEC003: {
      title: "Missing ir.model.access.csv entry",
      description: "Custom models must have their access rights defined in security/ir.model.access.csv.",
      suggestion: "Add a row in ir.model.access.csv for this model to avoid permission errors."
    },
    SEC004: {
      title: "No Record Rules Defined",
      description: "No multi-tenant row-level security (ir.rule) defined for this custom model.",
      suggestion: "Define an ir.rule record in security.xml if multi-tenancy or row-level restriction is needed."
    },
    PERF001: {
      title: "Search/Browse in Loop (N+1 Problem)",
      description: "Calling search() or browse() inside a loop causes a separate database query for each iteration.",
      suggestion: "Fetch records in batch before the loop, or use search domains with mapped() operations."
    },
    PERF002: {
      title: "Computed Field Without store=True",
      description: "Computed fields without store=True are recomputed on every read, slowing down tree and search views.",
      suggestion: "Add store=True parameter to the computed field definition if it is frequently accessed."
    },
    PERF003: {
      title: "Search Without Limit",
      description: "Calling search() without limit can retrieve a massive dataset, leading to high memory usage.",
      suggestion: "Add limit=80 or a reasonable maximum to the search query if retrieving all records is not necessary."
    },
    PERF004: {
      title: "Read/Write in Loop",
      description: "Reading or writing fields inside a loop causes multiple database updates/queries.",
      suggestion: "Perform operations in batch or use self.write() on a multi-record set outside the loop."
    },
    BAD001: {
      title: "Hardcoded Record ID",
      description: "Using hardcoded IDs (e.g., browse(1)) is a bad practice as IDs differ between environments.",
      suggestion: "Use self.env.ref('xml_id') to reference static XML records, or search by a unique field."
    },
    BAD002: {
      title: "Bare except Block",
      description: "A bare except: block catches all exceptions, including KeyboardInterrupt and SystemExit, hiding bugs.",
      suggestion: "Use except Exception: to catch generic errors, and log the exception with _logger.exception()."
    },
    BAD003: {
      title: "Missing super() in CRUD Override",
      description: "Overriding create, write, or unlink without calling super() breaks standard Odoo behaviour.",
      suggestion: "Ensure super() is called and returns the expected result."
    },
    BAD004: {
      title: "Missing Method Docstring",
      description: "Method lacks a docstring, making it harder for developers to understand its business flow.",
      suggestion: "Add a short descriptive docstring outlining the purpose and parameters of the method."
    },
    BAD005: {
      title: "Dangerous self.env.cr.commit()",
      description: "Calling cr.commit() manually bypasses Odoo transaction management and can corrupt data.",
      suggestion: "Avoid manual commits. Let Odoo's framework commit the transaction at the end of execution."
    },
    MIS001: {
      title: "Missing __manifest__.py",
      description: "No module manifest file found in the workspace root.",
      suggestion: "Create a __manifest__.py file to describe the module and declare dependencies."
    },
    MIS002: {
      title: "Missing Model _description",
      description: "Model is missing the _description attribute which is required since Odoo 12.",
      suggestion: "Add a descriptive string to _description = 'My Model Description'."
    },
    MIS003: {
      title: "Missing license in manifest",
      description: "Manifest file does not declare a license key, which is mandatory in Odoo 14+.",
      suggestion: "Inject 'license': 'LGPL-3', or another suitable license key into __manifest__.py."
    },
    INH001: {
      title: "Inheritance Confusion",
      description: "Combining _inherit and _name in a confusing manner. Make sure you intend delegation inheritance.",
      suggestion: "Verify if delegation inheritance (_inherits) or extension inheritance is intended."
    },
    DAT001: {
      title: "Many2one Field without ondelete",
      description: "Many2one relational fields should define the ondelete behavior to prevent database constraints errors.",
      suggestion: "Add ondelete='set null' or ondelete='cascade' parameter."
    },
    DAT002: {
      title: "Selection Field without Default",
      description: "Selection fields without a default value can result in NULL values, which cause rendering errors.",
      suggestion: "Define default='draft' or a suitable starting state on the field."
    },
    DAT003: {
      title: "Required Field without Default",
      description: "Required fields without default values will cause validation errors when records are created programmatically.",
      suggestion: "Add default=... parameter to ensure record creation succeeds."
    }
  };

  // Expose translations globally
  window.OdooAnalyzer.translate = function (key) {
    const lang = localStorage.getItem('lang') || 'id';
    return TRANSLATIONS[lang]?.[key] || key;
  };
  window.OdooAnalyzer.RULE_TRANSLATIONS = RULE_TRANSLATIONS;

  // ============================================================
  // Application State
  // ============================================================
  const AppState = {
    currentSection: 'upload',
    uploadedFiles: [],      // FileEntry[]
    parsedModules: [],       // OdooModule[]
    analysisResult: null,    // AnalysisResult
    fixResults: [],          // [{file, originalContent, fixedContent, fixes[]}]
    isAnalyzing: false,
    filters: {
      severity: 'all',
      category: 'all',
      file: 'all',
      search: ''
    },
    selectedFlowTab: 'erd',
    selectedFlowModel: 'all',
    selectedFixerFile: null,
    user: null,              // User profile from Lark
    token: null              // JWT Token
  };

  // ============================================================
  // Module references (shorthand)
  // ============================================================
  const OA = window.OdooAnalyzer || {};
  const Parsers = OA.Parsers;
  const Analyzers = OA.Analyzers;
  const CodeFixer = OA.CodeFixer;
  const UI = OA.UI;
  const Visualizers = OA.Visualizers;
  const TestData = OA.TestData;

  // ============================================================
  // Navigation
  // ============================================================
  function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionId = item.getAttribute('data-section');
        navigateTo(sectionId);
      });
    });

    // Mobile hamburger
    const hamburger = document.getElementById('hamburger-toggle');
    const sidebar = document.getElementById('sidebar');
    if (hamburger && sidebar) {
      hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Close sidebar on mobile when clicking content
    const mainContent = document.getElementById('main-content');
    if (mainContent && sidebar) {
      mainContent.addEventListener('click', () => {
        if (window.innerWidth < 768) {
          sidebar.classList.remove('open');
        }
      });
    }
  }

  function navigateTo(sectionId) {
    if (!sectionId) return;

    // Normalize to short name (e.g. 'section-dashboard' -> 'dashboard')
    if (sectionId.startsWith('section-')) {
      sectionId = sectionId.replace('section-', '');
    }

    // Validate section exists
    const validSections = ['upload', 'dashboard', 'flows', 'errors', 'fixer', 'testbed', 'report', 'admin'];
    if (!validSections.includes(sectionId)) return;

    // Check if analysis is required for certain sections
    const requiresAnalysis = ['dashboard', 'flows', 'errors', 'fixer', 'report'];
    if (requiresAnalysis.includes(sectionId) && !AppState.analysisResult) {
      UI.showToast('Silakan upload dan analisis file terlebih dahulu.', 'warning');
      return;
    }

    AppState.currentSection = sectionId;

    // Delegate DOM visibility changes to UI module
    UI.navigateTo(sectionId);

    // Render section content
    renderSection(sectionId);

    // Scroll to top
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTop = 0;
  }

  // ============================================================
  // Section Rendering
  // ============================================================
  function renderSection(sectionId) {
    switch (sectionId) {
      case 'upload':
        // Upload section is static, handled by UI.initFileUploader
        break;
      case 'dashboard':
        renderDashboard();
        break;
      case 'flows':
        renderFlows();
        break;
      case 'errors':
        renderErrors();
        break;
      case 'fixer':
        renderFixer();
        break;
      case 'testbed':
        // Test bed is mostly static, handled by event listeners
        break;
      case 'report':
        renderReport();
        break;
      case 'admin':
        renderAdmin();
        break;
    }
  }

  function renderDashboard() {
    if (!AppState.analysisResult) return;
    const { stats, issues } = AppState.analysisResult;

    // Ensure stats has issues list for UI to compute summary counts
    stats.issues = issues;

    UI.renderDashboard(stats);
    UI.renderHealthGauge(stats.healthScore);
  }

  function renderFlows() {
    if (!AppState.analysisResult) return;
    const { modules, relationships, businessFlows } = AppState.analysisResult;

    const tab = AppState.selectedFlowTab;

    // Update tab active states
    document.querySelectorAll('.flow-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });

    const container = document.getElementById('diagram-container');
    if (!container) return;

    let mermaidCode = '';

    try {
      switch (tab) {
        case 'erd':
          mermaidCode = Visualizers.generateERDiagram(modules, relationships);
          break;
        case 'state':
          const selectedModel = AppState.selectedFlowModel;
          const flows = selectedModel === 'all'
            ? businessFlows
            : businessFlows.filter(f => f.model === selectedModel);
          if (flows.length > 0) {
            mermaidCode = Visualizers.generateStateDiagram(flows[0]);
          } else {
            container.innerHTML = '<div class="empty-state"><span class="empty-icon">🔄</span><p>Tidak ada state machine ditemukan untuk model ini.</p></div>';
            return;
          }
          break;
        case 'menu':
          const allMenus = modules.flatMap(m => m.menus || []);
          if (allMenus.length > 0) {
            mermaidCode = Visualizers.generateMenuTree(allMenus);
          } else {
            container.innerHTML = '<div class="empty-state"><span class="empty-icon">📋</span><p>Tidak ada menu ditemukan.</p></div>';
            return;
          }
          break;
      }

      if (mermaidCode) {
        Visualizers.renderDiagram('diagram-container', mermaidCode, tab);
      }
    } catch (err) {
      console.error('Diagram rendering error:', err);
      container.innerHTML = `<div class="empty-state error"><span class="empty-icon">⚠️</span><p>Gagal merender diagram: ${err.message}</p></div>`;
    }

    // Populate model selector for state diagrams
    populateFlowModelSelector();
  }

  function populateFlowModelSelector() {
    const selector = document.getElementById('flow-model-selector');
    if (!selector || !AppState.analysisResult) return;

    const { businessFlows } = AppState.analysisResult;
    selector.innerHTML = '<option value="all">Semua Model</option>';
    businessFlows.forEach(flow => {
      const opt = document.createElement('option');
      opt.value = flow.model;
      opt.textContent = `${flow.name} (${flow.model})`;
      if (flow.model === AppState.selectedFlowModel) opt.selected = true;
      selector.appendChild(opt);
    });
  }

  function renderErrors() {
    if (!AppState.analysisResult) return;
    const { issues } = AppState.analysisResult;

    // Apply filters
    let filtered = [...issues];

    if (AppState.filters.severity !== 'all') {
      filtered = filtered.filter(i => i.severity === AppState.filters.severity);
    }
    if (AppState.filters.category !== 'all') {
      filtered = filtered.filter(i => i.category === AppState.filters.category);
    }
    if (AppState.filters.file !== 'all') {
      filtered = filtered.filter(i => i.file === AppState.filters.file);
    }
    if (AppState.filters.search) {
      const q = AppState.filters.search.toLowerCase();
      filtered = filtered.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.ruleId.toLowerCase().includes(q)
      );
    }

    UI.renderErrorList(filtered, AppState.filters);
    populateErrorFilters();
  }

  function populateErrorFilters() {
    if (!AppState.analysisResult) return;
    const { issues } = AppState.analysisResult;

    // Populate file filter
    const fileFilter = document.getElementById('filter-file');
    if (fileFilter) {
      const currentVal = fileFilter.value;
      const files = [...new Set(issues.map(i => i.file).filter(Boolean))];
      fileFilter.innerHTML = '<option value="all">Semua File</option>';
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f.split('/').pop() || f;
        fileFilter.appendChild(opt);
      });
      fileFilter.value = currentVal || 'all';
    }

    // Populate category filter
    const catFilter = document.getElementById('filter-category');
    if (catFilter) {
      const currentVal = catFilter.value;
      const categories = [...new Set(issues.map(i => i.category))];
      catFilter.innerHTML = '<option value="all">Semua Kategori</option>';

      const categoryLabels = {
        deprecated: '⏳ Deprecated',
        security: '🔒 Keamanan',
        performance: '⚡ Performa',
        bad_practice: '⚠️ Bad Practice',
        missing: '❓ Komponen Hilang',
        inheritance: '🔗 Inheritance',
        data_integrity: '💾 Data Integrity'
      };

      categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = categoryLabels[c] || c;
        catFilter.appendChild(opt);
      });
      catFilter.value = currentVal || 'all';
    }
  }

  function renderFixer() {
    if (!AppState.analysisResult) return;

    // Generate fixes if not yet done
    if (AppState.fixResults.length === 0) {
      try {
        AppState.fixResults = CodeFixer.fixAllFiles(
          AppState.parsedModules,
          AppState.analysisResult
        );
      } catch (err) {
        console.error('Code fixer error:', err);
        UI.showToast('Gagal menghasilkan perbaikan kode: ' + err.message, 'error');
        return;
      }
    }

    // Populate file selector
    const fileSelector = document.getElementById('fixer-file-selector');
    if (fileSelector) {
      fileSelector.innerHTML = '';
      AppState.fixResults.forEach((result, idx) => {
        if (result.fixes && result.fixes.length > 0) {
          const opt = document.createElement('option');
          opt.value = idx;
          const fileName = result.file.split('/').pop() || result.file;
          opt.textContent = `${fileName} (${result.fixes.length} perbaikan)`;
          fileSelector.appendChild(opt);
        }
      });

      // Select first file if none selected
      if (AppState.selectedFixerFile === null && fileSelector.options.length > 0) {
        AppState.selectedFixerFile = parseInt(fileSelector.options[0].value);
      }
      fileSelector.value = AppState.selectedFixerFile;
    }

    renderFixerDiff();
  }

  function renderFixerDiff() {
    if (AppState.selectedFixerFile === null || !AppState.fixResults[AppState.selectedFixerFile]) return;

    const result = AppState.fixResults[AppState.selectedFixerFile];
    UI.renderDiffView(result.originalContent, result.fixedContent, result.fixes);

    // Update fix stats
    const fixStats = document.getElementById('fixer-stats');
    if (fixStats) {
      const totalFixes = result.fixes ? result.fixes.length : 0;
      fixStats.innerHTML = `<span class="badge badge-info">${totalFixes} perbaikan ditemukan</span>`;
    }
  }

  function renderReport() {
    if (!AppState.analysisResult) return;

    const reportContainer = document.getElementById('report-preview');
    if (reportContainer) {
      try {
        const reportHtml = Visualizers.generateFullReport(AppState.analysisResult);
        reportContainer.innerHTML = reportHtml;
      } catch (err) {
        console.error('Report generation error:', err);
        reportContainer.innerHTML = `<div class="empty-state error"><p>Gagal membuat laporan: ${err.message}</p></div>`;
      }
    }
  }

  // ============================================================
  // File Upload & Analysis Pipeline
  // ============================================================
  function handleFilesSelected(files) {
    AppState.uploadedFiles = files;
    const fileCount = document.getElementById('file-count');
    if (fileCount) {
      fileCount.textContent = `${files.length} file siap dianalisis`;
    }
    UI.renderFileTree(files);

    // Enable analyze button
    const analyzeBtn = document.getElementById('btn-analyze');
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.classList.add('pulse-glow');
    }
  }

  async function runAnalysis() {
    if (AppState.uploadedFiles.length === 0) {
      UI.showToast('Silakan upload file terlebih dahulu.', 'warning');
      return;
    }

    if (AppState.isAnalyzing) return;
    AppState.isAnalyzing = true;

    const analyzeBtn = document.getElementById('btn-analyze');
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.classList.remove('pulse-glow');
    }

    UI.showLoading('Menganalisis kode Odoo...');

    try {
      // Step 1: Parse files
      updateProgress(10, 'Parsing file Python...');
      await delay(100); // Allow UI to update
      const modules = Parsers.parseFiles(AppState.uploadedFiles);
      AppState.parsedModules = modules;

      // Step 2: Analyze
      updateProgress(40, 'Menganalisis model dan relasi...');
      await delay(100);
      const analysisResult = Analyzers.analyze(modules);

      // Step 3: Calculate stats
      updateProgress(70, 'Menghitung skor kesehatan...');
      await delay(100);
      AppState.analysisResult = analysisResult;

      // Step 4: Generate fixes
      updateProgress(85, 'Menghasilkan saran perbaikan...');
      await delay(100);
      try {
        AppState.fixResults = CodeFixer.fixAllFiles(modules, analysisResult);
      } catch (e) {
        console.warn('Code fixer partial error:', e);
        AppState.fixResults = [];
      }

      // Done
      updateProgress(100, 'Analisis selesai!');
      await delay(500);

      UI.hideLoading();
      UI.showToast(`Analisis selesai! Ditemukan ${analysisResult.stats.totalModels} model dan ${analysisResult.issues.length} masalah.`, 'success');

      // Enable navigation to analysis sections
      enableAnalysisSections();

      // Navigate to dashboard
      navigateTo('dashboard');

    } catch (err) {
      console.error('Analysis failed:', err);
      UI.hideLoading();
      UI.showToast('Analisis gagal: ' + err.message, 'error');
    } finally {
      AppState.isAnalyzing = false;
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  function updateProgress(percent, message) {
    const progressBar = document.getElementById('analysis-progress-bar');
    const progressText = document.getElementById('analysis-progress-text');
    const loadingText = document.getElementById('loading-text');

    if (progressBar) {
      progressBar.style.width = percent + '%';
    }
    if (progressText) {
      progressText.textContent = message;
    }
    if (loadingText) {
      loadingText.textContent = message;
    }
  }

  function enableAnalysisSections() {
    document.querySelectorAll('.nav-item[data-requires-analysis]').forEach(item => {
      item.classList.remove('disabled');
    });
  }

  // ============================================================
  // Event Listeners
  // ============================================================
  function initEventListeners() {
    // Header Export Dropdown Toggle
    const exportToggle = document.getElementById('btn-export-toggle');
    const exportMenu = document.getElementById('export-menu');
    if (exportToggle && exportMenu) {
      exportToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('active');
        const expanded = exportToggle.getAttribute('aria-expanded') === 'true';
        exportToggle.setAttribute('aria-expanded', !expanded);
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#export-dropdown')) {
          exportMenu.classList.remove('active');
          exportToggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Header Export Options
    const headerExportExcel = document.getElementById('export-excel');
    if (headerExportExcel) {
      headerExportExcel.addEventListener('click', () => {
        if (!AppState.analysisResult) {
          UI.showToast('Silakan upload dan analisis file terlebih dahulu.', 'warning');
          return;
        }
        try {
          UI.showLoading('Mengekspor ke Excel...');
          Visualizers.exportExcel(AppState.analysisResult);
          UI.hideLoading();
          UI.showToast('Laporan Excel berhasil diunduh!', 'success');
        } catch (err) {
          UI.hideLoading();
          UI.showToast('Gagal ekspor Excel: ' + err.message, 'error');
        }
        exportMenu.classList.remove('active');
      });
    }

    // Analyze button
    const analyzeBtn = document.getElementById('btn-analyze');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', runAnalysisWithRoleCheck);
    }

    // Flow tabs
    document.querySelectorAll('.flow-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        AppState.selectedFlowTab = tab.getAttribute('data-tab');
        renderFlows();
      });
    });

    // Flow model selector
    const flowModelSelector = document.getElementById('flow-model-selector');
    if (flowModelSelector) {
      flowModelSelector.addEventListener('change', (e) => {
        AppState.selectedFlowModel = e.target.value;
        renderFlows();
      });
    }

    // Error filters
    const severityFilter = document.getElementById('filter-severity');
    if (severityFilter) {
      severityFilter.addEventListener('change', (e) => {
        AppState.filters.severity = e.target.value;
        renderErrors();
      });
    }

    const categoryFilter = document.getElementById('filter-category');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        AppState.filters.category = e.target.value;
        renderErrors();
      });
    }

    const fileFilter = document.getElementById('filter-file');
    if (fileFilter) {
      fileFilter.addEventListener('change', (e) => {
        AppState.filters.file = e.target.value;
        renderErrors();
      });
    }

    const searchBox = document.getElementById('error-search');
    if (searchBox) {
      let searchTimeout;
      searchBox.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          AppState.filters.search = e.target.value;
          renderErrors();
        }, 300);
      });
    }

    // Fixer file selector
    const fixerFileSelector = document.getElementById('fixer-file-selector');
    if (fixerFileSelector) {
      fixerFileSelector.addEventListener('change', (e) => {
        AppState.selectedFixerFile = parseInt(e.target.value);
        renderFixerDiff();
      });
    }

    // Download fixed files button
    const downloadFixedBtn = document.getElementById('btn-download-fixed');
    if (downloadFixedBtn) {
      downloadFixedBtn.addEventListener('click', downloadFixedFiles);
    }

    // Export buttons
    const exportPdfBtn = document.getElementById('btn-export-pdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', () => {
        if (!AppState.analysisResult) return;
        try {
          const reportHtml = Visualizers.generateFullReport(AppState.analysisResult);
          UI.exportToPdf(reportHtml);
        } catch (err) {
          UI.showToast('Gagal ekspor PDF: ' + err.message, 'error');
        }
      });
    }

    const exportWordBtn = document.getElementById('btn-export-word');
    if (exportWordBtn) {
      exportWordBtn.addEventListener('click', () => {
        if (!AppState.analysisResult) return;
        try {
          const reportHtml = Visualizers.generateFullReport(AppState.analysisResult);
          UI.exportToWord(reportHtml);
        } catch (err) {
          UI.showToast('Gagal ekspor Word: ' + err.message, 'error');
        }
      });
    }

    const exportCsvBtn = document.getElementById('btn-export-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        if (!AppState.analysisResult) return;
        UI.exportToCsv(AppState.analysisResult.issues);
      });
    }

    const exportJsonBtn = document.getElementById('btn-export-json');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        if (!AppState.analysisResult) return;
        UI.exportToJson(AppState.analysisResult);
      });
    }

    // Test bed button
    const loadTestBtn = document.getElementById('btn-load-test');
    if (loadTestBtn) {
      loadTestBtn.addEventListener('click', loadTestData);
    }

    // Run simulated tests button
    const runTestsBtn = document.getElementById('btn-run-tests');
    if (runTestsBtn) {
      runTestsBtn.addEventListener('click', runSimulatedTests);
    }

    // View fix from error card (delegated)
    document.addEventListener('click', (e) => {
      const viewFixBtn = e.target.closest('[data-action="view-fix"]');
      if (viewFixBtn) {
        const issueId = viewFixBtn.getAttribute('data-issue-id');
        viewFixForIssue(issueId);
      }

      // Open comments drawer
      const openCommentsBtn = e.target.closest('[data-action="open-comments"]');
      if (openCommentsBtn) {
        const issueId = openCommentsBtn.getAttribute('data-issue-id');
        openCommentsDrawer(issueId);
      }

      // Toggle error card expansion
      const errorCard = e.target.closest('.error-card-header');
      if (errorCard) {
        const card = errorCard.closest('.error-card');
        if (card) card.classList.toggle('expanded');
      }
    });

    // Comments Drawer Submit Comment
    const submitCommentBtn = document.getElementById('btn-submit-comment');
    const commentInput = document.getElementById('comment-input');
    if (submitCommentBtn && commentInput) {
      submitCommentBtn.addEventListener('click', async () => {
        const commentText = commentInput.value.trim();
        if (!commentText) {
          UI.showToast('Komentar tidak boleh kosong.', 'warning');
          return;
        }
        if (!AppState.activeIssueId) {
          UI.showToast('Gagal mengirim komentar: ID masalah tidak ditemukan.', 'error');
          return;
        }

        try {
          submitCommentBtn.disabled = true;
          commentInput.disabled = true;
          await postComment(AppState.activeIssueId, commentText);
          commentInput.value = '';
          
          // Reload comments list
          const comments = await loadComments(AppState.activeIssueId);
          UI.renderComments(comments);
          UI.showToast('Komentar berhasil dikirim!', 'success');
        } catch (err) {
          // Toast handled by postComment
        } finally {
          submitCommentBtn.disabled = false;
          commentInput.disabled = false;
        }
      });

      // Allow Enter to submit if not Shift+Enter
      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitCommentBtn.click();
        }
      });
    }

    // Comments Drawer Close Buttons
    const drawerCloseBtn = document.getElementById('comments-drawer-close');
    const drawerBackdrop = document.getElementById('comments-drawer-backdrop');
    const commentsDrawer = document.getElementById('comments-drawer');
    if (commentsDrawer) {
      const closeDrawer = () => {
        commentsDrawer.style.display = 'none';
        AppState.activeIssueId = null;
      };
      if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
      if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
    }
  }

  // ============================================================
  // Actions
  // ============================================================
  function loadTestData() {
    try {
      const lang = localStorage.getItem('lang') || 'id';
      UI.showLoading(lang === 'en' ? 'Loading test data...' : 'Memuat data test...');
      const testFiles = TestData.getTestFiles();
      AppState.uploadedFiles = testFiles;
      UI.renderFileTree(testFiles);

      const fileCount = document.getElementById('file-count');
      if (fileCount) {
        fileCount.textContent = lang === 'en' ? `${testFiles.length} test files loaded` : `${testFiles.length} file test dimuat`;
      }

      // Enable run tests button
      const runTestsBtn = document.getElementById('btn-run-tests');
      if (runTestsBtn) {
        runTestsBtn.removeAttribute('disabled');
        runTestsBtn.disabled = false;
      }

      // Show expected results
      const expectedDiv = document.getElementById('test-expected-results');
      if (expectedDiv) {
        const expected = TestData.getExpectedResults();
        const issuesList = expected.expectedIssues || [];
        const expectedTitle = lang === 'en' ? 'Expected Results' : 'Hasil yang Diharapkan';
        expectedDiv.innerHTML = `
          <div class="card">
            <h3>📋 ${expectedTitle}</h3>
            <div class="expected-results-content">
              ${issuesList.map(e => `
                <div class="expected-item">
                  <span class="badge badge-${e.severity}">${e.severity.toUpperCase()}</span>
                  <span>${e.description}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      UI.hideLoading();
      UI.showToast(lang === 'en' ? 'Test data loaded! Click "Start Analysis".' : 'Data test berhasil dimuat! Klik "Mulai Analisis" untuk menganalisis.', 'success');

      // Navigate to upload and auto-trigger analysis
      navigateTo('upload');

      const analyzeBtn = document.getElementById('btn-analyze');
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.classList.add('pulse-glow');
      }

    } catch (err) {
      UI.hideLoading();
      UI.showToast('Gagal memuat data test: ' + err.message, 'error');
    }
  }

  function viewFixForIssue(issueId) {
    // Find the fix result containing this issue
    for (let i = 0; i < AppState.fixResults.length; i++) {
      const result = AppState.fixResults[i];
      if (result.fixes && result.fixes.some(f => f.issueId === issueId || f.ruleId === issueId)) {
        AppState.selectedFixerFile = i;
        navigateTo('fixer');
        return;
      }
    }

    // If no specific fix found, just navigate to fixer
    navigateTo('fixer');
    UI.showToast('Perbaikan untuk masalah ini mungkin perlu dilakukan secara manual.', 'info');
  }

  function downloadFixedFiles() {
    if (AppState.fixResults.length === 0) {
      UI.showToast('Tidak ada perbaikan yang tersedia.', 'warning');
      return;
    }

    const fixedFiles = AppState.fixResults.filter(r => r.fixes && r.fixes.length > 0);
    if (fixedFiles.length === 0) {
      UI.showToast('Tidak ada file yang perlu diperbaiki.', 'info');
      return;
    }

    // If JSZip is available, create a zip
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      fixedFiles.forEach(result => {
        const path = result.file || 'unknown.py';
        zip.file(path, result.fixedContent);
      });

      zip.generateAsync({ type: 'blob' }).then(blob => {
        downloadBlob(blob, 'odoo_fixed_code.zip');
        UI.showToast(`${fixedFiles.length} file yang diperbaiki telah diunduh.`, 'success');
      });
    } else {
      // Fallback: download individual files
      fixedFiles.forEach(result => {
        const fileName = (result.file || 'unknown.py').split('/').pop();
        const blob = new Blob([result.fixedContent], { type: 'text/plain' });
        downloadBlob(blob, `fixed_${fileName}`);
      });
      UI.showToast(`${fixedFiles.length} file yang diperbaiki telah diunduh.`, 'success');
    }
  }

  // ============================================================
  // Utilities
  // ============================================================
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ============================================================
  // Theme Management (Light / Dark Mode)
  // ============================================================
  function initTheme() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (!themeBtn) return;

    // Load saved theme or default to dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    themeBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      localStorage.setItem('theme', newTheme);
      UI.showToast(`Mode ${newTheme === 'dark' ? 'gelap' : 'terang'} diaktifkan.`, 'info');
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    // Re-render Mermaid diagrams if on flows section
    if (AppState.analysisResult && AppState.currentSection === 'flows') {
      renderFlows();
    }
  }

  // ============================================================
  // Language Management (ID / EN Mode)
  // ============================================================
  function initLanguage() {
    const langBtn = document.getElementById('lang-toggle-btn');
    if (!langBtn) return;

    const savedLang = localStorage.getItem('lang') || 'id';
    applyLanguage(savedLang);

    langBtn.addEventListener('click', () => {
      const currentLang = localStorage.getItem('lang') || 'id';
      const newLang = currentLang === 'id' ? 'en' : 'id';
      applyLanguage(newLang);
      UI.showToast(newLang === 'en' ? 'Language switched to English.' : 'Bahasa diubah ke Bahasa Indonesia.', 'info');
    });
  }

  function applyLanguage(lang) {
    localStorage.setItem('lang', lang);

    // Update toggle button
    const toggleIcon = document.getElementById('lang-toggle-icon');
    const toggleLabel = document.getElementById('lang-toggle-label');
    if (toggleIcon && toggleLabel) {
      toggleIcon.textContent = lang === 'en' ? '🇬🇧' : '🇮🇩';
      toggleLabel.textContent = lang === 'en' ? 'EN' : 'ID';
    }

    // Translate all static elements
    const elements = document.querySelectorAll('[data-translate]');
    elements.forEach(el => {
      const key = el.getAttribute('data-translate');
      if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) {
        el.innerHTML = TRANSLATIONS[lang][key];
      }
    });

    // Update document lang attribute
    document.documentElement.lang = lang;

    // Trigger re-rendering of sections that contain dynamic translations
    if (AppState.analysisResult) {
      // Re-render dashboard to update chart language & health gauge label
      if (AppState.currentSection === 'dashboard') {
        renderDashboard();
      }
      // Re-render errors to update rule text translation
      if (AppState.currentSection === 'errors') {
        renderErrors();
      }
      // Re-render fixer to update descriptions
      if (AppState.currentSection === 'fixer') {
        renderFixer();
      }
      // Re-render report to update PDF/Word strings
      if (AppState.currentSection === 'report') {
        renderReport();
      }
    }
  }

  // ============================================================
  // Simulated Odoo Unit Test Runner
  // ============================================================
  function runSimulatedTests() {
    // Viewer cannot run tests
    if (AppState.user && AppState.user.role === 'Viewer') {
      UI.showToast('Akses ditolak: Viewer tidak diperbolehkan menjalankan test.', 'error');
      return;
    }

    const consoleEl = document.getElementById('test-console');
    if (!consoleEl) return;

    const runBtn = document.getElementById('btn-run-tests');
    if (runBtn) runBtn.disabled = true;

    consoleEl.style.display = 'block';
    consoleEl.innerHTML = '';
    
    const lang = localStorage.getItem('lang') || 'id';
    UI.showToast(lang === 'en' ? 'Running Odoo test suite...' : 'Menjalankan test suite Odoo...', 'info');

    // Real-time SSE logs streaming from backend
    const sse = new EventSource(`/api/testbed/run?token=${AppState.token}`);
    
    sse.addEventListener('test_start', (e) => {
      const data = JSON.parse(e.data);
      const span = document.createElement('div');
      span.style.color = '#74b9ff';
      span.textContent = data.message;
      consoleEl.appendChild(span);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    });

    sse.addEventListener('test_log', (e) => {
      const data = JSON.parse(e.data);
      const span = document.createElement('div');
      
      const line = data.message;
      if (line.includes('ERROR') || line.includes('FAILED') || line.includes('FAIL') || line.includes('AssertionError') || line.includes('Traceback')) {
        span.style.color = '#ff6b6b';
      } else if (line.includes('... [PASS]') || line.includes('[PASS]') || line.includes('passed')) {
        span.style.color = '#00ff66';
      } else if (line.includes('INFO') || line.includes('Starting')) {
        span.style.color = '#74b9ff';
      } else {
        span.style.color = '#e8e8f0';
      }
      
      span.textContent = line;
      consoleEl.appendChild(span);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    });

    sse.addEventListener('test_end', (e) => {
      const data = JSON.parse(e.data);
      const span = document.createElement('div');
      span.style.color = '#00ff66';
      span.style.fontWeight = 'bold';
      span.textContent = data.message;
      consoleEl.appendChild(span);
      consoleEl.scrollTop = consoleEl.scrollHeight;
      
      if (runBtn) runBtn.disabled = false;
      sse.close();
      
      // Log testbed run audit
      fetch('/api/audit-logs', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AppState.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'Run Unit Tests', details: 'Executed unit tests in testbed. Real-time run success.' })
      });
    });

    sse.onerror = (err) => {
      console.error('SSE Error:', err);
      const span = document.createElement('div');
      span.style.color = '#ff6b6b';
      span.textContent = '❌ Hubungan ke server terputus.';
      consoleEl.appendChild(span);
      if (runBtn) runBtn.disabled = false;
      sse.close();
    };
  }

  // Admin section fetch and display helper
  async function renderAdmin() {
    if (!AppState.user || AppState.user.role !== 'Admin') {
      UI.showToast('Hanya Admin yang dapat mengakses halaman ini.', 'error');
      navigateTo('upload');
      return;
    }

    try {
      UI.showLoading('Memuat data admin...');
      
      // Fetch users
      const usersRes = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      });
      const users = await usersRes.json();

      // Fetch audit logs
      const logsRes = await fetch('/api/audit-logs', {
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      });
      const logs = await logsRes.json();

      UI.renderAdminConsole(users, logs);
      UI.hideLoading();
    } catch (err) {
      console.error('Error loading admin data:', err);
      UI.showToast('Gagal memuat data admin: ' + err.message, 'error');
      UI.hideLoading();
    }
  }

  // Update user role from admin console
  async function updateUserRole(userId, newRole) {
    try {
      UI.showLoading('Memperbarui peran...');
      const response = await fetch(`/api/users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${AppState.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      });
      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || 'Gagal');
      UI.showToast('Peran berhasil diperbarui!', 'success');
      
      // Reload admin section
      renderAdmin();
    } catch (err) {
      UI.showToast('Gagal memperbarui peran: ' + err.message, 'error');
      UI.hideLoading();
    }
  }

  // Collaborative Comments helpers
  async function loadComments(issueId) {
    try {
      const response = await fetch(`/api/issues/${issueId}/comments`, {
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      });
      return await response.json();
    } catch (err) {
      console.error('Error loading comments:', err);
      return [];
    }
  }

  async function postComment(issueId, commentText) {
    try {
      const response = await fetch(`/api/issues/${issueId}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AppState.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ commentText })
      });
      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || 'Gagal mengirim');
      return resData;
    } catch (err) {
      UI.showToast('Gagal mengirim komentar: ' + err.message, 'error');
      throw err;
    }
  }

  // Open Comments Drawer and Load Comments
  async function openCommentsDrawer(issueId) {
    if (!issueId) return;
    
    // Find the issue
    if (!AppState.analysisResult || !Array.isArray(AppState.analysisResult.issues)) {
      UI.showToast('Tidak ada data analisis untuk masalah ini.', 'warning');
      return;
    }
    
    const issue = AppState.analysisResult.issues.find(i => i.id === issueId);
    if (!issue) {
      UI.showToast('Masalah tidak ditemukan.', 'error');
      return;
    }

    AppState.activeIssueId = issueId;

    const briefContainer = document.getElementById('drawer-issue-brief');
    if (briefContainer) {
      const ruleId = issue.ruleId || issue.id?.split('_')[0];
      const lang = localStorage.getItem('lang') || 'id';
      let title = issue.title;
      if (lang === 'en' && window.OdooAnalyzer.RULE_TRANSLATIONS?.[ruleId]) {
        title = window.OdooAnalyzer.RULE_TRANSLATIONS[ruleId].title;
      }
      briefContainer.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;color:#e8e8f0;">${_escapeHtml(title)}</div>
        <div style="font-size:0.75rem;color:#8888a8;">File: ${issue.file}:${issue.line}</div>
      `;
    }

    const commentsDrawer = document.getElementById('comments-drawer');
    if (commentsDrawer) {
      commentsDrawer.style.display = 'flex';
      
      const commentInput = document.getElementById('comment-input');
      if (commentInput) {
        commentInput.value = '';
        commentInput.focus();
      }

      // Load and render comments
      try {
        UI.renderComments([]); // Show loading/empty state first
        const comments = await loadComments(issueId);
        UI.renderComments(comments);
      } catch (err) {
        console.error('Error loading comments:', err);
      }
    }
  }

  function _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Run analysis wrapper with role checks and audit log
  async function runAnalysisWithRoleCheck() {
    if (AppState.user && AppState.user.role === 'Viewer') {
      UI.showToast('Akses ditolak: Viewer tidak diperbolehkan menjalankan analisis.', 'error');
      return;
    }

    try {
      await runAnalysis();
      
      // Post audit log
      fetch('/api/audit-logs', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AppState.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'Run Code Analysis',
          details: `Analyzed ${AppState.uploadedFiles.length} files. Health Score: ${AppState.analysisResult.stats.healthScore}`
        })
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Authentication check helper
  async function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('erpura_token', tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = localStorage.getItem('erpura_token');
    if (!token) {
      document.getElementById('login-screen').style.display = 'flex';
      document.querySelector('.app-layout').style.display = 'none';
      document.querySelector('.app-header').style.display = 'none';
      UI.hideLoading();
      return false;
    }

    try {
      UI.showLoading('Memvalidasi sesi...');
      const response = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error('Sesi kedaluwarsa');
      }
      const user = await response.json();
      AppState.user = user;
      AppState.token = token;

      document.getElementById('login-screen').style.display = 'none';
      document.querySelector('.app-layout').style.display = 'grid';
      document.querySelector('.app-header').style.display = 'flex';
      
      UI.renderUserWidget(user);

      if (user.role === 'Admin') {
        const navAdmin = document.getElementById('nav-admin');
        if (navAdmin) {
          navAdmin.style.display = 'flex';
          navAdmin.classList.remove('disabled');
        }
      }

      if (tokenFromUrl) {
        await fetch('/api/audit-logs', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action: 'User Auth Success', details: 'User authenticated successfully via Lark SSO' })
        });
      }

      UI.hideLoading();
      return true;
    } catch (err) {
      console.error('Auth check error:', err);
      localStorage.removeItem('erpura_token');
      document.getElementById('login-screen').style.display = 'flex';
      document.querySelector('.app-layout').style.display = 'none';
      document.querySelector('.app-header').style.display = 'none';
      UI.hideLoading();
      UI.showToast('Silakan masuk kembali: ' + err.message, 'warning');
      return false;
    }
  }

  function initLogout() {
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('erpura_token');
        window.location.reload();
      });
    }
  }

  async function init() {
    console.log('%c🔍 Erpura v1.0', 'color: #7c5cfc; font-size: 18px; font-weight: bold;');
    console.log('%cAnalisis, Perbaikan & Live Deployment Odoo ERP', 'color: #00d4aa; font-size: 12px;');

    // Check dependencies
    const deps = ['Parsers', 'Analyzers', 'CodeFixer', 'UI', 'Visualizers', 'TestData'];
    const missing = deps.filter(d => !OA[d]);
    if (missing.length > 0) {
      console.error('Missing modules:', missing.join(', '));
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a1a;color:#ff6b6b;font-family:Inter,sans-serif;flex-direction:column;padding:2rem;">
          <h1 style="color:#e8e8f0;margin-bottom:1rem;">⚠️ Initialization Error</h1>
          <p>Module yang dibutuhkan belum dimuat: <strong>${missing.join(', ')}</strong></p>
          <p style="color:#8888a8;margin-top:0.5rem;">Pastikan semua file JavaScript telah dimuat dengan benar.</p>
        </div>`;
      return;
    }

    // Initialize modules
    try {
      initTheme();
      initLanguage();
      initNavigation();
      initLogout();
      
      // Perform Authentication check
      const authenticated = await checkAuth();
      if (!authenticated) return;

      UI.initFileUploader(handleFilesSelected);
      initEventListeners();

      // Start on upload section
      navigateTo('upload');

      console.log('✅ Application initialized successfully.');
    } catch (err) {
      console.error('Initialization error:', err);
      UI.showToast('Gagal menginisialisasi aplikasi: ' + err.message, 'error');
    }
  }
        
        span.textContent = line;
        consoleEl.appendChild(span);
        consoleEl.scrollTop = consoleEl.scrollHeight;
        
        currentLine++;
        setTimeout(printNextLine, 150);
      } else {
        if (runBtn) runBtn.disabled = false;
        UI.showToast(lang === 'en' ? 'Tests execution completed.' : 'Eksekusi tes selesai.', 'warning');
      }
    }

    printNextLine();
  }



  // ============================================================
  // Initialization
  // ============================================================
  function init() {
    console.log('%c🔍 Erpura v1.0', 'color: #7c5cfc; font-size: 18px; font-weight: bold;');
    console.log('%cAnalisis, Perbaikan & Live Deployment Odoo ERP', 'color: #00d4aa; font-size: 12px;');

    // Check dependencies
    const deps = ['Parsers', 'Analyzers', 'CodeFixer', 'UI', 'Visualizers', 'TestData'];
    const missing = deps.filter(d => !OA[d]);
    if (missing.length > 0) {
      console.error('Missing modules:', missing.join(', '));
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a1a;color:#ff6b6b;font-family:Inter,sans-serif;flex-direction:column;padding:2rem;">
          <h1 style="color:#e8e8f0;margin-bottom:1rem;">⚠️ Initialization Error</h1>
          <p>Module yang dibutuhkan belum dimuat: <strong>${missing.join(', ')}</strong></p>
          <p style="color:#8888a8;margin-top:0.5rem;">Pastikan semua file JavaScript telah dimuat dengan benar.</p>
        </div>`;
      return;
    }

    // Initialize modules
    try {
      initTheme();
      initLanguage();
      initNavigation();
      UI.initFileUploader(handleFilesSelected);
      initEventListeners();

      // Start on upload section
      navigateTo('upload');

      console.log('✅ Application initialized successfully.');
    } catch (err) {
      console.error('Initialization error:', err);
      UI.showToast('Gagal menginisialisasi aplikasi: ' + err.message, 'error');
    }
  }

  // ============================================================
  // Expose app controller globally for debugging
  // ============================================================
  window.OdooAnalyzer.App = {
    state: AppState,
    navigateTo,
    runAnalysis,
    loadTestData,
    downloadFixedFiles,
    updateUserRole,
    postComment,
    loadComments,
    openCommentsDrawer,
  };

  // ============================================================
  // Start application when DOM is ready
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
