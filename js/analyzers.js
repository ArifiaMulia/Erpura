/**
 * analyzers.js - Odoo Code Analyzer Engine
 * ========================================
 * Analyzes Odoo models, relationships, business flows, and code issues.
 * 
 * Exposed as: window.OdooAnalyzer.Analyzers
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};

window.OdooAnalyzer.Analyzers = (function () {
  'use strict';

  // ============================================================
  // Model & Relationship Analyzer
  // ============================================================
  function analyzeModels(modules) {
    const relationships = [];

    modules.forEach(module => {
      module.models.forEach(model => {
        const fromModel = model.name || model.className;

        // 1. Relational Fields
        model.fields.forEach(field => {
          const toModel = field.params.comodel_name;
          if (!toModel) return;

          const type = field.type.toLowerCase();
          if (['many2one', 'one2many', 'many2many'].includes(type)) {
            relationships.push({
              from: fromModel,
              to: toModel,
              type: type,
              field: field.name,
              fieldName: field.name,
              label: `${field.name} (${type})`
            });
          }
        });

        // 2. Class Inheritance (_inherit)
        if (model.inherit && model.inherit.length > 0) {
          model.inherit.forEach(parent => {
            relationships.push({
              from: fromModel,
              to: parent,
              type: 'inherit',
              field: '_inherit',
              fieldName: '_inherit',
              label: 'Inherits'
            });
          });
        }

        // 3. Delegation Inheritance (_inherits)
        if (model.inherits && typeof model.inherits === 'object') {
          Object.keys(model.inherits).forEach(parent => {
            const fieldName = model.inherits[parent];
            relationships.push({
              from: fromModel,
              to: parent,
              type: 'inherits',
              field: fieldName,
              fieldName: fieldName,
              label: `Delegates (${fieldName})`
            });
          });
        }
      });
    });

    return relationships;
  }

  // ============================================================
  // Business Flow Analyzer
  // ============================================================
  function analyzeBusinessFlows(modules) {
    const businessFlows = [];

    modules.forEach(module => {
      module.models.forEach(model => {
        // Look for 'state' or 'status' field
        const stateField = model.fields.find(f => f.name === 'state' || f.name === 'status');
        if (!stateField) return;

        const states = model.states && model.states.length > 0
          ? model.states
          : [{ value: 'draft', label: 'Draft' }]; // default fallback

        const transitions = [];

        // Scan methods for state writes
        model.methods.forEach(method => {
          const body = method.body;
          if (!body) return;

          // Find writes: self.write({'state': 'confirmed'}) or self.state = 'confirmed'
          // Matches: write({ ..., 'state': 'val', ... })
          const writePattern = /write\s*\(\s*\{\s*[^}*]*['"]state['"]\s*:\s*['"]([a-zA-Z0-9_]+)['"]/g;
          // Matches: state = 'val'
          const assignPattern = /state\s*=\s*['"]([a-zA-Z0-9_]+)['"]/g;

          const destStates = new Set();
          let match;

          while ((match = writePattern.exec(body)) !== null) {
            destStates.add(match[1]);
          }
          while ((match = assignPattern.exec(body)) !== null) {
            destStates.add(match[1]);
          }

          destStates.forEach(dest => {
            // Find "from" state from method name or body context if possible
            let fromState = 'draft'; // default starting state

            // Smart 'from' state detection:
            // Check if method checks state e.g. "if self.state == 'checking':"
            const stateCheckPattern = /state\s*==\s*['"]([a-zA-Z0-9_]+)['"]/g;
            let checkMatch = stateCheckPattern.exec(body);
            if (checkMatch) {
              fromState = checkMatch[1];
            } else {
              // Guess based on transition method name conventions
              if (method.name.includes('approve') || method.name.includes('confirm')) {
                fromState = 'draft';
              } else if (method.name.includes('done') || method.name.includes('complete')) {
                fromState = states.length > 1 ? states[1].value : 'draft';
              } else if (method.name.includes('cancel')) {
                fromState = 'checking'; // or draft/any
              } else if (method.name.includes('reset') || method.name.includes('draft')) {
                fromState = 'cancelled';
              }
            }

            transitions.push({
              from: fromState,
              to: dest,
              method: method.name,
              label: `${method.name}()`
            });
          });
        });

        // Deduplicate transitions
        const uniqueTransitions = [];
        const seen = new Set();
        transitions.forEach(t => {
          const key = `${t.from}->${t.to}:${t.method}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueTransitions.push(t);
          }
        });

        // Determine type of workflow
        let type = 'state_machine';
        if (states.some(s => s.value.includes('approve') || s.value.includes('validate'))) {
          type = 'approval';
        } else if (states.some(s => s.value === 'draft' && s.value === 'done')) {
          type = 'document_lifecycle';
        }

        businessFlows.push({
          name: model.description || model.name,
          model: model.name || model.className,
          states: states,
          transitions: uniqueTransitions,
          type: type
        });
      });
    });

    return businessFlows;
  }

  // ============================================================
  // Error & Anti-Pattern Detector
  // ============================================================
  function detectErrors(modules) {
    const issues = [];

    // Helper: generate issue
    function addIssue(id, severity, category, title, description, file, line, code, suggestion, fixedCode = '', ruleId = '') {
      issues.push({
        id: `${id}_${file.replace(/[^a-zA-Z0-9]/g, '_')}_${line}`,
        severity,
        category,
        title,
        description,
        file,
        line,
        code: code ? code.trim() : '',
        suggestion,
        fixedCode,
        ruleId: ruleId || id
      });
    }

    modules.forEach(module => {
      // MIS001: Missing manifest
      const hasManifest = module.files.some(f => f.name === '__manifest__.py' || f.name === '__openerp__.py');
      if (!hasManifest) {
        addIssue('MIS001', 'warning', 'missing', 'Missing __manifest__.py',
          'File __manifest__.py tidak ditemukan di modul ini. Manifest sangat penting untuk mendefinisikan meta-data modul, dependensi, dan file yang dimuat.',
          module.path + '/__manifest__.py', 1, '',
          'Buat file __manifest__.py baru untuk mendefinisikan modul.'
        );
      } else {
        // Check license key in manifest
        const manifestFile = module.files.find(f => f.name === '__manifest__.py' || f.name === '__openerp__.py');
        if (manifestFile && (!module.manifest.license || module.manifest.license.trim() === '')) {
          addIssue('MIS003', 'warning', 'missing', 'Missing license in manifest',
            'File __manifest__.py tidak memiliki key "license". Sejak Odoo 14, field license wajib ada di manifest.',
            manifestFile.path, 1, manifestFile.content.substring(0, 100),
            "Tambahkan misalnya: 'license': 'LGPL-3' atau lisensi yang sesuai pada manifest file."
          );
        }
      }

      // Check CSV model access rights for custom models
      // SEC003: Missing ir.model.access.csv for custom models
      const allAccessModels = new Set(module.security.accessRights.map(r => r.modelId));
      
      module.models.forEach(model => {
        const modelName = model.name;
        
        // Only verify custom models (which have a new name defined, not just class extensions)
        const isExtensionOnly = model.inherit && model.inherit.length > 0 && !model.name;
        const isCustomModel = modelName && !isExtensionOnly;

        if (isCustomModel) {
          if (!allAccessModels.has(modelName)) {
            addIssue('SEC003', 'critical', 'security', 'Missing access rights',
              `Model ${modelName} tidak memiliki entri di ir.model.access.csv. Pengguna tidak akan bisa mengakses menu atau data model ini tanpa hak akses yang didefinisikan.`,
              module.path + '/security/ir.model.access.csv', 1, `model: ${modelName}`,
              `Tambahkan aturan hak akses untuk model ${modelName} di ir.model.access.csv.`
            );
          }
        }

        // MIS002: Missing _description
        if (isCustomModel && (!model.description || model.description.trim() === '')) {
          addIssue('MIS002', 'warning', 'missing', 'Missing _description',
            `Model ${modelName || model.className} tidak memiliki atribut _description. Sejak Odoo 12, setiap model baru wajib memiliki deskripsi untuk keperluan logging dan searchability.`,
            model.file, model.line, `class ${model.className}`,
            `Tambahkan atribut _description = 'Deskripsi Singkat Model' pada kelas model.`
          );
        }

        // Base class checks
        if (model.className && model.className.includes('osv')) {
          addIssue('DEP004', 'warning', 'deprecated', 'osv.osv class usage',
            'Kelas mewarisi osv.osv yang sudah deprecated sejak Odoo 8. Gunakan models.Model sebagai gantinya.',
            model.file, model.line, `class ${model.className}`,
            'Ganti osv.osv atau orm.Model dengan models.Model.'
          );
        }

        // Check fields
        model.fields.forEach(field => {
          // DEP007: lowercase field declaration
          if (field.type[0] === field.type[0].toLowerCase()) {
            addIssue('DEP007', 'warning', 'deprecated', 'Old-style field declaration',
              `Field ${field.name} menggunakan tipe fields.${field.type} (huruf kecil) yang merupakan gaya lama. Gunakan huruf kapital (fields.Char, fields.Integer, dll.).`,
              model.file, field.line, `${field.name} = fields.${field.type}`,
              `Ubah fields.${field.type} menjadi fields.${field.type[0].toUpperCase() + field.type.slice(1)}.`
            );
          }

          // DAT001: Many2one without ondelete
          if (field.type.toLowerCase() === 'many2one' && !field.params.ondelete) {
            addIssue('DAT001', 'warning', 'data_integrity', 'Many2one without ondelete',
              `Field ${field.name} (Many2one) tidak mendefinisikan parameter ondelete. Jika record yang dirujuk dihapus, hal ini dapat menyebabkan ketidakkonsistenan database.`,
              model.file, field.line, `${field.name} = fields.${field.type}`,
              `Tambahkan parameter ondelete='set null' atau ondelete='cascade' pada deklarasi Many2one.`
            );
          }

          // PERF002: Computed field without store=True
          if (field.params.compute && field.params.store !== 'True' && field.params.store !== true) {
            addIssue('PERF002', 'warning', 'performance', 'Computed field without store',
              `Field ${field.name} adalah computed field tanpa store=True. Jika field ini sering digunakan untuk pencarian, filter, atau laporan, hal ini dapat memperlambat query.`,
              model.file, field.line, `${field.name} = fields.${field.type}`,
              `Tambahkan parameter store=True pada computed field jika field ini sering dicari atau difilter.`
            );
          }
        });

        // Check methods
        model.methods.forEach(method => {
          const body = method.body || '';
          const line = method.line;

          // BAD004: Missing docstring
          const firstLineTrimmed = body.split('\n')[0]?.trim() || '';
          const hasDocstring = firstLineTrimmed.startsWith('"""') || firstLineTrimmed.startsWith("'''");
          if (!hasDocstring) {
            addIssue('BAD004', 'info', 'bad_practice', 'Missing docstring',
              `Method ${method.name}() tidak memiliki docstring penjelasan. Dokumentasi yang baik membantu developer berikutnya memahami maksud dari metode ini.`,
              model.file, line, `def ${method.name}`,
              `Tambahkan deskripsi singkat di awal method menggunakan triple quotes: """Penjelasan method"""`
            );
          }

          // BAD003: Missing super() in write/create/unlink
          if (['create', 'write', 'unlink'].includes(method.name) && !method.hasSuper) {
            addIssue('BAD003', 'critical', 'bad_practice', `Missing super() in ${method.name}`,
              `Override method ${method.name}() tidak memanggil super(). Ini menyebabkan data tidak benar-benar tersimpan ke database atau merusak fungsionalitas dasar Odoo.`,
              model.file, line, `def ${method.name}`,
              `Pastikan memanggil return super().${method.name}(vals) di akhir method override.`
            );
          }

          // DEP001/DEP002: api.multi / api.one deprecated
          method.decorators.forEach(dec => {
            if (dec.includes('api.multi')) {
              addIssue('DEP001', 'warning', 'deprecated', '@api.multi deprecated',
                'Dekorator @api.multi sudah deprecated sejak Odoo 13. Di Odoo 13+, semua method secara default sudah menerima multi-recordset.',
                model.file, line, dec,
                `Hapus dekorator @api.multi dari method ${method.name}().`
              );
            } else if (dec.includes('api.one')) {
              addIssue('DEP002', 'warning', 'deprecated', '@api.one deprecated',
                'Dekorator @api.one sudah deprecated sejak Odoo 13. Gunakan perulangan di dalam method alih-alih bergantung pada @api.one.',
                model.file, line, dec,
                `Hapus @api.one dan gunakan perulangan: for rec in self: di dalam method.`
              );
            } else if (dec.includes('api.returns')) {
              addIssue('DEP003', 'warning', 'deprecated', '@api.returns deprecated',
                'Dekorator @api.returns sudah didepresiasi. Hindari penggunaannya jika tidak mendesak.',
                model.file, line, dec,
                'Hapus dekorator @api.returns dan kelola return value secara manual.'
              );
            }
          });

          // SEC001: SQL Injection
          // Search for cr.execute containing string formatting (%, .format, or f-string)
          // cr.execute("SELECT ... %s" % var) or cr.execute(f"SELECT ... {var}")
          const sqlFormatPattern = /cr\.execute\s*\(\s*(?:['"].*?['"]\s*%\s*|[^,]+%\s*|f['"].*?\{|.*\.format\s*\()/s;
          if (sqlFormatPattern.test(body)) {
            // Find the exact line in body
            const bodyLines = body.split('\n');
            let vulnLine = line;
            let codeSnippet = '';
            for (let j = 0; j < bodyLines.length; j++) {
              if (bodyLines[j].includes('cr.execute') && (bodyLines[j].includes('%') || bodyLines[j].includes('.format') || bodyLines[j].includes('{'))) {
                vulnLine = line + j;
                codeSnippet = bodyLines[j];
                break;
              }
            }
            addIssue('SEC001', 'critical', 'security', 'SQL Injection vulnerability',
              `Metode ${method.name}() menggunakan format string dinamis untuk menyusun query SQL. Ini memungkinkan serangan SQL Injection yang dapat membahayakan database.`,
              model.file, vulnLine, codeSnippet || `cr.execute(...) di ${method.name}`,
              'Gunakan parameter binding dengan %s sebagai placeholder dan lewatkan argumen sebagai tuple kedua: cr.execute("SELECT * FROM table WHERE id = %s", (record_id,))'
            );
          }

          // BAD005: cr.commit() manual
          if (body.includes('cr.commit()')) {
            const bodyLines = body.split('\n');
            let commitLine = line;
            for (let j = 0; j < bodyLines.length; j++) {
              if (bodyLines[j].includes('cr.commit()')) {
                commitLine = line + j;
                break;
              }
            }
            addIssue('BAD005', 'warning', 'bad_practice', 'self.env.cr.commit() usage',
              'Pemanggilan cr.commit() secara manual terdeteksi. Odoo mengelola transaksi database secara atomik. Commit manual merusak rollback otomatis jika terjadi error.',
              model.file, commitLine, 'self.env.cr.commit()',
              'Hapus pemanggilan cr.commit() dan biarkan Odoo mengelola siklus transaksi secara otomatis.'
            );
          }

          // BAD001: Hardcoded browse(1)
          const hardcodedBrowsePattern = /browse\s*\(\s*(?:\[?\s*\d+\s*\]?)\s*\)/;
          if (hardcodedBrowsePattern.test(body)) {
            const bodyLines = body.split('\n');
            let browseLine = line;
            let codeSnippet = '';
            for (let j = 0; j < bodyLines.length; j++) {
              if (hardcodedBrowsePattern.test(bodyLines[j])) {
                browseLine = line + j;
                codeSnippet = bodyLines[j];
                break;
              }
            }
            addIssue('BAD001', 'warning', 'bad_practice', 'Hardcoded ID browse',
              `Metode ${method.name}() menggunakan browse() dengan ID record hardcoded. ID record dapat berbeda antar database (staging vs production).`,
              model.file, browseLine, codeSnippet,
              'Gunakan self.env.ref() dengan external XML ID atau cari data menggunakan search() berdasarkan kriteria dinamis.'
            );
          }

          // BAD002: Bare except
          // Matches: except: or except Exception: without logging
          const bareExceptPattern = /except\s*(?:Exception)?\s*:\s*\n?\s*(?:pass|return\s*\w+)\b/s;
          const hasBareExcept = bareExceptPattern.test(body) && !body.includes('_logger.exception') && !body.includes('_logger.error');
          if (hasBareExcept) {
            const bodyLines = body.split('\n');
            let exceptLine = line;
            for (let j = 0; j < bodyLines.length; j++) {
              if (bodyLines[j].trim().startsWith('except')) {
                exceptLine = line + j;
                break;
              }
            }
            addIssue('BAD002', 'warning', 'bad_practice', 'Bare except clause',
              `Metode ${method.name}() menggunakan blok except kosong tanpa mencatat error. Ini menyembunyikan masalah kode nyata dan mempersulit debugging.`,
              model.file, exceptLine, 'except:',
              'Tangkap exception spesifik atau Exception umum dan catat menggunakan _logger.exception() agar terekam di log system.'
            );
          }

          // PERF001: Search inside loop (N+1 queries)
          // Checks if search/browse is inside a for loop
          const loopSearchPattern = /for\s+[a-zA-Z0-9_]+\s+in\s+.*:\s*\n(?:\s{4,}|\s*\t+)+.*\.search\s*\(/s;
          if (loopSearchPattern.test(body)) {
            addIssue('PERF001', 'warning', 'performance', 'Search inside for loop',
              `Metode ${method.name}() melakukan search() di dalam perulangan (loop). Ini memicu N+1 query yang membuat performa sistem melambat secara signifikan saat jumlah data besar.`,
              model.file, line, `for ... loop in ${method.name}`,
              'Lakukan prefetch atau cari record secara massal di luar loop dengan domain list of IDs, lalu petakan data di memori.'
            );
          }

          // SEC002: sudo() usage
          if (body.includes('.sudo()')) {
            const bodyLines = body.split('\n');
            let sudoLine = line;
            for (let j = 0; j < bodyLines.length; j++) {
              if (bodyLines[j].includes('.sudo()')) {
                sudoLine = line + j;
                break;
              }
            }
            addIssue('SEC002', 'warning', 'security', 'sudo() usage',
              `Metode ${method.name}() menggunakan bypass hak akses .sudo(). Ini melompati aturan keamanan Odoo. Pastikan ada pemeriksaan keamanan manual sebelumnya.`,
              model.file, sudoLine, 'self.sudo()',
              'Hindari penggunaan .sudo() kecuali benar-benar diperlukan untuk operasi background. Batasi field yang dapat diedit.'
            );
          }
        });
      });
    });

    return issues;
  }

  // ============================================================
  // Health Score and Stats Calculation
  // ============================================================
  function calculateStats(modules, relationships, flows, issues) {
    const stats = {
      totalModules: modules.length,
      totalModels: 0,
      totalFields: 0,
      totalMethods: 0,
      totalViews: 0,
      totalActions: 0,
      totalMenus: 0,
      issuesBySeverity: {
        critical: 0,
        warning: 0,
        info: 0
      },
      issuesByCategory: {
        deprecated: 0,
        security: 0,
        performance: 0,
        bad_practice: 0,
        missing: 0,
        inheritance: 0,
        data_integrity: 0
      },
      healthScore: 100,
      odooVersionDetected: 'Odoo 14.0' // default detected version
    };

    // Aggregate counts
    modules.forEach(module => {
      stats.totalModels += module.models.length;
      stats.totalViews += module.views.length;
      stats.totalActions += module.actions.length;
      stats.totalMenus += module.menus.length;

      module.models.forEach(model => {
        stats.totalFields += model.fields.length;
        stats.totalMethods += model.methods.length;
        if (model.odooVersion && model.odooVersion !== 'v9+') {
          stats.odooVersionDetected = 'Odoo 8.0 atau lebih rendah';
        }
      });
    });

    // Detect version based on manifest depend or decorators
    const manifestVersions = modules.map(m => m.manifest?.version).filter(Boolean);
    if (manifestVersions.length > 0) {
      stats.odooVersionDetected = `Odoo ${manifestVersions[0]}`;
    }

    // Process Issues
    issues.forEach(issue => {
      // Severity
      if (stats.issuesBySeverity[issue.severity] !== undefined) {
        stats.issuesBySeverity[issue.severity]++;
      }

      // Category
      if (stats.issuesByCategory[issue.category] !== undefined) {
        stats.issuesByCategory[issue.category]++;
      }
    });

    // Calculate Health Score
    // Start at 100
    // Each critical: -10
    // Each warning: -3
    // Each info: -1
    let score = 100;
    score -= stats.issuesBySeverity.critical * 10;
    score -= stats.issuesBySeverity.warning * 3;
    score -= stats.issuesBySeverity.info * 1;

    stats.healthScore = Math.max(0, score);

    return stats;
  }

  // ============================================================
  // Master analyze function
  // ============================================================
  function analyze(modules) {
    const relationships = analyzeModels(modules);
    const businessFlows = analyzeBusinessFlows(modules);
    const issues = detectErrors(modules);
    const stats = calculateStats(modules, relationships, businessFlows, issues);

    return {
      modules,
      relationships,
      businessFlows,
      issues,
      stats,
      odooVersion: stats.odooVersionDetected
    };
  }

  return {
    analyze,
    analyzeModels,
    analyzeBusinessFlows,
    detectErrors,
    calculateStats
  };

})();
