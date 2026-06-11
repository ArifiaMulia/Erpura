/**
 * Odoo Code Analyzer - Parsers Module
 * ====================================
 * Comprehensive parser for Odoo source code files.
 * Handles Python models/fields/methods, XML views/actions/menus,
 * CSV access rights, and __manifest__.py / __openerp__.py files.
 *
 * Supports all Odoo versions from v4 (OpenERP) through v17+ (Odoo).
 *
 * Exports: parseFiles, parsePythonFile, parseXmlFile, parseCsvFile, parseManifest
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};
window.OdooAnalyzer.Parsers = (function () {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================

  /**
   * All known Odoo field types (case-insensitive matching will be used).
   * Keys are lowercase canonical names; values are the new-style PascalCase names.
   */
  const FIELD_TYPE_MAP = {
    'char': 'Char',
    'text': 'Text',
    'html': 'Html',
    'integer': 'Integer',
    'float': 'Float',
    'monetary': 'Monetary',
    'boolean': 'Boolean',
    'date': 'Date',
    'datetime': 'Datetime',
    'binary': 'Binary',
    'selection': 'Selection',
    'reference': 'Reference',
    'many2one': 'Many2one',
    'one2many': 'One2many',
    'many2many': 'Many2many',
    'id': 'Id',
    // Old-style names (lowercase)
    'char_utf8': 'Char',
    'text_wiki': 'Text',
    'float_time': 'Float',
    'related': 'Char', // old-style related maps to the target type
    'function': 'Char', // old-style function field
    'property': 'Char', // old-style property field
  };

  /**
   * Relational field types whose first positional argument is the comodel_name.
   */
  const RELATIONAL_TYPES = new Set(['many2one', 'one2many', 'many2many']);

  /**
   * Old-style Odoo base classes (v4–v8).
   */
  const OLD_STYLE_BASES = [
    'osv.osv',
    'osv.osv_memory',
    'osv.Model',
    'osv.TransientModel',
    'osv.AbstractModel',
    'orm.Model',
    'orm.TransientModel',
    'orm.AbstractModel',
    'orm.BaseModel',
  ];

  /**
   * New-style Odoo base classes (v9+).
   */
  const NEW_STYLE_BASES = [
    'models.Model',
    'models.TransientModel',
    'models.AbstractModel',
  ];

  /**
   * All recognized base class patterns for regex construction.
   */
  const ALL_BASES = [...OLD_STYLE_BASES, ...NEW_STYLE_BASES];

  /**
   * Known Odoo method decorators.
   */
  const KNOWN_DECORATORS = [
    'api.multi',
    'api.one',
    'api.depends',
    'api.onchange',
    'api.constrains',
    'api.model',
    'api.model_create_multi',
    'api.returns',
    'api.autovacuum',
    'api.readonly',
  ];

  // ============================================================
  // Utility helpers
  // ============================================================

  /**
   * Normalize a path to use forward slashes consistently.
   * @param {string} p - File path
   * @returns {string} Normalized path
   */
  function normalizePath(p) {
    return (p || '').replace(/\\/g, '/');
  }

  /**
   * Extract the directory portion of a file path.
   * @param {string} p - File path
   * @returns {string} Directory path
   */
  function dirName(p) {
    const normalized = normalizePath(p);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(0, idx) : '';
  }

  /**
   * Extract the file name from a path.
   * @param {string} p - File path
   * @returns {string} File name
   */
  function baseName(p) {
    const normalized = normalizePath(p);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(idx + 1) : normalized;
  }

  /**
   * Determine the file type from the file name.
   * @param {string} name - File name
   * @returns {'python'|'xml'|'csv'|'other'}
   */
  function classifyFile(name) {
    if (!name) return 'other';
    const lower = name.toLowerCase();
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.xml')) return 'xml';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.po')) return 'po';
    return 'other';
  }

  /**
   * Create a ParseError object.
   * @param {string} file - Source file path
   * @param {number|null} line - Line number (1-indexed) or null
   * @param {string} message - Error description
   * @param {string} type - Error type identifier
   * @returns {ParseError}
   */
  function makeError(file, line, message, type) {
    return { file: file || '', line: line, message: message, type: type || 'parse_error' };
  }

  /**
   * Safely trim whitespace and surrounding quotes from a string.
   * @param {string} s - Input string
   * @returns {string} Cleaned string
   */
  function trimQuotes(s) {
    if (!s) return '';
    s = s.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
    return s;
  }

  /**
   * Parse a Python boolean string into a JS boolean.
   * Handles True/False, 1/0, and string representations.
   * @param {string} val - Value string
   * @param {boolean} [defaultVal=false] - Default if unparseable
   * @returns {boolean}
   */
  function parsePyBool(val, defaultVal) {
    if (val === undefined || val === null) return defaultVal !== undefined ? defaultVal : false;
    const s = String(val).trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '' || s === 'none') return false;
    return defaultVal !== undefined ? defaultVal : false;
  }

  /**
   * Count leading whitespace characters in a string (spaces and tabs, where tab = 4 spaces).
   * @param {string} line - Source line
   * @returns {number} Indentation level in equivalent spaces
   */
  function getIndent(line) {
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ' ') {
        count++;
      } else if (line[i] === '\t') {
        count += 4;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Split content into lines, preserving original line endings for accurate line counting.
   * @param {string} content - File content
   * @returns {string[]} Array of lines
   */
  function splitLines(content) {
    if (!content) return [];
    return content.split(/\r?\n/);
  }

  /**
   * Helper function to find a field element by name attribute in an XML parent element.
   * @param {Element} parent - Parent XML element
   * @param {string} name - Field name attribute
   * @returns {Element|null} The field element or null
   */
  function findFieldByName(parent, name) {
    if (!parent) return null;
    const fields = parent.getElementsByTagName('field');
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].getAttribute('name') === name) {
        return fields[i];
      }
    }
    return null;
  }

  /**
   * Extract a balanced parenthesized substring starting from a given position.
   * Handles nested parentheses, string literals (single and double quotes), and escapes.
   * @param {string} text - Source text
   * @param {number} startIdx - Index of the opening parenthesis
   * @returns {string} Content between (and including) the outermost parentheses, or
   *                    partial content if unbalanced
   */
  function extractBalancedParens(text, startIdx) {
    if (text[startIdx] !== '(') return '';
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTripleSingle = false;
    let inTripleDouble = false;
    let i = startIdx;

    while (i < text.length) {
      const ch = text[i];
      const next2 = text.substring(i, i + 3);

      // Handle triple-quoted strings
      if (!inSingle && !inDouble) {
        if (!inTripleSingle && !inTripleDouble) {
          if (next2 === "'''") {
            inTripleSingle = true;
            i += 3;
            continue;
          }
          if (next2 === '"""') {
            inTripleDouble = true;
            i += 3;
            continue;
          }
        } else if (inTripleSingle && next2 === "'''") {
          inTripleSingle = false;
          i += 3;
          continue;
        } else if (inTripleDouble && next2 === '"""') {
          inTripleDouble = false;
          i += 3;
          continue;
        }
      }

      if (inTripleSingle || inTripleDouble) {
        i++;
        continue;
      }

      // Handle single/double quoted strings
      if (ch === '\\') {
        i += 2; // skip escaped character
        continue;
      }

      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        i++;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        i++;
        continue;
      }

      if (inSingle || inDouble) {
        i++;
        continue;
      }

      // Track parentheses depth
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          return text.substring(startIdx, i + 1);
        }
      }
      i++;
    }

    // Unbalanced - return what we have
    return text.substring(startIdx);
  }

  /**
   * Extract a balanced bracketed substring from text, starting at the opening bracket.
   * @param {string} text - Source text
   * @param {number} startIdx - Index of the opening bracket '['
   * @returns {string} Content between brackets
   */
  function extractBalancedBrackets(text, startIdx) {
    if (text[startIdx] !== '[') return '';
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let i = startIdx;

    while (i < text.length) {
      const ch = text[i];

      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        i++;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        i++;
        continue;
      }
      if (inSingle || inDouble) {
        i++;
        continue;
      }

      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return text.substring(startIdx, i + 1);
      }
      i++;
    }
    return text.substring(startIdx);
  }

  /**
   * Extract a balanced braces substring from text, starting at the opening brace.
   * @param {string} text - Source text
   * @param {number} startIdx - Index of the opening brace '{'
   * @returns {string} Content between braces
   */
  function extractBalancedBraces(text, startIdx) {
    if (text[startIdx] !== '{') return '';
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let i = startIdx;

    while (i < text.length) {
      const ch = text[i];

      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        i++;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        i++;
        continue;
      }
      if (inSingle || inDouble) {
        i++;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.substring(startIdx, i + 1);
      }
      i++;
    }
    return text.substring(startIdx);
  }

  /**
   * Parse Python-like key=value arguments from a string (inside parentheses content).
   * Returns an object of extracted keyword arguments.
   * Handles positional arguments, string values, booleans, numbers, and lists.
   * @param {string} argsStr - Arguments string (without outer parens)
   * @returns {{ positional: string[], kwargs: Object }}
   */
  function parseFieldArgs(argsStr) {
    const result = { positional: [], kwargs: {} };
    if (!argsStr || !argsStr.trim()) return result;

    // Tokenize by commas, respecting nested parens/brackets/braces/strings
    const tokens = splitByComma(argsStr);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (!token) continue;

      // Check for key=value
      const eqMatch = token.match(/^(\w+)\s*=\s*([\s\S]*)$/);
      if (eqMatch) {
        const key = eqMatch[1];
        let val = eqMatch[2].trim();
        result.kwargs[key] = interpretPyValue(val);
      } else {
        // Positional argument
        result.positional.push(interpretPyValue(token));
      }
    }

    return result;
  }

  /**
   * Split a string by commas, respecting nested delimiters and strings.
   * @param {string} s - Source string
   * @returns {string[]} Array of tokens
   */
  function splitByComma(s) {
    const tokens = [];
    let current = '';
    let depth = 0; // tracks () [] {} nesting
    let inSingle = false;
    let inDouble = false;
    let inTripleSingle = false;
    let inTripleDouble = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const next3 = s.substring(i, i + 3);

      // Triple-quoted strings
      if (!inSingle && !inDouble) {
        if (!inTripleSingle && !inTripleDouble) {
          if (next3 === "'''") {
            inTripleSingle = true;
            current += next3;
            i += 2;
            continue;
          }
          if (next3 === '"""') {
            inTripleDouble = true;
            current += next3;
            i += 2;
            continue;
          }
        } else if (inTripleSingle && next3 === "'''") {
          inTripleSingle = false;
          current += next3;
          i += 2;
          continue;
        } else if (inTripleDouble && next3 === '"""') {
          inTripleDouble = false;
          current += next3;
          i += 2;
          continue;
        }
      }

      if (inTripleSingle || inTripleDouble) {
        current += ch;
        continue;
      }

      // Escape sequences
      if (ch === '\\') {
        current += ch;
        if (i + 1 < s.length) {
          current += s[i + 1];
          i++;
        }
        continue;
      }

      // Single/double quote toggles
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        current += ch;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        current += ch;
        continue;
      }

      if (inSingle || inDouble) {
        current += ch;
        continue;
      }

      // Nesting
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        current += ch;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        current += ch;
        continue;
      }

      // Comma at top level
      if (ch === ',' && depth === 0) {
        tokens.push(current);
        current = '';
        continue;
      }

      current += ch;
    }

    if (current.trim()) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Interpret a Python value literal into a JS value.
   * Handles strings, booleans, None, numbers, lists (as strings), lambdas, etc.
   * @param {string} val - Python value string
   * @returns {*} Interpreted value
   */
  function interpretPyValue(val) {
    if (!val) return val;
    val = val.trim();

    // Boolean
    if (val === 'True') return true;
    if (val === 'False') return false;
    if (val === 'None') return null;

    // String (single or double quote)
    const strMatch = val.match(/^(['"])([\s\S]*)\1$/);
    if (strMatch) {
      return strMatch[2];
    }

    // Triple-quoted string
    const tripleMatch = val.match(/^(?:'''([\s\S]*)'''|"""([\s\S]*)""")$/);
    if (tripleMatch) {
      return tripleMatch[1] !== undefined ? tripleMatch[1] : tripleMatch[2];
    }

    // Number (int or float)
    if (/^-?\d+(\.\d+)?$/.test(val)) {
      return val.includes('.') ? parseFloat(val) : parseInt(val, 10);
    }

    // Return as raw string for complex expressions (lambdas, function calls, lists, etc.)
    return val;
  }

  /**
   * Extract all string values from a Python list literal.
   * E.g., "['base', 'sale']" → ['base', 'sale']
   * @param {string} listStr - Python list literal string
   * @returns {string[]} Array of string values
   */
  function parsePyStringList(listStr) {
    if (!listStr) return [];
    const trimmed = listStr.trim();

    // Handle bare string (not a list)
    const bareStr = trimmed.match(/^['"]([^'"]+)['"]$/);
    if (bareStr) return [bareStr[1]];

    // Remove brackets
    let inner = trimmed;
    if (inner.startsWith('[') && inner.endsWith(']')) {
      inner = inner.slice(1, -1);
    } else if (inner.startsWith('(') && inner.endsWith(')')) {
      inner = inner.slice(1, -1);
    }

    const items = [];
    const re = /['"]([^'"]*)['"]/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      items.push(m[1]);
    }
    return items;
  }

  /**
   * Parse a Python dict literal string into a plain JS object.
   * Handles string keys/values, boolean, numeric, and None values.
   * @param {string} dictStr - Python dict literal string, e.g. "{'key': 'value', ...}"
   * @returns {Object} Parsed key-value pairs
   */
  function parsePyDict(dictStr) {
    const result = {};
    if (!dictStr) return result;

    let inner = dictStr.trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      inner = inner.slice(1, -1);
    }

    // Match key-value pairs: 'key': value  or  "key": value
    const pairRe = /['"](\w+)['"]\s*:\s*/g;
    let match;
    while ((match = pairRe.exec(inner)) !== null) {
      const key = match[1];
      const afterColon = inner.substring(match.index + match[0].length).trim();

      // Determine the value
      if (afterColon.startsWith("'") || afterColon.startsWith('"')) {
        const quote = afterColon[0];
        const endQuote = afterColon.indexOf(quote, 1);
        if (endQuote > 0) {
          result[key] = afterColon.substring(1, endQuote);
        }
      } else if (afterColon.startsWith('True')) {
        result[key] = true;
      } else if (afterColon.startsWith('False')) {
        result[key] = false;
      } else if (afterColon.startsWith('None')) {
        result[key] = null;
      } else {
        // Try numeric
        const numMatch = afterColon.match(/^(-?\d+(?:\.\d+)?)/);
        if (numMatch) {
          result[key] = numMatch[1].includes('.') ? parseFloat(numMatch[1]) : parseInt(numMatch[1], 10);
        } else {
          // Grab until comma or end
          const commaIdx = afterColon.indexOf(',');
          result[key] = commaIdx >= 0 ? afterColon.substring(0, commaIdx).trim() : afterColon.trim();
        }
      }
    }

    return result;
  }

  /**
   * Parse selection list from a field definition.
   * Handles both inline list and reference to a variable/function.
   * @param {string} selStr - Selection argument string
   * @returns {Array<{value:string, label:string}>}
   */
  function parseSelectionList(selStr) {
    const states = [];
    if (!selStr) return states;

    // Match tuples like ('value', 'Label')
    const tupleRe = /\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g;
    let m;
    while ((m = tupleRe.exec(selStr)) !== null) {
      states.push({ value: m[1], label: m[2] });
    }
    return states;
  }


  // ============================================================
  // 1. parseFiles(fileEntries) → OdooModule[]
  // ============================================================

  /**
   * Group file entries by Odoo module directory and parse them into OdooModule objects.
   *
   * A module directory is identified by the presence of __manifest__.py or __openerp__.py.
   * Files are grouped by their closest ancestor module directory.
   *
   * @param {FileEntry[]} fileEntries - Array of { name, path, type, content }
   * @returns {OdooModule[]} Array of parsed Odoo modules
   */
  function parseFiles(fileEntries) {
    if (!fileEntries || fileEntries.length === 0) return [];

    const modules = [];
    const errors = [];

    try {
      // Step 1: Identify module roots (directories containing a manifest file)
      const moduleRoots = new Map(); // path → manifest FileEntry

      for (const entry of fileEntries) {
        const fileName = baseName(entry.path || entry.name || '');
        if (fileName === '__manifest__.py' || fileName === '__openerp__.py') {
          const moduleDir = dirName(normalizePath(entry.path || entry.name || ''));
          moduleRoots.set(moduleDir, entry);
        }
      }

      // If no manifest found, treat all files as belonging to a single unnamed module
      if (moduleRoots.size === 0) {
        const singleModule = buildModule('unknown_module', '', null, fileEntries);
        modules.push(singleModule);
        return modules;
      }

      // Step 2: Group files by their module directory
      // Sort module roots by path length descending so nested modules are matched first
      const sortedRoots = Array.from(moduleRoots.keys()).sort((a, b) => b.length - a.length);

      const moduleFiles = new Map(); // moduleDir → FileEntry[]
      for (const root of sortedRoots) {
        moduleFiles.set(root, []);
      }

      for (const entry of fileEntries) {
        const filePath = normalizePath(entry.path || entry.name || '');
        let assigned = false;

        for (const root of sortedRoots) {
          if (filePath.startsWith(root + '/') || filePath === root || dirName(filePath) === root) {
            moduleFiles.get(root).push(entry);
            assigned = true;
            break;
          }
        }

        // Files not belonging to any module are attached to the closest module root
        if (!assigned && sortedRoots.length > 0) {
          // Try to find a common ancestor
          for (const root of sortedRoots) {
            // Fallback: attach to the first module
            moduleFiles.get(root).push(entry);
            break;
          }
        }
      }

      // Step 3: Build each module
      for (const [moduleDir, manifestEntry] of moduleRoots) {
        const files = moduleFiles.get(moduleDir) || [];
        const moduleName = baseName(moduleDir) || 'unknown_module';

        try {
          const odooModule = buildModule(moduleName, moduleDir, manifestEntry, files);
          modules.push(odooModule);
        } catch (err) {
          errors.push(makeError(moduleDir, null, 'Failed to build module: ' + err.message, 'module_build_error'));
        }
      }
    } catch (outerErr) {
      errors.push(makeError('', null, 'Fatal error in parseFiles: ' + outerErr.message, 'fatal_error'));
    }

    // Attach global errors to the first module or create a dummy module
    if (errors.length > 0) {
      if (modules.length > 0) {
        modules[0].errors = modules[0].errors.concat(errors);
      } else {
        modules.push({
          name: 'parse_errors',
          path: '',
          manifest: createEmptyManifest(),
          models: [],
          views: [],
          actions: [],
          menus: [],
          security: { accessRights: [], recordRules: [] },
          files: fileEntries.map(normalizeFileEntry),
          errors: errors,
        });
      }
    }

    // Filter out empty modules if we have at least one non-empty module
    const nonEmptyModules = modules.filter(m => m.models.length > 0 || m.views.length > 0 || m.actions.length > 0 || m.menus.length > 0 || m.security.accessRights.length > 0 || (m.manifest && m.manifest.name));
    if (nonEmptyModules.length > 0) {
      return nonEmptyModules;
    }
    return modules;
  }

  /**
   * Build a single OdooModule from its files.
   * @param {string} moduleName - Module technical name
   * @param {string} moduleDir - Module directory path
   * @param {FileEntry|null} manifestEntry - Manifest file entry (if found)
   * @param {FileEntry[]} files - All files belonging to this module
   * @returns {OdooModule}
   */
  function buildModule(moduleName, moduleDir, manifestEntry, files) {
    const odooModule = {
      name: moduleName,
      path: moduleDir,
      manifest: createEmptyManifest(),
      models: [],
      views: [],
      actions: [],
      menus: [],
      security: { accessRights: [], recordRules: [] },
      files: [],
      errors: [],
    };

    // Parse manifest
    if (manifestEntry && manifestEntry.content) {
      try {
        odooModule.manifest = parseManifest(manifestEntry.content);
        // Ensure module name matches manifest 'name' if available
        if (odooModule.manifest.name) {
          // Keep technical name as module.name, manifest display name is manifest.name
        }
      } catch (err) {
        odooModule.errors.push(makeError(
          manifestEntry.path || manifestEntry.name,
          null,
          'Failed to parse manifest: ' + err.message,
          'manifest_error'
        ));
      }
    }

    // Process each file
    for (const entry of files) {
      const normalized = normalizeFileEntry(entry);
      odooModule.files.push(normalized);

      const fileType = normalized.type;
      const filePath = normalized.path;
      const content = normalized.content || '';

      if (!content) continue;

      try {
        if (fileType === 'python') {
          const pyResult = parsePythonFile(content, filePath);
          odooModule.models = odooModule.models.concat(pyResult.models || []);
          odooModule.errors = odooModule.errors.concat(pyResult.errors || []);
        } else if (fileType === 'xml') {
          const xmlResult = parseXmlFile(content, filePath);
          odooModule.views = odooModule.views.concat(xmlResult.views || []);
          odooModule.actions = odooModule.actions.concat(xmlResult.actions || []);
          odooModule.menus = odooModule.menus.concat(xmlResult.menus || []);
          if (xmlResult.recordRules) {
            odooModule.security.recordRules = odooModule.security.recordRules.concat(xmlResult.recordRules || []);
          }
          odooModule.errors = odooModule.errors.concat(xmlResult.errors || []);
        } else if (fileType === 'po') {
          const poResult = parsePoFile(content);
          const langName = filePath.split('/').pop().replace('.po', '');
          odooModule.translations = odooModule.translations || {};
          odooModule.translations[langName] = poResult;
        } else if (fileType === 'csv') {
          const csvResult = parseCsvFile(content, filePath);
          odooModule.security.accessRights = odooModule.security.accessRights.concat(csvResult.accessRights || []);
          odooModule.errors = odooModule.errors.concat(csvResult.errors || []);
        }
      } catch (err) {
        odooModule.errors.push(makeError(filePath, null, 'Unhandled parse error: ' + err.message, 'parse_error'));
      }
    }

    return odooModule;
  }

  /**
   * Normalize a file entry to ensure consistent structure.
   * @param {object} entry - Raw file entry
   * @returns {FileEntry}
   */
  function normalizeFileEntry(entry) {
    const path = normalizePath(entry.path || entry.name || '');
    const name = baseName(path);
    return {
      name: name,
      path: path,
      type: entry.type || classifyFile(name),
      content: entry.content || '',
    };
  }

  /**
   * Create an empty manifest object with default values.
   * @returns {object}
   */
  function createEmptyManifest() {
    return {
      name: '',
      version: '',
      summary: '',
      description: '',
      author: '',
      website: '',
      category: '',
      depends: [],
      data: [],
      demo: [],
      installable: true,
      application: false,
      auto_install: false,
      license: '',
      external_dependencies: {},
      images: [],
      css: [],
      qweb: [],
      assets: {},
    };
  }


  // ============================================================
  // 2. parsePythonFile(content, filePath) → { models:[], errors:[] }
  // ============================================================

  /**
   * Parse an Odoo Python source file to extract model definitions, fields, and methods.
   *
   * Supports all Odoo versions:
   * - Old-style (v4-v8): osv.osv, osv.osv_memory, orm.Model, _columns dict, _defaults dict
   * - New-style (v9+): models.Model, models.TransientModel, models.AbstractModel, fields.Type()
   *
   * @param {string} content - Python file content
   * @param {string} filePath - Path to the file (for error reporting)
   * @returns {{ models: OdooModel[], errors: ParseError[] }}
   */
  function parsePythonFile(content, filePath) {
    const models = [];
    const errors = [];

    if (!content || typeof content !== 'string') {
      return { models: models, errors: errors };
    }

    try {
      const lines = splitLines(content);

      // Detect Odoo version from imports
      const odooVersion = detectOdooVersion(content);

      // Find all class definitions that extend Odoo base classes
      const classBlocks = extractClassBlocks(lines, filePath);

      for (const classBlock of classBlocks) {
        try {
          const model = parseClassBlock(classBlock, lines, filePath, odooVersion);
          if (model) {
            models.push(model);
          }
        } catch (err) {
          errors.push(makeError(filePath, classBlock.startLine, 'Error parsing class "' + classBlock.className + '": ' + err.message, 'class_parse_error'));
        }
      }
    } catch (err) {
      errors.push(makeError(filePath, null, 'Error parsing Python file: ' + err.message, 'python_parse_error'));
    }

    return { models: models, errors: errors };
  }

  /**
   * Detect the Odoo version style from import statements.
   * @param {string} content - File content
   * @returns {string} 'old' for v4-v9 (openerp imports), 'new' for v10+ (odoo imports), 'unknown'
   */
  function detectOdooVersion(content) {
    // Check for old-style imports
    if (/(?:^|\n)\s*(?:from\s+openerp|import\s+openerp)/.test(content)) {
      return 'old';
    }
    // Check for new-style imports
    if (/(?:^|\n)\s*(?:from\s+odoo|import\s+odoo)/.test(content)) {
      return 'new';
    }
    return 'unknown';
  }

  /**
   * Extract class blocks from Python source lines.
   * Identifies classes that extend known Odoo base classes.
   * @param {string[]} lines - Source lines
   * @param {string} filePath - File path
   * @returns {Array<{className:string, bases:string, startLine:number, endLine:number, indent:number}>}
   */
  function extractClassBlocks(lines, filePath) {
    const blocks = [];

    // Build a regex that matches any Odoo base class
    // Escape dots in class names for regex
    const escapedBases = ALL_BASES.map(b => b.replace(/\./g, '\\.'));
    const basesPattern = escapedBases.join('|');
    const classRe = new RegExp('^([ \\t]*)class\\s+(\\w+)\\s*\\(([^)]*(?:' + basesPattern + ')[^)]*)\\)\\s*:', 'gm');

    const fullContent = lines.join('\n');
    let match;

    while ((match = classRe.exec(fullContent)) !== null) {
      const indent = match[1].length;
      const className = match[2];
      const bases = match[3].trim();

      // Calculate start line number (1-indexed)
      const textBefore = fullContent.substring(0, match.index);
      const startLine = textBefore.split('\n').length;

      // Find the end of the class block: next line at same or lesser indentation
      // (or end of file)
      let endLine = lines.length;
      for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        // Skip empty and comment-only lines
        if (line.trim() === '' || line.trim().startsWith('#')) continue;

        const lineIndent = getIndent(line);
        // A line at same or lesser indentation that is a class or top-level statement
        // signals the end of our class block
        if (lineIndent <= indent && i > startLine) {
          endLine = i; // exclusive
          break;
        }
      }

      blocks.push({
        className: className,
        bases: bases,
        startLine: startLine,
        endLine: endLine,
        indent: indent,
      });
    }

    return blocks;
  }

  /**
   * Parse a single class block into an OdooModel.
   * @param {object} classBlock - Class block descriptor
   * @param {string[]} lines - All file lines
   * @param {string} filePath - File path
   * @param {string} odooVersion - 'old', 'new', or 'unknown'
   * @returns {OdooModel|null}
   */
  function parseClassBlock(classBlock, lines, filePath, odooVersion) {
    const { className, bases, startLine, endLine, indent } = classBlock;

    // Extract the class body as text
    const bodyLines = lines.slice(startLine, endLine);
    const bodyText = bodyLines.join('\n');

    // Initialize model object
    const model = {
      name: '',
      className: className,
      inherit: [],
      inherits: {},
      description: '',
      order: '',
      recName: '',
      fields: [],
      methods: [],
      sqlConstraints: [],
      states: [],
      file: filePath,
      line: startLine,
      odooVersion: odooVersion,
    };

    // Extract _name
    const nameMatch = bodyText.match(/_name\s*=\s*['"]([^'"]+)['"]/);
    if (nameMatch) {
      model.name = nameMatch[1];
    }

    // Extract _inherit (single string or list)
    const inheritSingleMatch = bodyText.match(/_inherit\s*=\s*['"]([^'"]+)['"]/);
    const inheritListMatch = bodyText.match(/_inherit\s*=\s*\[([^\]]*)\]/);
    if (inheritListMatch) {
      model.inherit = parsePyStringList('[' + inheritListMatch[1] + ']');
    } else if (inheritSingleMatch) {
      model.inherit = [inheritSingleMatch[1]];
    }

    // If no _name but has _inherit (single), use the inherit name
    if (!model.name && model.inherit.length === 1) {
      model.name = model.inherit[0];
    }

    // If still no name, use the class name converted to dotted notation
    if (!model.name) {
      model.name = className.replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase();
    }

    // Extract _inherits (dict)
    const inheritsMatch = bodyText.match(/_inherits\s*=\s*(\{[^}]*\})/);
    if (inheritsMatch) {
      model.inherits = parsePyDict(inheritsMatch[1]);
    }

    // Extract _description
    const descMatch = bodyText.match(/_description\s*=\s*(['"])([\s\S]*?)\1/);
    if (descMatch) {
      model.description = descMatch[2];
    }

    // Extract _order
    const orderMatch = bodyText.match(/_order\s*=\s*['"]([^'"]+)['"]/);
    if (orderMatch) {
      model.order = orderMatch[1];
    }

    // Extract _rec_name
    const recNameMatch = bodyText.match(/_rec_name\s*=\s*['"]([^'"]+)['"]/);
    if (recNameMatch) {
      model.recName = recNameMatch[1];
    }

    // Extract _sql_constraints
    model.sqlConstraints = extractSqlConstraints(bodyText);

    // Extract fields (both old-style _columns and new-style)
    const oldFields = extractOldStyleFields(bodyText, filePath, startLine);
    const newFields = extractNewStyleFields(bodyLines, filePath, startLine);
    model.fields = oldFields.concat(newFields);

    // Extract _defaults (old-style) and merge into field definitions
    const defaults = extractDefaults(bodyText);
    if (Object.keys(defaults).length > 0) {
      for (const field of model.fields) {
        if (defaults.hasOwnProperty(field.name) && !field.params.default) {
          field.params.default = defaults[field.name];
        }
      }
    }

    // Extract states from selection fields named 'state' or 'status'
    for (const field of model.fields) {
      if ((field.name === 'state' || field.name === 'status') &&
          field.type.toLowerCase() === 'selection') {
        const sel = field.params.selection;
        if (typeof sel === 'string') {
          model.states = parseSelectionList(sel);
        } else if (Array.isArray(sel)) {
          model.states = sel;
        }
      }
    }

    // Extract methods
    model.methods = extractMethods(bodyLines, filePath, startLine, indent);

    return model;
  }

  /**
   * Extract _sql_constraints from class body text.
   * @param {string} bodyText - Class body
   * @returns {Array<{name:string, sql:string, message:string}>}
   */
  function extractSqlConstraints(bodyText) {
    const constraints = [];

    // Match _sql_constraints = [(...), (...)]
    const sqlMatch = bodyText.match(/_sql_constraints\s*=\s*\[/);
    if (!sqlMatch) return constraints;

    const startIdx = sqlMatch.index + sqlMatch[0].length - 1; // at '['
    const listStr = extractBalancedBrackets(bodyText, startIdx);
    if (!listStr) return constraints;

    // Match individual tuples: ('name', 'SQL', 'message')
    const tupleRe = /\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/g;
    let m;
    while ((m = tupleRe.exec(listStr)) !== null) {
      constraints.push({
        name: m[1],
        sql: m[2],
        message: m[3],
      });
    }

    return constraints;
  }

  /**
   * Extract old-style fields from _columns dict (v4-v8).
   * @param {string} bodyText - Class body text
   * @param {string} filePath - File path
   * @param {number} classStartLine - 1-indexed start line of the class
   * @returns {OdooField[]}
   */
  function extractOldStyleFields(bodyText, filePath, classStartLine) {
    const fields = [];

    // Find _columns = { ... }
    const colMatch = bodyText.match(/_columns\s*=\s*\{/);
    if (!colMatch) return fields;

    const braceStart = colMatch.index + colMatch[0].length - 1;
    const dictStr = extractBalancedBraces(bodyText, braceStart);
    if (!dictStr) return fields;

    // Calculate line offset for _columns block
    const textBeforeColumns = bodyText.substring(0, colMatch.index);
    const columnsLineOffset = textBeforeColumns.split('\n').length - 1;

    // Match field entries: 'field_name': fields.type(...)
    // The type in old-style uses lowercase: fields.char, fields.many2one, etc.
    const fieldRe = /['"](\w+)['"]\s*:\s*fields\.(\w+)\s*\(/g;
    let m;

    while ((m = fieldRe.exec(dictStr)) !== null) {
      const fieldName = m[1];
      const rawType = m[2].toLowerCase();
      const canonicalType = FIELD_TYPE_MAP[rawType] || rawType;

      // Extract the arguments inside the parentheses
      const parenStart = m.index + m[0].length - 1;
      const argsWithParens = extractBalancedParens(dictStr, parenStart);
      const argsStr = argsWithParens.slice(1, -1); // remove outer parens

      const parsed = parseFieldArgs(argsStr);
      const params = buildFieldParams(canonicalType, rawType, parsed);

      // Calculate approximate line number
      const textBeforeField = dictStr.substring(0, m.index);
      const fieldLineOffset = textBeforeField.split('\n').length - 1;
      const line = classStartLine + columnsLineOffset + fieldLineOffset;

      fields.push({
        name: fieldName,
        type: canonicalType,
        params: params,
        line: line,
      });
    }

    return fields;
  }

  /**
   * Extract new-style fields (v9+).
   * Pattern: field_name = fields.Type(...)
   * @param {string[]} bodyLines - Lines of the class body
   * @param {string} filePath - File path
   * @param {number} classStartLine - 1-indexed start line of the class
   * @returns {OdooField[]}
   */
  function extractNewStyleFields(bodyLines, filePath, classStartLine) {
    const fields = [];
    const bodyText = bodyLines.join('\n');

    // Match field definitions: name = fields.Type(...)
    // Must be indented (inside a class), not inside a method
    const fieldRe = /^([ \t]+)(\w+)\s*=\s*fields\.(\w+)\s*\(/gm;
    let m;

    while ((m = fieldRe.exec(bodyText)) !== null) {
      const fieldIndent = m[1].length;
      const fieldName = m[2];
      const rawType = m[3];
      const canonicalType = FIELD_TYPE_MAP[rawType.toLowerCase()] || rawType;

      // Make sure this is a class-level attribute, not inside a method
      // (typically indented 4 or 8 spaces for class body, not 8+ for method body)
      // We rely on standard indentation: class body is indent+4, method body is indent+8
      // Skip fields that are clearly inside method bodies (very deep indentation)
      // However, we can't be 100% sure without full AST, so we include fields at
      // reasonable class-body indentation levels (4-8 spaces typically)

      // Extract the full arguments (may span multiple lines)
      const parenStartIdx = m.index + m[0].length - 1;
      const argsWithParens = extractBalancedParens(bodyText, parenStartIdx);
      const argsStr = argsWithParens.slice(1, -1);

      const parsed = parseFieldArgs(argsStr);
      const params = buildFieldParams(canonicalType, rawType.toLowerCase(), parsed);

      // Calculate line number
      const textBefore = bodyText.substring(0, m.index);
      const lineOffset = textBefore.split('\n').length - 1;
      const line = classStartLine + lineOffset;

      fields.push({
        name: fieldName,
        type: canonicalType,
        params: params,
        line: line,
      });
    }

    return fields;
  }

  /**
   * Build a standardized field params object from parsed arguments.
   * @param {string} canonicalType - Canonical field type (e.g., 'Char', 'Many2one')
   * @param {string} rawType - Raw type name as written in source
   * @param {{ positional: any[], kwargs: Object }} parsed - Parsed field arguments
   * @returns {Object} Field parameters
   */
  function buildFieldParams(canonicalType, rawType, parsed) {
    const params = {};
    const kw = parsed.kwargs || {};
    const pos = parsed.positional || [];
    const lowerType = canonicalType.toLowerCase();

    // For relational fields, the first positional arg is comodel_name
    if (RELATIONAL_TYPES.has(lowerType) && pos.length > 0) {
      const comodel = typeof pos[0] === 'string' ? pos[0] : String(pos[0]);
      // Only set if it looks like a model name (contains dot or is a valid identifier)
      if (comodel && !comodel.startsWith('[') && !comodel.startsWith('{') && !comodel.startsWith('lambda')) {
        params.comodel_name = trimQuotes(comodel);
      }
    }

    // For One2many, the second positional arg is inverse_name
    if (lowerType === 'one2many' && pos.length > 1) {
      const inverseName = typeof pos[1] === 'string' ? pos[1] : String(pos[1]);
      if (inverseName && !inverseName.startsWith('[') && !inverseName.startsWith('{')) {
        params.inverse_name = trimQuotes(inverseName);
      }
    }

    // For non-relational fields, the first positional arg is often 'string' (old-style)
    if (!RELATIONAL_TYPES.has(lowerType) && pos.length > 0 && typeof pos[0] === 'string') {
      if (!kw.string) {
        params.string = pos[0];
      }
    }

    // For relational fields with a second positional that could be 'string' (old-style)
    if (RELATIONAL_TYPES.has(lowerType) && lowerType !== 'one2many' && pos.length > 1 && typeof pos[1] === 'string') {
      if (!kw.string) {
        params.string = pos[1];
      }
    }

    // Map all known keyword arguments
    const paramKeys = [
      'string', 'required', 'readonly', 'compute', 'inverse', 'search',
      'related', 'store', 'comodel_name', 'inverse_name', 'selection',
      'default', 'ondelete', 'tracking', 'copy', 'index', 'groups',
      'help', 'states', 'size', 'digits', 'translate', 'domain',
      'context', 'auto_join', 'delegate', 'track_visibility',
      'attachment', 'prefetch', 'company_dependent',
    ];

    for (const key of paramKeys) {
      if (kw.hasOwnProperty(key)) {
        // Don't override positionally-derived values
        if (!params.hasOwnProperty(key)) {
          params[key] = kw[key];
        } else if (key === 'comodel_name' || key === 'inverse_name') {
          // Keyword takes precedence for these
          params[key] = typeof kw[key] === 'string' ? kw[key] : String(kw[key]);
        }
      }
    }

    // For selection fields, also extract the selection list from the first positional
    if (lowerType === 'selection' && pos.length > 0 && !params.selection) {
      params.selection = String(pos[0]);
    }

    return params;
  }

  /**
   * Extract _defaults dict (old-style v4-v8).
   * @param {string} bodyText - Class body text
   * @returns {Object} Default values keyed by field name
   */
  function extractDefaults(bodyText) {
    const defaults = {};

    const defMatch = bodyText.match(/_defaults\s*=\s*\{/);
    if (!defMatch) return defaults;

    const braceStart = defMatch.index + defMatch[0].length - 1;
    const dictStr = extractBalancedBraces(bodyText, braceStart);
    if (!dictStr) return defaults;

    const inner = dictStr.slice(1, -1);

    // Match 'field_name': value patterns
    const pairRe = /['"](\w+)['"]\s*:\s*/g;
    let m;
    while ((m = pairRe.exec(inner)) !== null) {
      const key = m[1];
      const rest = inner.substring(m.index + m[0].length).trim();

      // Determine value
      if (rest.startsWith("'") || rest.startsWith('"')) {
        const quote = rest[0];
        const endQ = rest.indexOf(quote, 1);
        if (endQ > 0) {
          defaults[key] = rest.substring(1, endQ);
        }
      } else if (rest.startsWith('True')) {
        defaults[key] = true;
      } else if (rest.startsWith('False')) {
        defaults[key] = false;
      } else if (rest.startsWith('lambda')) {
        // Capture lambda until comma at depth 0 or end
        const commaIdx = findTopLevelComma(rest);
        defaults[key] = commaIdx >= 0 ? rest.substring(0, commaIdx).trim() : rest.trim();
      } else {
        const numMatch = rest.match(/^(-?\d+(?:\.\d+)?)/);
        if (numMatch) {
          defaults[key] = numMatch[1].includes('.') ? parseFloat(numMatch[1]) : parseInt(numMatch[1], 10);
        } else {
          const commaIdx = findTopLevelComma(rest);
          defaults[key] = commaIdx >= 0 ? rest.substring(0, commaIdx).trim() : rest.trim();
        }
      }
    }

    return defaults;
  }

  /**
   * Find the index of the first comma at depth 0 (outside nested structures).
   * @param {string} s - Source string
   * @returns {number} Index of comma or -1
   */
  function findTopLevelComma(s) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') { i++; continue; }
      if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (inSingle || inDouble) continue;
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
      if (ch === ',' && depth === 0) return i;
    }
    return -1;
  }

  /**
   * Extract methods from class body lines.
   * Detects method definitions, their decorators, parameters, body, and super() calls.
   * @param {string[]} bodyLines - Lines of the class body
   * @param {string} filePath - File path
   * @param {number} classStartLine - 1-indexed start line of the class
   * @param {number} classIndent - Indentation level of the class keyword
   * @returns {OdooMethod[]}
   */
  function extractMethods(bodyLines, filePath, classStartLine, classIndent) {
    const methods = [];
    const methodIndent = classIndent + 4; // expected indentation for methods

    // Accumulate decorators
    let pendingDecorators = [];
    let i = 0;

    while (i < bodyLines.length) {
      const line = bodyLines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        i++;
        continue;
      }

      const lineIndent = getIndent(line);

      // Check for decorator
      if (trimmed.startsWith('@') && lineIndent >= methodIndent && lineIndent < methodIndent + 4) {
        // Extract decorator name and arguments
        const decMatch = trimmed.match(/^@([\w.]+)(?:\(([^)]*)\))?/);
        if (decMatch) {
          let decorator = decMatch[1];
          if (decMatch[2] !== undefined) {
            decorator += '(' + decMatch[2] + ')';
          }
          pendingDecorators.push(decorator);
        }
        i++;
        continue;
      }

      // Check for method definition
      const defMatch = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*:/);
      if (defMatch && lineIndent >= methodIndent && lineIndent < methodIndent + 4) {
        const methodName = defMatch[1];
        const paramsStr = defMatch[2];
        const methodLine = classStartLine + i;

        // Parse parameters
        const params = paramsStr.split(',').map(p => p.trim()).filter(p => p.length > 0);

        // Collect body lines (everything until next def/class at same indentation or end)
        const bodyStartIdx = i + 1;
        let bodyEndIdx = bodyLines.length;
        const bodyIndent = lineIndent + 4;

        for (let j = bodyStartIdx; j < bodyLines.length; j++) {
          const bLine = bodyLines[j];
          const bTrimmed = bLine.trim();
          if (bTrimmed === '' || bTrimmed.startsWith('#')) continue;

          const bIndent = getIndent(bLine);
          if (bIndent <= lineIndent) {
            bodyEndIdx = j;
            break;
          }
        }

        const methodBodyLines = bodyLines.slice(bodyStartIdx, bodyEndIdx);
        const methodBody = methodBodyLines.join('\n');

        // Detect super() calls
        const hasSuper = /\bsuper\s*\(/.test(methodBody);

        methods.push({
          name: methodName,
          decorators: pendingDecorators.length > 0 ? pendingDecorators.slice() : [],
          params: params,
          body: methodBody,
          line: methodLine,
          hasSuper: hasSuper,
        });

        // Reset decorators
        pendingDecorators = [];
        i = bodyEndIdx;
        continue;
      }

      // If we encounter a non-decorator, non-def line, reset pending decorators
      // (unless it's at deeper indentation, which might be part of a multi-line decorator)
      if (!trimmed.startsWith('@') && lineIndent <= methodIndent) {
        pendingDecorators = [];
      }

      i++;
    }

    return methods;
  }


  // ============================================================
  // 3. parseXmlFile(content, filePath) → { views, actions, menus, recordRules, errors }
  // ============================================================

  /**
   * Parse an Odoo XML data file to extract views, actions, menus, and record rules.
   *
   * Uses DOMParser for robust XML parsing with fallback error handling.
   *
   * @param {string} content - XML file content
   * @param {string} filePath - File path for error reporting
   * @returns {{ views: OdooView[], actions: OdooAction[], menus: OdooMenu[], recordRules: RecordRule[], errors: ParseError[] }}
   */
  function parseXmlFile(content, filePath) {
    const result = {
      views: [],
      actions: [],
      menus: [],
      recordRules: [],
      errors: [],
    };

    if (!content || typeof content !== 'string') {
      return result;
    }

    try {
      // Parse XML using DOMParser
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/xml');

      // Check for XML parse errors
      const parseError = doc.getElementsByTagName('parsererror')[0];
      if (parseError) {
        result.errors.push(makeError(
          filePath,
          null,
          'XML parse error: ' + (parseError.textContent || '').substring(0, 200),
          'xml_parse_error'
        ));
      }

      // Find all <record> elements
      const records = doc.getElementsByTagName('record');
      for (let i = 0; i < records.length; i++) {
        try {
          processXmlRecord(records[i], filePath, result);
        } catch (err) {
          result.errors.push(makeError(
            filePath,
            null,
            'Error processing XML record: ' + err.message,
            'xml_record_error'
          ));
        }
      }

      // Find <menuitem> shortcut tags
      const menuItems = doc.getElementsByTagName('menuitem');
      for (let i = 0; i < menuItems.length; i++) {
        try {
          const menu = parseMenuItemTag(menuItems[i], filePath);
          if (menu) result.menus.push(menu);
        } catch (err) {
          result.errors.push(makeError(
            filePath,
            null,
            'Error processing menuitem tag: ' + err.message,
            'xml_menu_error'
          ));
        }
      }

      // Find <act_window> shortcut tags (older Odoo versions)
      const actWindows = doc.getElementsByTagName('act_window');
      for (let i = 0; i < actWindows.length; i++) {
        try {
          const action = parseActWindowTag(actWindows[i], filePath);
          if (action) result.actions.push(action);
        } catch (err) {
          result.errors.push(makeError(
            filePath,
            null,
            'Error processing act_window tag: ' + err.message,
            'xml_action_error'
          ));
        }
      }

      // Find <report> tags
      const reports = doc.getElementsByTagName('report');
      for (let i = 0; i < reports.length; i++) {
        try {
          const action = parseReportTag(reports[i], filePath);
          if (action) result.actions.push(action);
        } catch (err) {
          result.errors.push(makeError(
            filePath,
            null,
            'Error processing report tag: ' + err.message,
            'xml_report_error'
          ));
        }
      }

    } catch (err) {
      result.errors.push(makeError(filePath, null, 'Fatal XML parsing error: ' + err.message, 'xml_fatal_error'));
    }

    return result;
  }

  /**
   * Process a single <record> element and add the result to the appropriate array.
   * @param {Element} recordEl - DOM element for the <record>
   * @param {string} filePath - File path
   * @param {object} result - Accumulator { views, actions, menus, recordRules, errors }
   */
  function processXmlRecord(recordEl, filePath, result) {
    const model = recordEl.getAttribute('model') || '';
    const id = recordEl.getAttribute('id') || '';

    switch (model) {
      case 'ir.ui.view':
        result.views.push(parseViewRecord(recordEl, id, filePath));
        break;

      case 'ir.actions.act_window':
        result.actions.push(parseActionRecord(recordEl, id, filePath));
        break;

      case 'ir.actions.act_window.view':
        // View binding records - treat as actions for completeness
        result.actions.push(parseActionRecord(recordEl, id, filePath));
        break;

      case 'ir.actions.server':
      case 'ir.actions.client':
      case 'ir.actions.report.xml':
      case 'ir.actions.act_url':
        result.actions.push(parseActionRecord(recordEl, id, filePath));
        break;

      case 'ir.ui.menu':
        result.menus.push(parseMenuRecord(recordEl, id, filePath));
        break;

      case 'ir.rule':
        result.recordRules.push(parseRuleRecord(recordEl, id, filePath));
        break;

      default:
        // Other record types are ignored (data records, etc.)
        break;
    }
  }

  /**
   * Extract a field value from a <record> element by field name.
   * Handles both text content and common attributes (ref, eval, etc.).
   * @param {Element} recordEl - Parent <record> element
   * @param {string} fieldName - Name of the field to extract
   * @returns {string} Field value or empty string
   */
  function getFieldValue(recordEl, fieldName) {
    const fieldEl = findFieldByName(recordEl, fieldName);
    if (!fieldEl) return '';

    // Check for ref attribute (common for many2one references)
    const ref = fieldEl.getAttribute('ref');
    if (ref) return ref;

    // Check for eval attribute
    const evalAttr = fieldEl.getAttribute('eval');
    if (evalAttr) return evalAttr;

    // Check for type="xml" (arch content)
    const typeAttr = fieldEl.getAttribute('type');
    if (typeAttr === 'xml') {
      // Return inner XML as string
      const serializer = new XMLSerializer();
      let innerXml = '';
      for (let i = 0; i < fieldEl.childNodes.length; i++) {
        innerXml += serializer.serializeToString(fieldEl.childNodes[i]);
      }
      return innerXml;
    }

    // Return text content
    return fieldEl.textContent || '';
  }

  /**
   * Get the inner XML content of a field element.
   * @param {Element} recordEl - Parent <record> element
   * @param {string} fieldName - Field name
   * @returns {string} Inner XML string
   */
  function getFieldInnerXml(recordEl, fieldName) {
    const fieldEl = findFieldByName(recordEl, fieldName);
    if (!fieldEl) return '';

    const serializer = new XMLSerializer();
    let xml = '';
    for (let i = 0; i < fieldEl.childNodes.length; i++) {
      xml += serializer.serializeToString(fieldEl.childNodes[i]);
    }
    return xml;
  }

  /**
   * Parse a <record model="ir.ui.view"> into an OdooView.
   * @param {Element} recordEl - DOM element
   * @param {string} id - XML id
   * @param {string} filePath - File path
   * @returns {OdooView}
   */
  function parseViewRecord(recordEl, id, filePath) {
    const name = getFieldValue(recordEl, 'name');
    const model = getFieldValue(recordEl, 'model');
    const inheritId = getFieldValue(recordEl, 'inherit_id');
    const priorityStr = getFieldValue(recordEl, 'priority');
    const priority = priorityStr ? parseInt(priorityStr, 10) : 16;

    // Get arch content
    const archFieldEl = findFieldByName(recordEl, 'arch');
    let arch = '';
    let viewType = '';
    let archFields = [];

    if (archFieldEl) {
      // Determine view type from the root element of the arch
      const archChildren = [];
      for (let i = 0; i < archFieldEl.childNodes.length; i++) {
        if (archFieldEl.childNodes[i].nodeType === 1) {
          archChildren.push(archFieldEl.childNodes[i]);
        }
      }
      for (let i = 0; i < archChildren.length; i++) {
        const child = archChildren[i];
        const tagName = child.tagName ? child.tagName.toLowerCase() : '';
        if (tagName && ['form', 'tree', 'list', 'kanban', 'search', 'graph', 'pivot',
             'calendar', 'gantt', 'diagram', 'qweb', 'activity', 'cohort', 'map'].includes(tagName)) {
          viewType = tagName;
          break;
        }
        // For xpath, it's an inheritance view
        if (tagName === 'xpath' || tagName === 'data') {
          viewType = 'inherit';
        }
      }

      // Extract arch as XML string
      const serializer = new XMLSerializer();
      arch = '';
      for (let i = 0; i < archFieldEl.childNodes.length; i++) {
        arch += serializer.serializeToString(archFieldEl.childNodes[i]);
      }

      // Extract field references from arch
      archFields = extractFieldsFromArch(archFieldEl);
    }

    // If view type not determined from arch, try to infer from name
    if (!viewType && name) {
      const nameLower = name.toLowerCase();
      if (nameLower.includes('form')) viewType = 'form';
      else if (nameLower.includes('tree') || nameLower.includes('list')) viewType = 'tree';
      else if (nameLower.includes('kanban')) viewType = 'kanban';
      else if (nameLower.includes('search')) viewType = 'search';
      else if (nameLower.includes('graph')) viewType = 'graph';
      else if (nameLower.includes('pivot')) viewType = 'pivot';
      else if (nameLower.includes('calendar')) viewType = 'calendar';
    }

    return {
      id: id,
      name: name,
      model: model,
      type: viewType || 'unknown',
      inheritId: inheritId,
      priority: priority,
      arch: arch,
      fields: archFields,
      file: filePath,
    };
  }

  /**
   * Extract field name references from a view arch element.
   * Looks for <field name="..."> elements and name attributes in other elements.
   * @param {Element} archEl - The arch field DOM element
   * @returns {string[]} List of field names referenced
   */
  function extractFieldsFromArch(archEl) {
    const fieldNames = new Set();

    // Find all <field> elements
    const fieldEls = archEl.getElementsByTagName('field');
    for (let i = 0; i < fieldEls.length; i++) {
      const name = fieldEls[i].getAttribute('name');
      if (name) fieldNames.add(name);
    }

    // Also find field references in attrs, domain, etc. (basic pattern matching)
    const archStr = archEl.innerHTML || '';
    const attrFieldRe = /['"](\w+)['"]\s*(?:in|not in|=|!=|<|>|<=|>=)/g;
    let m;
    while ((m = attrFieldRe.exec(archStr)) !== null) {
      // Only add if it looks like a field name (lowercase with underscores)
      if (/^[a-z_]\w*$/.test(m[1])) {
        fieldNames.add(m[1]);
      }
    }

    return Array.from(fieldNames);
  }

  /**
   * Parse a <record model="ir.actions.act_window"> into an OdooAction.
   * @param {Element} recordEl - DOM element
   * @param {string} id - XML id
   * @param {string} filePath - File path
   * @returns {OdooAction}
   */
  function parseActionRecord(recordEl, id, filePath) {
    const name = getFieldValue(recordEl, 'name');
    const resModel = getFieldValue(recordEl, 'res_model');
    const viewMode = getFieldValue(recordEl, 'view_mode');
    const domain = getFieldValue(recordEl, 'domain');
    const context = getFieldValue(recordEl, 'context');
    const model = recordEl.getAttribute('model') || 'ir.actions.act_window';

    // Extract groups
    const groups = extractGroupsFromRecord(recordEl);

    return {
      id: id,
      name: name,
      model: resModel,
      type: model,
      viewMode: viewMode || 'tree,form',
      domain: domain,
      context: context,
      groups: groups,
      file: filePath,
    };
  }

  /**
   * Parse a <record model="ir.ui.menu"> into an OdooMenu.
   * @param {Element} recordEl - DOM element
   * @param {string} id - XML id
   * @param {string} filePath - File path
   * @returns {OdooMenu}
   */
  function parseMenuRecord(recordEl, id, filePath) {
    const name = getFieldValue(recordEl, 'name');
    const parent = getFieldValue(recordEl, 'parent_id');
    const action = getFieldValue(recordEl, 'action');
    const sequenceStr = getFieldValue(recordEl, 'sequence');
    const sequence = sequenceStr ? parseInt(sequenceStr, 10) : 10;
    const groups = extractGroupsFromRecord(recordEl);

    return {
      id: id,
      name: name,
      parent: parent,
      action: action,
      sequence: sequence,
      groups: groups,
      file: filePath,
    };
  }

  /**
   * Parse a <record model="ir.rule"> into a RecordRule.
   * @param {Element} recordEl - DOM element
   * @param {string} id - XML id
   * @param {string} filePath - File path
   * @returns {RecordRule}
   */
  function parseRuleRecord(recordEl, id, filePath) {
    const name = getFieldValue(recordEl, 'name');
    const modelId = getFieldValue(recordEl, 'model_id');
    const domainForce = getFieldValue(recordEl, 'domain_force');
    const groups = extractGroupsFromRecord(recordEl);

    // Permissions (default to true if not specified, per Odoo convention)
    const permRead = parsePyBool(getFieldValue(recordEl, 'perm_read'), true);
    const permWrite = parsePyBool(getFieldValue(recordEl, 'perm_write'), true);
    const permCreate = parsePyBool(getFieldValue(recordEl, 'perm_create'), true);
    const permUnlink = parsePyBool(getFieldValue(recordEl, 'perm_unlink'), true);

    return {
      id: id,
      name: name,
      modelId: modelId,
      domain: domainForce,
      groups: groups,
      permRead: permRead,
      permWrite: permWrite,
      permCreate: permCreate,
      permUnlink: permUnlink,
      file: filePath,
    };
  }

  /**
   * Extract group references from a <record> element.
   * Looks for field name="groups_id" with eval="[(4, ref('...'))]" or ref attributes.
   * @param {Element} recordEl - DOM element
   * @returns {string[]} Array of group XML IDs
   */
  function extractGroupsFromRecord(recordEl) {
    const groups = [];

    const groupsField = findFieldByName(recordEl, 'groups_id');
    if (!groupsField) return groups;

    const evalAttr = groupsField.getAttribute('eval');
    if (evalAttr) {
      // Parse eval expressions like [(4, ref('base.group_user'))]
      // or [(6, 0, [ref('base.group_user'), ref('base.group_manager')])]
      const refRe = /ref\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let m;
      while ((m = refRe.exec(evalAttr)) !== null) {
        groups.push(m[1]);
      }
    }

    // Also check for ref attribute
    const ref = groupsField.getAttribute('ref');
    if (ref) {
      groups.push(ref);
    }

    return groups;
  }

  /**
   * Parse a <menuitem> shortcut tag into an OdooMenu.
   * @param {Element} el - DOM element
   * @param {string} filePath - File path
   * @returns {OdooMenu}
   */
  function parseMenuItemTag(el, filePath) {
    const id = el.getAttribute('id') || '';
    const name = el.getAttribute('name') || '';
    const parent = el.getAttribute('parent') || '';
    const action = el.getAttribute('action') || '';
    const sequenceStr = el.getAttribute('sequence');
    const sequence = sequenceStr ? parseInt(sequenceStr, 10) : 10;
    const groupsAttr = el.getAttribute('groups') || '';

    // Parse groups from comma-separated string
    const groups = groupsAttr ? groupsAttr.split(',').map(g => g.trim()).filter(g => g) : [];

    // Also check for web_icon attribute (Odoo 10+)
    return {
      id: id,
      name: name,
      parent: parent,
      action: action,
      sequence: sequence,
      groups: groups,
      file: filePath,
    };
  }

  /**
   * Parse an <act_window> shortcut tag into an OdooAction.
   * (Used in older Odoo versions)
   * @param {Element} el - DOM element
   * @param {string} filePath - File path
   * @returns {OdooAction}
   */
  function parseActWindowTag(el, filePath) {
    const id = el.getAttribute('id') || '';
    const name = el.getAttribute('name') || '';
    const resModel = el.getAttribute('res_model') || '';
    const viewMode = el.getAttribute('view_mode') || 'tree,form';
    const domain = el.getAttribute('domain') || '';
    const context = el.getAttribute('context') || '';
    const groupsAttr = el.getAttribute('groups') || '';

    const groups = groupsAttr ? groupsAttr.split(',').map(g => g.trim()).filter(g => g) : [];

    return {
      id: id,
      name: name,
      model: resModel,
      type: 'ir.actions.act_window',
      viewMode: viewMode,
      domain: domain,
      context: context,
      groups: groups,
      file: filePath,
    };
  }

  /**
   * Parse a <report> tag into an OdooAction of type ir.actions.report.xml.
   * @param {Element} el - DOM element
   * @param {string} filePath - File path
   * @returns {OdooAction}
   */
  function parseReportTag(el, filePath) {
    const id = el.getAttribute('id') || '';
    const name = el.getAttribute('name') || el.getAttribute('string') || '';
    const model = el.getAttribute('model') || '';
    const reportType = el.getAttribute('report_type') || 'qweb-pdf';
    const groupsAttr = el.getAttribute('groups') || '';
    const groups = groupsAttr ? groupsAttr.split(',').map(g => g.trim()).filter(g => g) : [];

    return {
      id: id,
      name: name,
      model: model,
      type: 'ir.actions.report.xml',
      viewMode: reportType,
      domain: '',
      context: '',
      groups: groups,
      file: filePath,
    };
  }


  // ============================================================
  // 4. parseCsvFile(content, filePath) → { accessRights:[], errors:[] }
  // ============================================================

  /**
   * Parse an ir.model.access.csv file to extract access rights.
   *
   * Expected CSV format:
   * id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
   *
   * Handles:
   * - Quoted fields (with embedded commas)
   * - Empty group_id (public access)
   * - Boolean values: 0/1, True/False
   * - Comment lines starting with #
   * - BOM markers
   *
   * @param {string} content - CSV file content
   * @param {string} filePath - File path for error reporting
   * @returns {{ accessRights: AccessRight[], errors: ParseError[] }}
   */
  function parseCsvFile(content, filePath) {
    const accessRights = [];
    const errors = [];

    if (!content || typeof content !== 'string') {
      return { accessRights: accessRights, errors: errors };
    }

    try {
      // Remove BOM if present
      let cleaned = content;
      if (cleaned.charCodeAt(0) === 0xFEFF) {
        cleaned = cleaned.substring(1);
      }

      const lines = cleaned.split(/\r?\n/);

      // Determine if this is an access rights CSV by checking the filename or headers
      const fileName = baseName(filePath || '').toLowerCase();
      const isAccessFile = fileName.includes('ir.model.access') ||
                           fileName === 'ir_model_access.csv' ||
                           fileName.includes('access');

      if (!isAccessFile && lines.length > 0) {
        // Check header line for access-related columns
        const header = lines[0].toLowerCase();
        if (!header.includes('perm_read') && !header.includes('perm_write')) {
          // Not an access rights CSV, skip
          return { accessRights: accessRights, errors: errors };
        }
      }

      // Find the header line (first non-comment, non-empty line)
      let headerIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed && !trimmed.startsWith('#')) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx < 0) {
        return { accessRights: accessRights, errors: errors };
      }

      // Parse header to determine column positions
      const headerCols = parseCsvLine(lines[headerIdx]);
      const colMap = {};
      for (let i = 0; i < headerCols.length; i++) {
        colMap[headerCols[i].trim().toLowerCase()] = i;
      }

      // Map expected column names (handle variations)
      const idCol = colMap['id'] !== undefined ? colMap['id'] : -1;
      const nameCol = colMap['name'] !== undefined ? colMap['name'] : -1;
      const modelCol = colMap['model_id:id'] !== undefined ? colMap['model_id:id'] :
                       (colMap['model_id/id'] !== undefined ? colMap['model_id/id'] : -1);
      const groupCol = colMap['group_id:id'] !== undefined ? colMap['group_id:id'] :
                       (colMap['group_id/id'] !== undefined ? colMap['group_id/id'] : -1);
      const readCol = colMap['perm_read'] !== undefined ? colMap['perm_read'] : -1;
      const writeCol = colMap['perm_write'] !== undefined ? colMap['perm_write'] : -1;
      const createCol = colMap['perm_create'] !== undefined ? colMap['perm_create'] : -1;
      const unlinkCol = colMap['perm_unlink'] !== undefined ? colMap['perm_unlink'] : -1;

      // Parse data rows
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;

        try {
          const cols = parseCsvLine(line);

          const accessRight = {
            id: idCol >= 0 && cols[idCol] ? cols[idCol].trim() : '',
            name: nameCol >= 0 && cols[nameCol] ? cols[nameCol].trim() : '',
            modelId: modelCol >= 0 && cols[modelCol] ? cols[modelCol].trim() : '',
            groupId: groupCol >= 0 && cols[groupCol] ? cols[groupCol].trim() : '',
            permRead: readCol >= 0 ? parsePyBool(cols[readCol], false) : false,
            permWrite: writeCol >= 0 ? parsePyBool(cols[writeCol], false) : false,
            permCreate: createCol >= 0 ? parsePyBool(cols[createCol], false) : false,
            permUnlink: unlinkCol >= 0 ? parsePyBool(cols[unlinkCol], false) : false,
            file: filePath,
          };

          // Only add if we have at least an id or model
          if (accessRight.id || accessRight.modelId) {
            accessRights.push(accessRight);
          }
        } catch (lineErr) {
          errors.push(makeError(filePath, i + 1, 'Error parsing CSV line: ' + lineErr.message, 'csv_line_error'));
        }
      }
    } catch (err) {
      errors.push(makeError(filePath, null, 'Error parsing CSV file: ' + err.message, 'csv_parse_error'));
    }

    return { accessRights: accessRights, errors: errors };
  }

  /**
   * Parse a single CSV line, handling quoted fields.
   * @param {string} line - CSV line
   * @returns {string[]} Array of field values
   */
  function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      if (inQuotes) {
        if (ch === '"') {
          // Check for escaped quote (double quote)
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i += 2;
            continue;
          }
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
        current += ch;
        i++;
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        }
        if (ch === ',') {
          fields.push(current);
          current = '';
          i++;
          continue;
        }
        current += ch;
        i++;
      }
    }

    // Push the last field
    fields.push(current);

    return fields;
  }


  // ============================================================
  // 5. parseManifest(content) → manifest object
  // ============================================================

  /**
   * Parse an Odoo __manifest__.py (or __openerp__.py) file content.
   *
   * The manifest file contains a Python dict literal. This function extracts
   * key-value pairs using regex-based parsing.
   *
   * Handles:
   * - Single and double quoted strings
   * - Lists (e.g., depends: ['base', 'sale'])
   * - Booleans (True/False)
   * - Numeric values
   * - Multiline strings (triple-quoted)
   * - Nested dicts (for external_dependencies, assets)
   * - Comments
   *
   * @param {string} content - Manifest file content
   * @returns {object} Parsed manifest object
   */
  function parseManifest(content) {
    const manifest = createEmptyManifest();

    if (!content || typeof content !== 'string') {
      return manifest;
    }

    try {
      // Strip comments (lines starting with #, but not inside strings)
      // Simple approach: remove full-line comments first
      const lines = splitLines(content);
      const cleanedLines = [];
      for (const line of lines) {
        const trimmed = line.trim();
        // Keep non-comment lines and lines that are part of the dict
        if (!trimmed.startsWith('#')) {
          cleanedLines.push(line);
        }
      }
      let cleaned = cleanedLines.join('\n');

      // Find the main dict: look for the first { and its matching }
      const dictStart = cleaned.indexOf('{');
      if (dictStart < 0) {
        // No dict found - try to parse as a return statement
        return manifest;
      }
      const dictStr = extractBalancedBraces(cleaned, dictStart);
      if (!dictStr || dictStr.length < 2) {
        return manifest;
      }

      // Remove outer braces
      const inner = dictStr.slice(1, -1);

      // Extract key-value pairs
      // Pattern: 'key' : value  or  "key" : value
      // Value can be: string, list, dict, boolean, number, or multiline
      extractManifestEntries(inner, manifest);

    } catch (err) {
      // Return partial manifest on error
      console.warn('Manifest parse warning:', err.message);
    }

    return manifest;
  }

  /**
   * Extract manifest entries from the inner content of the manifest dict.
   * @param {string} inner - Content between the outer braces
   * @param {object} manifest - Manifest object to populate
   */
  function extractManifestEntries(inner, manifest) {
    // Tokenize the dict content into key-value pairs
    // We iterate through the string, finding 'key': value patterns

    let pos = 0;
    const len = inner.length;

    while (pos < len) {
      // Skip whitespace and commas
      while (pos < len && /[\s,]/.test(inner[pos])) pos++;
      if (pos >= len) break;

      // Expect a quoted key
      const keyQuote = inner[pos];
      if (keyQuote !== "'" && keyQuote !== '"') {
        // Skip non-key characters
        pos++;
        continue;
      }

      // Find end of key
      const keyEnd = inner.indexOf(keyQuote, pos + 1);
      if (keyEnd < 0) break;

      const key = inner.substring(pos + 1, keyEnd);
      pos = keyEnd + 1;

      // Skip whitespace and colon
      while (pos < len && /[\s]/.test(inner[pos])) pos++;
      if (pos < len && inner[pos] === ':') pos++;
      while (pos < len && /[\s]/.test(inner[pos])) pos++;
      if (pos >= len) break;

      // Extract value
      const valueResult = extractManifestValue(inner, pos);
      const value = valueResult.value;
      pos = valueResult.endPos;

      // Assign to manifest
      assignManifestKey(manifest, key, value);
    }
  }

  /**
   * Extract a Python value starting at the given position in the manifest inner string.
   * @param {string} text - Source text
   * @param {number} startPos - Start position
   * @returns {{ value: *, endPos: number }}
   */
  function extractManifestValue(text, startPos) {
    let pos = startPos;
    const len = text.length;

    if (pos >= len) return { value: '', endPos: pos };

    const ch = text[pos];

    // Triple-quoted string
    const next3 = text.substring(pos, pos + 3);
    if (next3 === "'''" || next3 === '"""') {
      const quote3 = next3;
      const endIdx = text.indexOf(quote3, pos + 3);
      if (endIdx >= 0) {
        const val = text.substring(pos + 3, endIdx);
        return { value: val, endPos: endIdx + 3 };
      }
      // Unclosed triple quote - take rest of string
      return { value: text.substring(pos + 3), endPos: len };
    }

    // Single/double quoted string
    if (ch === "'" || ch === '"') {
      let i = pos + 1;
      while (i < len) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          // Check for string concatenation: 'str1' 'str2' or 'str1' + 'str2'
          // (common in Python manifests for multiline strings without triple quotes)
          let endPos = i + 1;
          let fullStr = text.substring(pos + 1, i);

          // Look ahead for adjacent strings
          let lookAhead = endPos;
          while (lookAhead < len) {
            // Skip whitespace, newlines, and + operators
            while (lookAhead < len && /[\s+]/.test(text[lookAhead])) lookAhead++;
            if (lookAhead >= len) break;

            const nextCh = text[lookAhead];
            if (nextCh === "'" || nextCh === '"') {
              // Another string to concatenate
              let j = lookAhead + 1;
              while (j < len) {
                if (text[j] === '\\') { j += 2; continue; }
                if (text[j] === nextCh) {
                  fullStr += text.substring(lookAhead + 1, j);
                  endPos = j + 1;
                  lookAhead = j + 1;
                  break;
                }
                j++;
              }
              if (j >= len) break;
            } else {
              break;
            }
          }

          return { value: fullStr, endPos: endPos };
        }
        i++;
      }
      // Unclosed quote
      return { value: text.substring(pos + 1), endPos: len };
    }

    // List
    if (ch === '[') {
      const listStr = extractBalancedBrackets(text, pos);
      const items = parsePyStringList(listStr);
      return { value: items, endPos: pos + listStr.length };
    }

    // Dict
    if (ch === '{') {
      const dictStr = extractBalancedBraces(text, pos);
      // For nested dicts, try to parse them
      const parsed = parsePyDict(dictStr);
      return { value: parsed, endPos: pos + dictStr.length };
    }

    // Tuple (treated similarly to list for manifest purposes)
    if (ch === '(') {
      const tupleStr = extractBalancedParens(text, pos);
      const items = parsePyStringList(tupleStr);
      return { value: items, endPos: pos + tupleStr.length };
    }

    // Boolean or None
    if (text.substring(pos, pos + 4) === 'True') {
      return { value: true, endPos: pos + 4 };
    }
    if (text.substring(pos, pos + 5) === 'False') {
      return { value: false, endPos: pos + 5 };
    }
    if (text.substring(pos, pos + 4) === 'None') {
      return { value: null, endPos: pos + 4 };
    }

    // Number
    const numMatch = text.substring(pos).match(/^(-?\d+(?:\.\d+)?)/);
    if (numMatch) {
      const numStr = numMatch[1];
      const numVal = numStr.includes('.') ? parseFloat(numStr) : parseInt(numStr, 10);
      return { value: numVal, endPos: pos + numStr.length };
    }

    // Unknown value - skip until comma or end
    let endPos = pos;
    let depth = 0;
    while (endPos < len) {
      if (text[endPos] === '(' || text[endPos] === '[' || text[endPos] === '{') depth++;
      else if (text[endPos] === ')' || text[endPos] === ']' || text[endPos] === '}') depth--;
      if (depth === 0 && text[endPos] === ',') break;
      if (depth < 0) break;
      endPos++;
    }

    const rawVal = text.substring(pos, endPos).trim();
    return { value: rawVal, endPos: endPos };
  }

  /**
   * Assign a parsed value to the appropriate manifest key.
   * @param {object} manifest - Manifest object
   * @param {string} key - Manifest key name
   * @param {*} value - Parsed value
   */
  function assignManifestKey(manifest, key, value) {
    switch (key) {
      case 'name':
        manifest.name = String(value || '');
        break;
      case 'version':
        manifest.version = String(value || '');
        break;
      case 'summary':
        manifest.summary = String(value || '');
        break;
      case 'description':
        manifest.description = String(value || '');
        break;
      case 'author':
        manifest.author = String(value || '');
        break;
      case 'website':
        manifest.website = String(value || '');
        break;
      case 'category':
        manifest.category = String(value || '');
        break;
      case 'license':
        manifest.license = String(value || '');
        break;
      case 'depends':
        manifest.depends = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'data':
        manifest.data = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'demo':
        manifest.demo = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'installable':
        manifest.installable = value === true || value === 'True' || value === 1;
        break;
      case 'application':
        manifest.application = value === true || value === 'True' || value === 1;
        break;
      case 'auto_install':
        manifest.auto_install = value === true || value === 'True' || value === 1;
        break;
      case 'external_dependencies':
        manifest.external_dependencies = (typeof value === 'object' && value !== null) ? value : {};
        break;
      case 'images':
        manifest.images = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'css':
        manifest.css = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'qweb':
        manifest.qweb = Array.isArray(value) ? value : (value ? [String(value)] : []);
        break;
      case 'assets':
        manifest.assets = (typeof value === 'object' && value !== null) ? value : {};
        break;
      default:
        // Store any additional keys directly
        manifest[key] = value;
        break;
    }
  }

  /**
   * Parse a GNU gettext PO file content into a key-value dictionary.
   * @param {string} content - PO file content
   * @returns {Object} Dictionary msgid -> msgstr
   */
  function parsePoFile(content) {
    const translations = {};
    if (!content) return translations;
    const lines = content.split(/\r?\n/);
    let currentMsgid = null;
    
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('#')) continue; // Skip comments
      
      if (line.startsWith('msgid')) {
        const match = line.match(/^msgid\s+["'](.*)["']$/);
        if (match) {
          currentMsgid = match[1];
        }
      } else if (line.startsWith('msgstr') && currentMsgid !== null) {
        const match = line.match(/^msgstr\s+["'](.*)["']$/);
        if (match) {
          const val = match[1];
          if (val) {
            translations[currentMsgid] = val;
          }
          currentMsgid = null;
        }
      }
    }
    return translations;
  }


  // ============================================================
  // Public API
  // ============================================================

  return {
    parseFiles: parseFiles,
    parsePythonFile: parsePythonFile,
    parseXmlFile: parseXmlFile,
    parseCsvFile: parseCsvFile,
    parseManifest: parseManifest,
    parsePoFile: parsePoFile,
  };

})();
