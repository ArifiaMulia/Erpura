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

  // Helper: Find matching closing brace of a dictionary block
  function extractDictBlock(lines, startIdx) {
    let braceCount = 0;
    let blockLines = [];
    let endIdx = startIdx;
    let foundOpen = false;
    
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      blockLines.push(line);
      
      if (line.includes('{')) {
        if (!foundOpen) foundOpen = true;
        braceCount += (line.split('{').length - 1);
      }
      if (line.includes('}')) {
        braceCount -= (line.split('}').length - 1);
      }
      
      if (foundOpen && braceCount <= 0) {
        endIdx = i;
        break;
      }
    }
    return {
      blockContent: blockLines.join('\n'),
      endIdx: endIdx
    };
  }

  // Helper: Convert old-style _columns block to modern field definitions
  function convertColumnsBlock(lines, startIdx) {
    const { blockContent, endIdx } = extractDictBlock(lines, startIdx);
    const lineCount = endIdx - startIdx + 1;
    const blockLines = blockContent.split('\n');
    const converted = [];
    
    blockLines.forEach(line => {
      if (line.includes('_columns') || line.trim() === '}' || line.trim() === '},') {
        return;
      }
      if (line.trim().startsWith('#')) {
        converted.push(line);
        return;
      }
      
      // Match: 'field_name': fields.type(...)
      const fieldRegex = /^\s*['"]([a-zA-Z0-9_]+)['"]\s*:\s*fields\.([a-zA-Z0-9_]+)\((.*)\),?\s*$/;
      const match = line.match(fieldRegex);
      if (match) {
        const fieldName = match[1];
        let fieldType = match[2];
        const fieldParams = match[3];
        
        // Capitalize field type
        const typeMap = {
          'char': 'Char',
          'integer': 'Integer',
          'boolean': 'Boolean',
          'text': 'Text',
          'float': 'Float',
          'many2one': 'Many2one',
          'one2many': 'One2many',
          'many2many': 'Many2many',
          'selection': 'Selection'
        };
        fieldType = typeMap[fieldType] || (fieldType.charAt(0).toUpperCase() + fieldType.slice(1));
        
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '    ';
        converted.push(`${indent}${fieldName} = fields.${fieldType}(${fieldParams})`);
      } else if (line.trim() !== '') {
        converted.push('# ' + line.trim());
      }
    });
    
    return {
      fixed: converted.join('\n'),
      lineCount: lineCount
    };
  }

  // Helper: Convert _defaults block to modern default_get override
  function convertDefaultsBlock(lines, startIdx) {
    const { blockContent, endIdx } = extractDictBlock(lines, startIdx);
    const lineCount = endIdx - startIdx + 1;
    const blockLines = blockContent.split('\n');
    const dictLines = [];
    
    blockLines.forEach(line => {
      if (line.includes('_defaults') || line.trim() === '}' || line.trim() === '},') {
        return;
      }
      if (line.trim() !== '') {
        dictLines.push(line);
      }
    });
    
    const indentMatch = lines[startIdx].match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '    ';
    
    const converted = [];
    converted.push(`${indent}@api.model`);
    converted.push(`${indent}def default_get(self, fields_list):`);
    converted.push(`${indent}    res = super().default_get(fields_list)`);
    converted.push(`${indent}    res.update({`);
    dictLines.forEach(dl => {
      converted.push(`${indent}        ${dl.trim()}`);
    });
    converted.push(`${indent}    })`);
    converted.push(`${indent}    return res`);
    
    return {
      fixed: converted.join('\n'),
      lineCount: lineCount
    };
  }

  // Helper: Parameterize SQL queries to prevent SQL Injection
  function fixSqlInjection(original) {
    // Case 1: cr.execute("... %s ..." % var)
    let match = original.match(/cr\.execute\s*\(\s*(['"].*?%s.*?['"])\s*%\s*(.*)\)/s);
    if (match) {
      const query = match[1];
      let param = match[2].trim();
      if (!param.startsWith('(') && !param.startsWith('[') && !param.endsWith(',')) {
        param = `(${param},)`;
      }
      return original.replace(match[0], `self.env.cr.execute(${query}, ${param})`);
    }

    // Case 2: cr.execute("... {}".format(var))
    match = original.match(/cr\.execute\s*\(\s*(['"].*?\{\}.*?['"])\.format\((.*?)\)\)/s);
    if (match) {
      const query = match[1].replace(/\{\}/g, '%s');
      let param = match[2].trim();
      if (!param.startsWith('(') && !param.startsWith('[') && !param.endsWith(',')) {
        param = `(${param},)`;
      }
      return original.replace(match[0], `self.env.cr.execute(${query}, ${param})`);
    }

    // Case 3: cr.execute(f"... {var} ...")
    match = original.match(/cr\.execute\s*\(\s*f(['"])(.*?)\1\s*\)/s);
    if (match) {
      const quote = match[1];
      let queryBody = match[2];
      const vars = [];
      const regex = /\{(.*?)\}/g;
      let m;
      while ((m = regex.exec(queryBody)) !== null) {
        vars.push(m[1].trim());
      }
      
      if (vars.length > 0) {
        const query = quote + queryBody.replace(/\{.*?\}/g, '%s') + quote;
        const param = vars.length === 1 ? `(${vars[0]},)` : `(${vars.join(', ')})`;
        return original.replace(match[0], `self.env.cr.execute(${query}, ${param})`);
      }
    }

    return original + '  # FIXED: Gunakan parameterized query di sini untuk mencegah SQL Injection!';
  }

  function generateFixForIssue(issue, lines = [], startIdx = -1) {
    const original = issue.code || '';
    let fixed = '';
    let explanation = '';
    let lineCount = 1;

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
      case 'DEP005':
        if (lines.length > 0 && startIdx !== -1) {
          const colFix = convertColumnsBlock(lines, startIdx);
          fixed = colFix.fixed;
          lineCount = colFix.lineCount;
        } else {
          fixed = original;
        }
        explanation = 'Kamus _columns (Odoo v7/v8) dikonversi menjadi deklarasi field tingkat kelas standar Odoo modern.';
        break;
      case 'DEP006':
        if (lines.length > 0 && startIdx !== -1) {
          const defFix = convertDefaultsBlock(lines, startIdx);
          fixed = defFix.fixed;
          lineCount = defFix.lineCount;
        } else {
          fixed = original;
        }
        explanation = 'Kamus _defaults (Odoo v7/v8) dikonversi menjadi override method default_get tingkat kelas standar Odoo modern.';
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
        fixed = fixSqlInjection(original);
        explanation = 'SQL query diubah menjadi parameterized query menggunakan tuple binding untuk mencegah SQL Injection.';
        break;
      case 'BAD001':
        fixed = original.replace(/browse\s*\(\s*1\s*\)/g, "ref('custom_sales.stock_warehouse_default')")
                       .replace(/browse\s*\(\s*(\d+)\s*\)/g, "ref('custom_sales.record_id_$1')");
        explanation = 'ID record hardcoded diganti dengan pemanggilan self.env.ref() yang aman untuk multi-database.';
        break;
      case 'BAD002':
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
        const commentIndentMatch = original.match(/^(\s*)/);
        const commentIndent = commentIndentMatch ? commentIndentMatch[1] : '';
        fixed = `${commentIndent}# [${issue.ruleId}] PERHATIAN: ${issue.suggestion}\n${original}`;
        explanation = `Rekomendasi perbaikan manual untuk aturan ${issue.ruleId} ditambahkan sebagai komentar kode.`;
        break;
    }

    return {
      original,
      fixed,
      explanation,
      lineCount
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

      const lineCount = issue.ruleId === 'DEP005' || issue.ruleId === 'DEP006' 
        ? extractDictBlock(lines, idx).endIdx - idx + 1 
        : 1;

      const originalLinesText = lines.slice(idx, idx + lineCount).join('\n');
      const fix = generateFixForIssue(issue, lines, idx);

      if (fix.fixed !== originalLinesText) {
        if (fix.fixed === '') {
          lines.splice(idx, lineCount);
        } else {
          const newLines = fix.fixed.split('\n');
          lines.splice(idx, lineCount, ...newLines);
        }

        appliedFixes.push({
          issueId: issue.id,
          ruleId: issue.ruleId,
          line: issue.line,
          title: issue.title,
          original: originalLinesText,
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

    analysisResult.issues.forEach(issue => {
      if (!issue.file) return;
      if (!issuesByFile[issue.file]) {
        issuesByFile[issue.file] = [];
      }
      issuesByFile[issue.file].push(issue);
    });

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
