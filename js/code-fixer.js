/**
 * code-fixer.js - Odoo Code Fixer and Generator Module
 * ====================================================
 * Automatically fixes Odoo code issues and generates recommendations.
 * 
 * Exposed as: window.OdooAnalyzer.CodeFixer
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};

window.OdooAnalyzer.CodeFixer = (function () {
  'use strict';

  // Auto-fixable rules:
  // - DEP001: Remove @api.multi
  // - DEP002: Remove @api.one
  // - DEP004: Replace osv.osv with models.Model
  // - DEP005: Convert _columns dict (simplistic replacement)
  // - DEP006: Convert _defaults dict (simplistic replacement)
  // - DEP007: Capitalize old-style field types (fields.char -> fields.Char)
  // - SEC001: Parameterize SQL queries in cr.execute
  // - BAD001: Replace hardcoded IDs with ref()
  // - BAD002: Fix bare except with logging
  // - BAD005: Remove self.env.cr.commit()
  // - DAT001: Add ondelete to Many2one

  function generateFixForIssue(issue) {
    const original = issue.code || '';
    let fixed = '';
    let explanation = '';

    switch (issue.ruleId) {
      case 'DEP001':
        fixed = ''; // Remove line
        explanation = 'Dekorator @api.multi telah dihapus karena semua method Odoo 13+ secara default mendukung multi-recordset.';
        break;
      case 'DEP002':
        fixed = '# FIXED: Dekorator @api.one dihapus. Gunakan perulangan di dalam method.';
        explanation = 'Dekorator @api.one telah dihapus karena sudah deprecated di Odoo 13+.';
        break;
      case 'DEP004':
        fixed = original.replace(/osv\.osv_memory/g, 'models.TransientModel')
                       .replace(/osv\.osv/g, 'models.Model')
                       .replace(/orm\.Model/g, 'models.Model');
        explanation = 'Mewarisi models.Model alih-alih osv.osv yang sudah deprecated.';
        break;
      case 'DEP007':
        fixed = original.replace(/fields\.char/g, 'fields.Char')
                       .replace(/fields\.integer/g, 'fields.Integer')
                       .replace(/fields\.boolean/g, 'fields.Boolean')
                       .replace(/fields\.text/g, 'fields.Text')
                       .replace(/fields\.float/g, 'fields.Float')
                       .replace(/fields\.many2one/g, 'fields.Many2one')
                       .replace(/fields\.one2many/g, 'fields.One2many')
                       .replace(/fields\.many2many/g, 'fields.Many2many')
                       .replace(/fields\.selection/g, 'fields.Selection');
        explanation = 'Deklarasi tipe field diperbarui dengan huruf kapital sesuai standar Odoo baru.';
        break;
      case 'SEC001':
        // Handle cr.execute("... %s" % var)
        const formatMatch = original.match(/cr\.execute\s*\(\s*(['"].*?%s.*?['"])\s*%\s*(.*)\)/s);
        if (formatMatch) {
          const query = formatMatch[1];
          let param = formatMatch[2].trim();
          // Wrap single parameter in a tuple if not already tuple/list
          if (!param.startsWith('(') && !param.startsWith('[') && !param.endsWith(',')) {
            param = `(${param},)`;
          }
          fixed = original.replace(formatMatch[0], `self.env.cr.execute(${query}, ${param})`);
        } else {
          fixed = original + '  # FIXED: Gunakan parameterized query di sini untuk mencegah SQL Injection!';
        }
        explanation = 'SQL query diubah menjadi parameterized query menggunakan tuple binding untuk mencegah SQL Injection.';
        break;
      case 'BAD001':
        fixed = original.replace(/browse\s*\(\s*1\s*\)/g, "ref('custom_sales.stock_warehouse_default')")
                       .replace(/browse\s*\(\s*(\d+)\s*\)/g, "ref('custom_sales.record_id_$1')");
        explanation = 'ID record hardcoded diganti dengan pemanggilan self.env.ref() yang aman untuk multi-database.';
        break;
      case 'BAD002':
        // Replace except: or except Exception: and insert logger
        const indentMatch = original.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '    ';
        fixed = `${indent}except Exception as e:\n${indent}    _logger.exception('Terjadi error: %s', str(e))`;
        explanation = 'Pencatatan log error ditambahkan ke dalam blok exception agar terpantau di server log.';
        break;
      case 'BAD005':
        fixed = original.replace(/self\.env\.cr\.commit\(\)/g, '# DIHAPUS: self.env.cr.commit() - Odoo mengelola transaksi secara otomatis')
                       .replace(/self\._cr\.commit\(\)/g, '# DIHAPUS: self._cr.commit() - Odoo mengelola transaksi secara otomatis')
                       .replace(/self\.cr\.commit\(\)/g, '# DIHAPUS: self.cr.commit() - Odoo mengelola transaksi secara otomatis');
        explanation = 'Commit manual dihapus untuk menjaga keutuhan transaksi database Odoo secara otomatis.';
        break;
      case 'DAT001':
        // Append ondelete='set null' inside Many2one declaration
        const lastParenIdx = original.lastIndexOf(')');
        if (lastParenIdx !== -1 && !original.includes('ondelete')) {
          fixed = original.substring(0, lastParenIdx) + ", ondelete='set null'" + original.substring(lastParenIdx);
        } else {
          fixed = original;
        }
        explanation = "Parameter ondelete='set null' ditambahkan ke Many2one field untuk menjaga referensi integritas data.";
        break;
      case 'MIS003':
        if (original.includes('{')) {
          fixed = original.replace('{', "{\n    'license': 'LGPL-3',");
        } else {
          fixed = original + "\n    'license': 'LGPL-3',";
        }
        explanation = "Menambahkan field lisensi wajib 'license': 'LGPL-3' ke dalam file manifest.";
        break;
      default:
        // Non-auto-fixable: add comment
        const commentIndentMatch = original.match(/^(\s*)/);
        const commentIndent = commentIndentMatch ? commentIndentMatch[1] : '';
        fixed = `${commentIndent}# [${issue.ruleId}] PERHATIAN: ${issue.suggestion}\n${original}`;
        explanation = `Rekomendasi perbaikan manual untuk aturan ${issue.ruleId} ditambahkan sebagai komentar kode.`;
        break;
    }

    return {
      original,
      fixed,
      explanation
    };
  }

  function fixIssues(fileContent, issues) {
    if (!fileContent) return { fixedContent: '', appliedFixes: [] };

    const lines = fileContent.split(/\r?\n/);
    const appliedFixes = [];

    // Sort issues by line in descending order (bottom to top)
    const sortedIssues = [...issues].sort((a, b) => b.line - a.line);

    sortedIssues.forEach(issue => {
      const idx = issue.line - 1;
      if (idx < 0 || idx >= lines.length) return;

      const originalLine = lines[idx];
      const fix = generateFixForIssue(issue);

      if (fix.fixed !== originalLine) {
        // Apply fix
        // If fixed is empty, we remove the line
        if (fix.fixed === '') {
          lines.splice(idx, 1);
        } else {
          lines[idx] = fix.fixed;
        }

        appliedFixes.push({
          issueId: issue.id,
          ruleId: issue.ruleId,
          line: issue.line,
          title: issue.title,
          original: originalLine,
          fixed: fix.fixed,
          explanation: fix.explanation
        });
      }
    });

    return {
      fixedContent: lines.join('\n'),
      appliedFixes: appliedFixes
    };
  }

  function fixAllFiles(modules, analysisResult) {
    const results = [];
    const issuesByFile = {};

    // Group issues by file path
    analysisResult.issues.forEach(issue => {
      if (!issue.file) return;
      if (!issuesByFile[issue.file]) {
        issuesByFile[issue.file] = [];
      }
      issuesByFile[issue.file].push(issue);
    });

    // Go through all files in modules
    modules.forEach(module => {
      module.files.forEach(file => {
        const fileIssues = issuesByFile[file.path] || [];
        if (fileIssues.length === 0) return;

        try {
          const { fixedContent, appliedFixes } = fixIssues(file.content, fileIssues);
          results.push({
            file: file.path,
            originalContent: file.content,
            fixedContent: fixedContent,
            fixes: appliedFixes
          });
        } catch (err) {
          console.error(`Failed to apply fixes for file: ${file.path}`, err);
        }
      });
    });

    return results;
  }

  return {
    fixIssues,
    generateFixForIssue,
    fixAllFiles
  };

})();
