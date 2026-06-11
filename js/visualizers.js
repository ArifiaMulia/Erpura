/**
 * Odoo Code Analyzer - Visualizers Module
 * ========================================
 * Generates Mermaid diagrams and formatted HTML reports for analysis results.
 * All report text is in Indonesian for non-technical stakeholders;
 * technical terms (model names, field names, method names) remain in English.
 *
 * Exposed as: window.OdooAnalyzer.Visualizers
 *
 * Public API:
 *   - generateERDiagram(models, relationships)
 *   - generateStateDiagram(businessFlow)
 *   - generateFlowchart(businessFlow)
 *   - generateMenuTree(menus)
 *   - generateModelClassDiagram(model)
 *   - renderDiagram(containerId, mermaidCode)
 *   - generateFullReport(analysisResult)
 */

window.OdooAnalyzer = window.OdooAnalyzer || {};
window.OdooAnalyzer.Visualizers = (function () {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================

  /** Maximum number of fields displayed per model in ER diagrams */
  const MAX_FIELDS_PER_MODEL = 8;

  /** Mermaid initialization config with dark theme colors */
  const MERMAID_CONFIG = {
    theme: 'dark',
    themeVariables: {
      primaryColor: '#7c5cfc',
      primaryTextColor: '#e8e8f0',
      primaryBorderColor: '#9d8afc',
      lineColor: '#00d4aa',
      secondaryColor: '#1a1a3e',
      tertiaryColor: '#12122a'
    }
  };

  /** Counter for generating unique Mermaid render element IDs */
  let _renderCounter = 0;

  // ============================================================
  // Helper: sanitizeLabel(text)
  // ============================================================

  /**
   * Escape special Mermaid characters in labels so they render safely.
   * Replaces parentheses, brackets, quotes, pipes, and braces with
   * visually similar but safe Unicode/ASCII alternatives, then wraps
   * the result in double-quotes if any special characters remain.
   *
   * @param {string} text - Raw label text.
   * @returns {string} Sanitized label safe for Mermaid syntax.
   */
  function sanitizeLabel(text) {
    if (text == null) return '""';
    let s = String(text);
    if (s.length === 0) return '""';

    // Replace characters that conflict with Mermaid syntax
    s = s
      .replace(/\(/g, '❨')   // left parenthesis  → fullwidth
      .replace(/\)/g, '❩')   // right parenthesis → fullwidth
      .replace(/\[/g, '⦋')   // left bracket  → math bracket
      .replace(/\]/g, '⦌')   // right bracket → math bracket
      .replace(/\{/g, '❴')   // left brace  → ornamental
      .replace(/\}/g, '❵')   // right brace → ornamental
      .replace(/"/g, "'")     // double quotes → single quotes
      .replace(/\|/g, '¦');   // pipe → broken bar

    // If the string still has characters that might trip up Mermaid,
    // wrap it in quotes for safety.
    if (/[#;:&<>!@%^~`\\]/.test(s) || /\s/.test(s)) {
      return `"${s}"`;
    }
    return s;
  }

  // ============================================================
  // Helper: mapFieldType
  // ============================================================

  /**
   * Map an Odoo field type string to a Mermaid-compatible simple type.
   *
   * @param {string} odooType - e.g. 'Char', 'Many2one', 'Float', etc.
   * @returns {string} Simple type string for diagrams.
   */
  function mapFieldType(odooType) {
    if (!odooType) return 'string';
    const t = odooType.toLowerCase();
    const mapping = {
      char: 'string',
      text: 'string',
      html: 'string',
      selection: 'string',
      integer: 'int',
      float: 'float',
      monetary: 'float',
      boolean: 'bool',
      date: 'date',
      datetime: 'datetime',
      binary: 'binary',
      many2one: 'fk',
      one2many: 'list',
      many2many: 'list',
      reference: 'ref'
    };
    return mapping[t] || 'string';
  }

  // ============================================================
  // Helper: modelNameToMermaid
  // ============================================================

  /**
   * Convert an Odoo model name (dotted) to a Mermaid-safe identifier
   * by replacing dots with underscores and converting to uppercase.
   *
   * @param {string} name - e.g. 'sale.order.line'
   * @returns {string} e.g. 'SALE_ORDER_LINE'
   */
  function modelNameToMermaid(name) {
    if (!name) return 'UNKNOWN';
    return name.replace(/\./g, '_').toUpperCase();
  }

  // ============================================================
  // Helper: escapeHtml
  // ============================================================

  /**
   * Escape HTML special characters for safe embedding in report HTML.
   *
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // generateERDiagram(models, relationships)
  // ============================================================

  /**
   * Generate a Mermaid erDiagram string showing models and their relationships.
   *
   * @param {Array<{name:string, fields:Array<{name:string, type:string, relation?:string}>}>} models
   * @param {Array<{from:string, to:string, type:string, field:string}>} relationships
   * @returns {string} Mermaid erDiagram code.
   */
  function generateERDiagram(models, relationships) {
    const safeModels = Array.isArray(models) ? models : [];
    const safeRels = Array.isArray(relationships) ? relationships : [];

    const lines = ['erDiagram'];

    // --- Render each model as an entity with its key fields ---
    safeModels.forEach(model => {
      if (!model || !model.name) return;

      const mId = modelNameToMermaid(model.name);
      const fields = Array.isArray(model.fields) ? model.fields : [];

      // Take up to MAX_FIELDS_PER_MODEL fields for readability
      const displayFields = fields.slice(0, MAX_FIELDS_PER_MODEL);

      if (displayFields.length === 0) {
        // Entity with no fields – still declare it so relationships can link
        lines.push(`    ${mId} {`);
        lines.push(`        string id`);
        lines.push(`    }`);
      } else {
        lines.push(`    ${mId} {`);
        displayFields.forEach(field => {
          const fType = mapFieldType(field.type);
          const fName = (field.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
          lines.push(`        ${fType} ${fName}`);
        });
        lines.push(`    }`);
      }
    });

    // --- Render relationships ---
    // Mermaid ER relationship notation:
    //   many2one  → }o--||   (many side to one side)
    //   one2many  → ||--o{   (one side to many side)
    //   many2many → }o--o{   (many to many)
    safeRels.forEach(rel => {
      if (!rel || !rel.from || !rel.to) return;

      const fromId = modelNameToMermaid(rel.from);
      const toId = modelNameToMermaid(rel.to);
      const label = sanitizeLabel(rel.field || rel.type || '');

      let arrow;
      switch (rel.type) {
        case 'many2one':
          arrow = '}o--||';
          break;
        case 'one2many':
          arrow = '||--o{';
          break;
        case 'many2many':
          arrow = '}o--o{';
          break;
        default:
          arrow = '||--||';
      }

      lines.push(`    ${fromId} ${arrow} ${toId} : ${label}`);
    });

    return lines.join('\n');
  }

  // ============================================================
  // generateStateDiagram(businessFlow)
  // ============================================================

  /**
   * Generate a Mermaid stateDiagram-v2 for a model's state machine.
   *
   * States are colour-coded via notes:
   *   draft / new → gray, active / confirmed / open → blue,
   *   done / paid → green, cancel / refused → red.
   *
   * @param {{modelName:string, states:Array<{value:string, label:string}>, transitions:Array<{from:string, to:string, method?:string, label?:string}>}} businessFlow
   * @returns {string} Mermaid stateDiagram-v2 code.
   */
  function generateStateDiagram(businessFlow) {
    if (!businessFlow) return 'stateDiagram-v2\n    [*] --> empty : No data';

    const states = Array.isArray(businessFlow.states) ? businessFlow.states : [];
    const transitions = Array.isArray(businessFlow.transitions) ? businessFlow.transitions : [];
    const modelName = businessFlow.modelName || businessFlow.model || 'Unknown Model';

    const lines = ['stateDiagram-v2'];

    // Add a title note
    lines.push(`    %% State diagram for ${modelName}`);

    // --- Declare states with descriptions ---
    states.forEach(state => {
      if (!state || !state.value) return;
      const id = state.value.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = state.label || state.value;
      lines.push(`    ${id} : ${label}`);
    });

    // --- Colour-code states via classDef and class assignments ---
    const stateCategories = {
      draft: [], new: [],
      active: [], confirmed: [], open: [], sent: [], progress: [],
      done: [], paid: [], posted: [],
      cancel: [], cancelled: [], refused: [], rejected: []
    };

    states.forEach(state => {
      if (!state || !state.value) return;
      const v = state.value.toLowerCase();
      const id = state.value.replace(/[^a-zA-Z0-9_]/g, '_');
      if (v === 'draft' || v === 'new') stateCategories.draft.push(id);
      else if (['active', 'confirmed', 'open', 'sent', 'progress', 'in_progress', 'sale'].includes(v)) stateCategories.active.push(id);
      else if (['done', 'paid', 'posted', 'completed'].includes(v)) stateCategories.done.push(id);
      else if (['cancel', 'cancelled', 'refused', 'rejected'].includes(v)) stateCategories.cancel.push(id);
    });

    // classDef entries
    lines.push('');
    lines.push('    classDef draftStyle fill:#6b7280,stroke:#9ca3af,color:#f3f4f6');
    lines.push('    classDef activeStyle fill:#3b82f6,stroke:#60a5fa,color:#eff6ff');
    lines.push('    classDef doneStyle fill:#10b981,stroke:#34d399,color:#ecfdf5');
    lines.push('    classDef cancelStyle fill:#ef4444,stroke:#f87171,color:#fef2f2');

    // Assign classes
    const draftIds = [...stateCategories.draft, ...stateCategories.new];
    const activeIds = [...stateCategories.active, ...stateCategories.confirmed, ...stateCategories.open, ...stateCategories.sent, ...stateCategories.progress];
    const doneIds = [...stateCategories.done, ...stateCategories.paid, ...stateCategories.posted];
    const cancelIds = [...stateCategories.cancel, ...stateCategories.cancelled, ...stateCategories.refused, ...stateCategories.rejected];

    if (draftIds.length > 0)  lines.push(`    class ${[...new Set(draftIds)].join(',')} draftStyle`);
    if (activeIds.length > 0) lines.push(`    class ${[...new Set(activeIds)].join(',')} activeStyle`);
    if (doneIds.length > 0)   lines.push(`    class ${[...new Set(doneIds)].join(',')} doneStyle`);
    if (cancelIds.length > 0) lines.push(`    class ${[...new Set(cancelIds)].join(',')} cancelStyle`);

    lines.push('');

    // --- Determine start state (first state or 'draft') ---
    const startState = states.find(s => s && (s.value === 'draft' || s.value === 'new'));
    if (startState) {
      const startId = startState.value.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`    [*] --> ${startId} : Create`);
    } else if (states.length > 0 && states[0]) {
      const startId = states[0].value.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`    [*] --> ${startId}`);
    }

    // --- Render transitions ---
    transitions.forEach(tr => {
      if (!tr || !tr.from || !tr.to) return;
      const fromId = tr.from.replace(/[^a-zA-Z0-9_]/g, '_');
      const toId = tr.to.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = tr.label || tr.method || '';
      lines.push(`    ${fromId} --> ${toId} : ${label}`);
    });

    // --- Mark end states (done or cancel lead to [*]) ---
    const endStateValues = ['done', 'paid', 'posted', 'completed'];
    states.forEach(state => {
      if (!state || !state.value) return;
      if (endStateValues.includes(state.value.toLowerCase())) {
        const id = state.value.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`    ${id} --> [*]`);
      }
    });

    return lines.join('\n');
  }

  // ============================================================
  // generateFlowchart(businessFlow)
  // ============================================================

  /**
   * Generate a Mermaid flowchart TD for a business process flow.
   *
   * Node shapes:
   *   process  → [label]
   *   decision → {label}
   *   start    → ([label])
   *   end      → ([label])
   *
   * @param {{name:string, steps:Array<{id:string, label:string, type:string}>, connections:Array<{from:string, to:string, label?:string}>}} businessFlow
   * @returns {string} Mermaid flowchart TD code.
   */
  function generateFlowchart(businessFlow) {
    if (!businessFlow) return 'flowchart TD\n    A([No Data])';

    const steps = Array.isArray(businessFlow.steps) ? businessFlow.steps : [];
    const connections = Array.isArray(businessFlow.connections) ? businessFlow.connections : [];
    const flowName = businessFlow.name || 'Business Flow';

    const lines = ['flowchart TD'];
    lines.push(`    %% ${flowName}`);

    // classDef for styling
    lines.push('    classDef processNode fill:#1a1a3e,stroke:#7c5cfc,color:#e8e8f0');
    lines.push('    classDef decisionNode fill:#12122a,stroke:#00d4aa,color:#e8e8f0');
    lines.push('    classDef startNode fill:#10b981,stroke:#34d399,color:#ffffff');
    lines.push('    classDef endNode fill:#ef4444,stroke:#f87171,color:#ffffff');
    lines.push('');

    // --- Declare nodes ---
    const processIds = [];
    const decisionIds = [];
    const startIds = [];
    const endIds = [];

    steps.forEach(step => {
      if (!step || !step.id) return;
      const id = step.id.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = step.label || step.id;

      switch (step.type) {
        case 'decision':
          lines.push(`    ${id}{${sanitizeLabel(label)}}`);
          decisionIds.push(id);
          break;
        case 'start':
          lines.push(`    ${id}([${sanitizeLabel(label)}])`);
          startIds.push(id);
          break;
        case 'end':
          lines.push(`    ${id}([${sanitizeLabel(label)}])`);
          endIds.push(id);
          break;
        case 'process':
        default:
          lines.push(`    ${id}[${sanitizeLabel(label)}]`);
          processIds.push(id);
          break;
      }
    });

    // Apply classDef styles
    if (processIds.length > 0)  lines.push(`    class ${processIds.join(',')} processNode`);
    if (decisionIds.length > 0) lines.push(`    class ${decisionIds.join(',')} decisionNode`);
    if (startIds.length > 0)    lines.push(`    class ${startIds.join(',')} startNode`);
    if (endIds.length > 0)      lines.push(`    class ${endIds.join(',')} endNode`);

    lines.push('');

    // --- Declare connections ---
    connections.forEach(conn => {
      if (!conn || !conn.from || !conn.to) return;
      const fromId = conn.from.replace(/[^a-zA-Z0-9_]/g, '_');
      const toId = conn.to.replace(/[^a-zA-Z0-9_]/g, '_');

      if (conn.label) {
        lines.push(`    ${fromId} -->|${sanitizeLabel(conn.label)}| ${toId}`);
      } else {
        lines.push(`    ${fromId} --> ${toId}`);
      }
    });

    return lines.join('\n');
  }

  // ============================================================
  // generateMenuTree(menus)
  // ============================================================

  /**
   * Generate a Mermaid graph TD for the menu hierarchy.
   *
   * @param {Array<{id:string|number, name:string, parent_id?:string|number, action?:string, model?:string}>} menus
   * @returns {string} Mermaid graph TD code.
   */
  function generateMenuTree(menus) {
    const safeMenus = Array.isArray(menus) ? menus : [];
    if (safeMenus.length === 0) {
      return 'graph TD\n    root["No menus found"]';
    }

    const lines = ['graph TD'];
    lines.push('    classDef menuRoot fill:#7c5cfc,stroke:#9d8afc,color:#ffffff');
    lines.push('    classDef menuBranch fill:#1a1a3e,stroke:#7c5cfc,color:#e8e8f0');
    lines.push('    classDef menuLeaf fill:#12122a,stroke:#00d4aa,color:#e8e8f0');
    lines.push('');

    // Build a set of IDs for fast parent lookup
    const menuById = {};
    safeMenus.forEach(m => {
      if (m && m.id != null) menuById[m.id] = m;
    });

    // Identify roots (no parent_id or parent_id not in set)
    const roots = [];
    const children = [];

    safeMenus.forEach(m => {
      if (!m) return;
      if (m.parent_id == null || !menuById[m.parent_id]) {
        roots.push(m);
      } else {
        children.push(m);
      }
    });

    // Track leaf vs branch
    const hasChildren = new Set();
    safeMenus.forEach(m => {
      if (m && m.parent_id != null) hasChildren.add(String(m.parent_id));
    });

    // Declare nodes
    safeMenus.forEach(m => {
      if (!m) return;
      const nodeId = `menu_${String(m.id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
      let label = m.name || `Menu ${m.id}`;

      // If leaf node and has action/model, append info
      if (!hasChildren.has(String(m.id)) && (m.action || m.model)) {
        const extra = m.model || m.action || '';
        label += ` → ${extra}`;
      }

      lines.push(`    ${nodeId}[${sanitizeLabel(label)}]`);
    });

    // Declare edges
    children.forEach(m => {
      if (!m || m.parent_id == null) return;
      const parentNodeId = `menu_${String(m.parent_id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const childNodeId = `menu_${String(m.id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
      lines.push(`    ${parentNodeId} --> ${childNodeId}`);
    });

    lines.push('');

    // Assign classes
    const rootIds = roots.map(m => `menu_${String(m.id).replace(/[^a-zA-Z0-9_]/g, '_')}`);
    const leafIds = safeMenus
      .filter(m => m && !hasChildren.has(String(m.id)))
      .map(m => `menu_${String(m.id).replace(/[^a-zA-Z0-9_]/g, '_')}`);
    const branchIds = safeMenus
      .filter(m => m && hasChildren.has(String(m.id)) && !roots.includes(m))
      .map(m => `menu_${String(m.id).replace(/[^a-zA-Z0-9_]/g, '_')}`);

    if (rootIds.length > 0)   lines.push(`    class ${rootIds.join(',')} menuRoot`);
    if (branchIds.length > 0) lines.push(`    class ${branchIds.join(',')} menuBranch`);
    if (leafIds.length > 0)   lines.push(`    class ${leafIds.join(',')} menuLeaf`);

    return lines.join('\n');
  }

  // ============================================================
  // generateModelClassDiagram(model)
  // ============================================================

  /**
   * Generate a Mermaid classDiagram for a single Odoo model,
   * showing all fields and methods.
   *
   * @param {{name:string, inherit?:string|string[], fields:Array<{name:string, type:string, required?:boolean, readonly?:boolean, compute?:string}>, methods:Array<{name:string, decorators?:string[]}>}} model
   * @returns {string} Mermaid classDiagram code.
   */
  function generateModelClassDiagram(model) {
    if (!model || !model.name) return 'classDiagram\n    class UnknownModel';

    const lines = ['classDiagram'];

    // Convert dotted name to PascalCase for class diagram readability
    const className = model.name
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    lines.push(`    class ${className} {`);

    // Fields
    const fields = Array.isArray(model.fields) ? model.fields : [];
    fields.forEach(field => {
      if (!field) return;
      const fType = field.type || 'Unknown';
      const fName = field.name || 'unknown';

      // Visibility marker: + public, # protected (compute), - private
      let visibility = '+';
      if (fName.startsWith('_')) visibility = '-';
      if (field.compute) visibility = '#';

      // Annotations
      let annotation = '';
      if (field.required) annotation += ' *';
      if (field.readonly) annotation += ' [RO]';
      if (field.compute) annotation += ' [computed]';

      lines.push(`        ${visibility}${fType} ${fName}${annotation}`);
    });

    // Methods
    const methods = Array.isArray(model.methods) ? model.methods : [];
    methods.forEach(method => {
      if (!method) return;
      const mName = method.name || 'unknown';
      let visibility = '+';
      if (mName.startsWith('_')) visibility = '-';

      // Show decorators as annotations
      let decoratorHint = '';
      if (Array.isArray(method.decorators) && method.decorators.length > 0) {
        decoratorHint = ` «${method.decorators.join(', ')}»`;
      }

      lines.push(`        ${visibility}${mName}()${decoratorHint}`);
    });

    lines.push('    }');

    // Show inheritance if present
    if (model.inherit) {
      const inherits = Array.isArray(model.inherit) ? model.inherit : [model.inherit];
      inherits.forEach(parent => {
        if (!parent) return;
        const parentClass = parent
          .split('.')
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join('');
        lines.push(`    ${parentClass} <|-- ${className}`);
        // Declare parent minimally so Mermaid can render the relationship
        lines.push(`    class ${parentClass}`);
      });
    }

    return lines.join('\n');
  }

  // ============================================================
  // SVG Post-Processing: Color-coded interactive lines
  // ============================================================

  /** Severity → visual style mapping for diagram edges */
  const SEVERITY_STYLES = {
    critical: { color: '#ff6b6b', strokeWidth: 3,   label: '🔴 Critical' },
    warning:  { color: '#ffc048', strokeWidth: 2.5, label: '🟡 Warning'  },
    info:     { color: '#74b9ff', strokeWidth: 2,   label: '🔵 Info'     },
    none:     { color: '#00d4aa', strokeWidth: 1.5, label: '🟢 No Issues' }
  };

  /** Severity ranking – lower index = higher priority */
  const SEVERITY_RANK = ['critical', 'warning', 'info'];

  /**
   * Return the highest severity found among issues whose text mentions
   * the given keyword. Falls back to 'none' when no issue matches.
   *
   * @param {Array} issues - Full issues array from analysisResult.
   * @param {string} keyword - Field or method name to search for.
   * @returns {string} 'critical' | 'warning' | 'info' | 'none'
   */
  function _findHighestSeverity(issues, keyword) {
    if (!keyword || !Array.isArray(issues) || issues.length === 0) return 'none';

    const kw = keyword.toLowerCase();
    let best = -1; // nothing found yet

    for (const issue of issues) {
      if (!issue) continue;
      const haystack = [
        issue.code || '',
        issue.ruleId || '',
        issue.description || '',
        issue.title || '',
        issue.field || '',
        issue.method || ''
      ].join(' ').toLowerCase();

      if (!haystack.includes(kw)) continue;

      const rank = SEVERITY_RANK.indexOf(issue.severity);
      if (rank === 0) return 'critical'; // can't get worse
      if (rank > 0 && (best === -1 || rank < best)) best = rank;
    }

    return best === -1 ? 'none' : SEVERITY_RANK[best];
  }

  /**
   * Attach click, mouseenter, and mouseleave handlers to a coloured
   * SVG edge element so it navigates to the Errors section.
   *
   * @param {SVGElement} element  - The SVG path / text element.
   * @param {string} searchTerm  - Text to inject into the search box.
   * @param {string} color       - Severity colour string.
   * @param {number} baseWidth   - Original stroke-width for restore.
   */
  function _attachEdgeInteraction(element, searchTerm, color, baseWidth) {
    element.style.cursor = 'pointer';

    // --- Click → navigate to errors with pre-filled search ---
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        // Fill the search input
        const searchInput = document.getElementById('error-search');
        if (searchInput) searchInput.value = searchTerm;

        // Update app state directly if available
        if (window.OdooAnalyzer && window.OdooAnalyzer.App && window.OdooAnalyzer.App.state) {
          window.OdooAnalyzer.App.state.filters.search = searchTerm;
        }

        // Navigate to errors section
        const navBtn = document.getElementById('nav-errors');
        if (navBtn) navBtn.click();

        // Trigger input event after a brief delay for section transition
        setTimeout(() => {
          const si = document.getElementById('error-search');
          if (si) {
            si.value = searchTerm;
            si.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 300);
      } catch (_err) {
        console.warn('[Visualizers] Edge click handler error:', _err);
      }
    });

    // --- Hover enter → glow + thicker stroke ---
    element.addEventListener('mouseenter', () => {
      if (element.tagName === 'path' || element.tagName === 'line') {
        element.setAttribute('stroke-width', String(baseWidth + 2));
        element.style.filter = `drop-shadow(0 0 6px ${color})`;
      } else {
        element.style.filter = `drop-shadow(0 0 6px ${color})`;
      }
    });

    // --- Hover leave → restore ---
    element.addEventListener('mouseleave', () => {
      if (element.tagName === 'path' || element.tagName === 'line') {
        element.setAttribute('stroke-width', String(baseWidth));
      }
      element.style.filter = '';
    });
  }

  /**
   * Post-process a Mermaid-rendered SVG to add severity colouring,
   * click navigation, and hover glow to every edge / relationship line.
   *
   * Called automatically by renderDiagram after Mermaid finishes.
   *
   * @param {HTMLElement} container    - The container holding the SVG.
   * @param {string}      diagramType  - 'erd' | 'state' | other.
   */
  function _postProcessSVG(container, diagramType) {
    try {
      if (!container) return;

      // Obtain the rendered SVG
      const svg = container.querySelector('svg');
      if (!svg) return;

      // --- Retrieve current analysis issues ---
      let issues = [];
      try {
        const appState = window.OdooAnalyzer && window.OdooAnalyzer.App && window.OdooAnalyzer.App.state;
        if (appState && appState.analysisResult && Array.isArray(appState.analysisResult.issues)) {
          issues = appState.analysisResult.issues;
        }
      } catch (_e) { /* state not available – all lines will be teal */ }

      // --- Collect edge paths ---
      // Mermaid uses different selectors depending on version / diagram type
      const edgePaths = svg.querySelectorAll('.edgePath path, .flowchart-link, .edge-pattern-solid, .transition, .relationshipLine, path.relation, .edge path');
      const edgeLabels = svg.querySelectorAll('.edgeLabel, .edgeTerminals, .edge-label');

      // Build a label-text → severity map for quick look-up
      const labelTextMap = new Map();
      edgeLabels.forEach(labelEl => {
        const txt = (labelEl.textContent || '').trim();
        if (txt) {
          // Remove sanitization artefacts (special unicode replacements)
          const cleaned = txt
            .replace(/[❨❩⦋⦌❴❵¦]/g, '')
            .replace(/["']/g, '')
            .trim();
          if (cleaned) {
            const severity = _findHighestSeverity(issues, cleaned);
            labelTextMap.set(cleaned, severity);

            // Color the label text itself
            const style = SEVERITY_STYLES[severity];
            labelEl.style.cursor = 'pointer';
            const innerSpans = labelEl.querySelectorAll('span, tspan, div, p, foreignObject span');
            if (innerSpans.length > 0) {
              innerSpans.forEach(sp => { sp.style.color = style.color; });
            } else {
              labelEl.style.color = style.color;
              // For SVG <text> elements
              if (labelEl.tagName === 'text' || labelEl.querySelector('text')) {
                const texts = labelEl.tagName === 'text' ? [labelEl] : labelEl.querySelectorAll('text');
                texts.forEach(t => t.setAttribute('fill', style.color));
              }
            }
            _attachEdgeInteraction(labelEl, cleaned, style.color, 0);
          }
        }
      });

      // --- Color edge paths ---
      // Strategy: try to pair each path with its nearest label.
      // Mermaid typically renders edges and labels in the same order.
      const labelEntries = Array.from(labelTextMap.entries());
      let labelIdx = 0;

      edgePaths.forEach((pathEl, pathIdx) => {
        let keyword = '';
        let severity = 'none';

        // Attempt to correlate by index (Mermaid renders in order)
        if (labelIdx < labelEntries.length) {
          keyword = labelEntries[labelIdx][0];
          severity = labelEntries[labelIdx][1];
          labelIdx++;
        }

        // Also try extracting from a sibling / parent label
        if (!keyword) {
          const parentEdge = pathEl.closest('.edgePath, .edge');
          if (parentEdge) {
            const sibLabel = parentEdge.querySelector('.edgeLabel, text');
            if (sibLabel) {
              keyword = (sibLabel.textContent || '').replace(/[❨❩⦋⦌❴❵¦"']/g, '').trim();
              severity = _findHighestSeverity(issues, keyword);
            }
          }
        }

        const style = SEVERITY_STYLES[severity];

        // Apply stroke colour & width
        pathEl.setAttribute('stroke', style.color);
        pathEl.setAttribute('stroke-width', String(style.strokeWidth));
        pathEl.style.transition = 'stroke-width 0.2s ease, filter 0.2s ease';

        // If the path has marker-end (arrowhead), try to colour it too
        const markerId = (pathEl.getAttribute('marker-end') || '').match(/url\(#(.+?)\)/);
        if (markerId && markerId[1]) {
          const marker = svg.querySelector(`#${CSS.escape(markerId[1])}`);
          if (marker) {
            const markerPath = marker.querySelector('path, polygon, line');
            if (markerPath) {
              markerPath.setAttribute('fill', style.color);
              markerPath.setAttribute('stroke', style.color);
            }
          }
        }

        if (keyword) {
          _attachEdgeInteraction(pathEl, keyword, style.color, style.strokeWidth);
        }
      });

      // ----- ER diagram specific: colour relationship lines -----
      if (diagramType === 'erd') {
        const relLines = svg.querySelectorAll('.er.relationshipLine, .er path, line.er');
        const relLabels = svg.querySelectorAll('.er.relationshipLabel, .er text');

        relLabels.forEach((lbl, idx) => {
          const txt = (lbl.textContent || '').replace(/[❨❩⦋⦌❴❵¦"']/g, '').trim();
          if (!txt) return;

          const sev = _findHighestSeverity(issues, txt);
          const st = SEVERITY_STYLES[sev];

          // Colour the label
          lbl.setAttribute('fill', st.color);
          lbl.style.cursor = 'pointer';
          _attachEdgeInteraction(lbl, txt, st.color, 0);

          // Try to colour the corresponding line
          // ER diagrams often pair label index with line index
          if (relLines[idx]) {
            relLines[idx].setAttribute('stroke', st.color);
            relLines[idx].setAttribute('stroke-width', String(st.strokeWidth));
            relLines[idx].style.transition = 'stroke-width 0.2s ease, filter 0.2s ease';
            _attachEdgeInteraction(relLines[idx], txt, st.color, st.strokeWidth);
          }
        });
      }

      // ----- State diagram specific: colour transitions -----
      if (diagramType === 'state') {
        const transLabels = svg.querySelectorAll('.transition text, .statediagram-state text, text.transitionLabel');
        transLabels.forEach(lbl => {
          const txt = (lbl.textContent || '').replace(/[❨❩⦋⦌❴❵¦"']/g, '').trim();
          if (!txt || txt === 'Create') return;

          const sev = _findHighestSeverity(issues, txt);
          const st = SEVERITY_STYLES[sev];
          lbl.setAttribute('fill', st.color);
          lbl.style.cursor = 'pointer';
          _attachEdgeInteraction(lbl, txt, st.color, 0);
        });
      }

      // --- Append severity legend below the diagram ---
      _appendLegend(container);

    } catch (err) {
      console.warn('[Visualizers] SVG post-processing error:', err);
      // Non-fatal: the diagram is already rendered, just without colours.
    }
  }

  /**
   * Append a colour-coded legend bar below the diagram container.
   * @param {HTMLElement} container
   */
  function _appendLegend(container) {
    // Remove existing legend if present (re-render scenario)
    const existing = container.querySelector('.diagram-severity-legend');
    if (existing) existing.remove();

    const legend = document.createElement('div');
    legend.className = 'diagram-severity-legend';
    legend.style.cssText = [
      'display:flex', 'flex-wrap:wrap', 'align-items:center', 'justify-content:center',
      'gap:1rem', 'padding:0.75rem 1rem', 'margin-top:0.75rem',
      'background:#1a1a2e', 'border:1px solid #2a2a4a', 'border-radius:10px',
      'font-size:0.8rem', 'color:#b0b0c8'
    ].join(';');

    const items = [
      { emoji: '🔴', label: 'Critical', color: '#ff6b6b' },
      { emoji: '🟡', label: 'Warning',  color: '#ffc048' },
      { emoji: '🔵', label: 'Info',     color: '#74b9ff' },
      { emoji: '🟢', label: 'No Issues', color: '#00d4aa' }
    ];

    items.forEach(item => {
      const span = document.createElement('span');
      span.style.cssText = `display:inline-flex;align-items:center;gap:0.3rem;color:${item.color};font-weight:600;`;
      span.textContent = `${item.emoji} ${item.label}`;
      legend.appendChild(span);

      // Separator dot (except after last)
      if (item !== items[items.length - 1]) {
        const sep = document.createElement('span');
        sep.style.color = '#3a3a5a';
        sep.textContent = '•';
        legend.appendChild(sep);
      }
    });

    // Hint text
    const hint = document.createElement('div');
    hint.style.cssText = 'width:100%;text-align:center;font-size:0.72rem;color:#6b6b8a;margin-top:0.25rem;';
    hint.textContent = 'Klik garis untuk melihat detail masalah';
    legend.appendChild(hint);

    container.appendChild(legend);
  }

  // ============================================================
  // renderDiagram(containerId, mermaidCode, diagramType)
  // ============================================================

  /**
   * Render a Mermaid diagram into a given container element.
   *
   * - Clears the container
   * - Creates a unique child div
   * - Inserts the Mermaid code and calls mermaid.run()
   * - Falls back to displaying the raw code on error
   * - After successful render, post-processes SVG for severity colours.
   *
   * @param {string} containerId - DOM id of the container element.
   * @param {string} mermaidCode - Mermaid diagram source code.
   * @param {string} [diagramType] - Optional: 'erd' | 'state' | 'menu' etc.
   */
  function renderDiagram(containerId, mermaidCode, diagramType) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[Visualizers] Container element #${containerId} not found.`);
      return;
    }

    // Clear previous content
    container.innerHTML = '';

    if (!mermaidCode || mermaidCode.trim().length === 0) {
      container.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Tidak ada data diagram untuk ditampilkan.</p></div>';
      return;
    }

    // Ensure mermaid library is available
    if (typeof mermaid === 'undefined') {
      console.error('[Visualizers] Mermaid library is not loaded.');
      container.innerHTML = '<div class="empty-state error"><span class="empty-icon">⚠️</span><p>Library Mermaid belum dimuat. Pastikan mermaid.js disertakan.</p></div>';
      return;
    }

    // Initialize Mermaid based on current theme
    try {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      mermaid.initialize({
        startOnLoad: false,
        theme: isLight ? 'default' : 'dark',
        themeVariables: isLight ? {
          primaryColor: '#6c5ce7',
          primaryTextColor: '#2d3436',
          primaryBorderColor: '#8f82f2',
          lineColor: '#00d4aa',
          secondaryColor: '#f8fafc',
          tertiaryColor: '#ffffff'
        } : {
          primaryColor: '#7c5cfc',
          primaryTextColor: '#e8e8f0',
          primaryBorderColor: '#9d8afc',
          lineColor: '#00d4aa',
          secondaryColor: '#1a1a3e',
          tertiaryColor: '#12122a'
        }
      });
    } catch (_initErr) {
      console.warn('[Visualizers] Failed to initialize mermaid:', _initErr);
    }

    // Create a unique wrapper div for this render
    const uniqueId = `mermaid-diagram-${++_renderCounter}-${Date.now()}`;
    const wrapper = document.createElement('div');
    wrapper.id = uniqueId;
    wrapper.className = 'mermaid';
    wrapper.textContent = mermaidCode;
    container.appendChild(wrapper);

    // Attempt rendering, then post-process SVG for severity colours
    try {
      if (typeof mermaid.run === 'function') {
        // Mermaid v10+ API
        mermaid.run({ nodes: [wrapper] }).then(() => {
          _postProcessSVG(container, diagramType);
        }).catch(err => {
          _showDiagramError(container, mermaidCode, err);
        });
      } else if (typeof mermaid.render === 'function') {
        // Mermaid v9 fallback
        mermaid.render(uniqueId + '_svg', mermaidCode).then(result => {
          wrapper.innerHTML = result.svg || result;
          _postProcessSVG(container, diagramType);
        }).catch(err => {
          _showDiagramError(container, mermaidCode, err);
        });
      } else {
        // Older mermaid – rely on startOnLoad or init
        mermaid.init(undefined, wrapper);
        // For sync init, post-process after a brief delay
        setTimeout(() => _postProcessSVG(container, diagramType), 500);
      }
    } catch (err) {
      _showDiagramError(container, mermaidCode, err);
    }
  }

  /**
   * Display a graceful error when Mermaid rendering fails.
   * Shows the error message and the raw Mermaid code for debugging.
   *
   * @private
   */
  function _showDiagramError(container, mermaidCode, err) {
    console.error('[Visualizers] Mermaid render error:', err);
    container.innerHTML = `
      <div class="empty-state error" style="text-align:left;">
        <span class="empty-icon">⚠️</span>
        <p style="color:#ff6b6b;margin-bottom:0.5rem;">Gagal merender diagram: ${escapeHtml(err.message || String(err))}</p>
        <details style="margin-top:0.5rem;">
          <summary style="cursor:pointer;color:#8888a8;">Lihat kode Mermaid</summary>
          <pre style="background:#12122a;padding:1rem;border-radius:8px;margin-top:0.5rem;overflow-x:auto;color:#e8e8f0;font-size:0.8rem;">${escapeHtml(mermaidCode)}</pre>
        </details>
      </div>`;
  }

  // ============================================================
  // generateFullReport(analysisResult)
  // ============================================================

  /**
   * Generate a complete HTML report string from analysis results.
   * All prose is in Indonesian; technical identifiers remain in English.
   *
   * Report sections:
   * 1. Ringkasan Eksekutif  (Executive Summary)
   * 2. Ikhtisar Modul       (Module Overview)
   * 3. Inventaris Model     (Model Inventory)
   * 4. Relasi & Business Flow
   * 5. Masalah & Rekomendasi
   * 6. Statistik
   *
   * Styled with inline CSS for portability (PDF/Word export).
   * @param {{modules?:Array, models?:Array, fields?:Array, methods?:Array, views?:Array, issues?:Array, healthScore?:number, odooVersion?:string, relationships?:Array, businessFlows?:Array, menus?:Array, stats?:object}} analysisResult
   * @returns {string} Full HTML report string.
   */
  function generateFullReport(analysisResult) {
    if (!analysisResult) {
      const lang = localStorage.getItem('lang') || 'id';
      return lang === 'en'
        ? '<div style="padding:2rem;color:#ff6b6b;font-family:Inter,sans-serif;">No analysis data to generate report.</div>'
        : '<div style="padding:2rem;color:#ff6b6b;font-family:Inter,sans-serif;">Tidak ada data analisis untuk membuat laporan.</div>';
    }

    const lang = localStorage.getItem('lang') || 'id';
    const T = {
      en: {
        noVersion: 'Not detected',
        reportTitle: '📋 Erpura Code Analysis Report',
        reportSubtitle: 'Automatically generated by Erpura • Odoo Version:',
        secExecutive: '1. Executive Summary',
        healthScoreLabel: 'Health Score:',
        statModul: 'Module',
        statModel: 'Model',
        statField: 'Field',
        statMethod: 'Method',
        statView: 'View',
        statMasalah: 'Issue',
        temuUtama: 'Key Findings:',
        criticalText: 'critical issues that need immediate attention',
        warningText: 'warnings that should be resolved',
        infoText: 'informational notes for quality improvement',
        cleanText: 'No issues found — code is in good condition!',
        scoreGood: 'Good',
        scoreOk: 'Needs Attention',
        scoreBad: 'Critical',
        secModul: '2. Module Overview',
        noModul: 'No modules detected.',
        colModName: 'Module Name',
        colModModel: 'Model Count',
        colModVer: 'Version',
        colModDep: 'Dependencies',
        secModel: '3. Model Inventory',
        noModel: 'No models detected.',
        colMdlName: 'Model Name',
        colMdlInherit: 'Inherit',
        colMdlFields: 'Fields',
        colMdlMethods: 'Methods',
        colMdlDesc: 'Description',
        secRelFlow: '4. Relation & Business Flow',
        noRelFlow: 'No relations or business flows detected.',
        relTitle: 'Model Relations',
        relSubtitle: 'Found <strong>{count}</strong> relations between models in analyzed code.',
        colRelFrom: 'From Model',
        colRelType: 'Type',
        colRelTo: 'To Model',
        colRelField: 'Field',
        otherRel: '... and {count} other relations',
        diagramER: '📊 ER (Entity Relationship) Diagram:',
        errER: 'Failed to create ER diagram.',
        flowTitle: 'Business Flow',
        flowSubtitle: 'Found <strong>{count}</strong> business flows / state machines.',
        errState: 'Failed to create state diagram.',
        secIssue: '5. Issues & Recommendations',
        cleanCodeCard: '🎉 No issues found. Code is in good condition!',
        issueSevCritical: 'Critical',
        issueSevWarning: 'Warning',
        issueSevInfo: 'Information',
        issueRec: '💡 Recommendation:',
        issueLine: 'line',
        secStat: '6. Statistics',
        statMetric: 'Metric',
        statCount: 'Count',
        healthBreakdown: 'Health Score Breakdown:',
        healthExplanation: 'Score is calculated based on the number and severity of issues found relative to code size.',
        footerText: 'This report was automatically generated by <strong style="color:#7c5cfc;">Erpura</strong> • ',
        totalMenus: 'Total Menu',
        totalRelations: 'Total Relation'
      },
      id: {
        noVersion: 'Tidak terdeteksi',
        reportTitle: '📋 Laporan Analisis Kode Erpura',
        reportSubtitle: 'Dibuat otomatis oleh Erpura • Versi Odoo:',
        secExecutive: '1. Ringkasan Eksekutif',
        healthScoreLabel: 'Skor Kesehatan:',
        statModul: 'Modul',
        statModel: 'Model',
        statField: 'Field',
        statMethod: 'Method',
        statView: 'View',
        statMasalah: 'Masalah',
        temuUtama: 'Temuan Utama:',
        criticalText: 'masalah kritikal yang perlu segera ditangani',
        warningText: 'peringatan yang sebaiknya diperbaiki',
        infoText: 'catatan informasi untuk peningkatan kualitas',
        cleanText: 'Tidak ada masalah yang ditemukan — kode dalam kondisi baik!',
        scoreGood: 'Baik',
        scoreOk: 'Perlu Perhatian',
        scoreBad: 'Kritis',
        secModul: '2. Ikhtisar Modul',
        noModul: 'Tidak ada modul yang terdeteksi.',
        colModName: 'Nama Modul',
        colModModel: 'Jumlah Model',
        colModVer: 'Versi',
        colModDep: 'Dependensi',
        secModel: '3. Inventaris Model',
        noModel: 'Tidak ada model yang terdeteksi.',
        colMdlName: 'Nama Model',
        colMdlInherit: 'Inherit',
        colMdlFields: 'Fields',
        colMdlMethods: 'Methods',
        colMdlDesc: 'Deskripsi',
        secRelFlow: '4. Relasi & Business Flow',
        noRelFlow: 'Tidak ada relasi atau business flow yang terdeteksi.',
        relTitle: 'Relasi antar Model',
        relSubtitle: 'Ditemukan <strong>{count}</strong> relasi antar model dalam kode yang dianalisis.',
        colRelFrom: 'Dari Model',
        colRelType: 'Tipe',
        colRelTo: 'Ke Model',
        colRelField: 'Field',
        otherRel: '... dan {count} relasi lainnya',
        diagramER: '📊 Diagram ER (Entity Relationship):',
        errER: 'Gagal membuat diagram ER.',
        flowTitle: 'Business Flow',
        flowSubtitle: 'Ditemukan <strong>{count}</strong> business flow / state machine.',
        errState: 'Gagal membuat diagram state.',
        secIssue: '5. Masalah & Rekomendasi',
        cleanCodeCard: '🎉 Tidak ada masalah yang ditemukan. Kode dalam kondisi baik!',
        issueSevCritical: 'Kritikal',
        issueSevWarning: 'Peringatan',
        issueSevInfo: 'Informasi',
        issueRec: '💡 Rekomendasi:',
        issueLine: 'baris',
        secStat: '6. Statistik',
        statMetric: 'Metrik',
        statCount: 'Jumlah',
        healthBreakdown: 'Rincian Skor Kesehatan:',
        healthExplanation: 'Skor dihitung berdasarkan jumlah dan tingkat keparahan masalah yang ditemukan relatif terhadap ukuran kode.',
        footerText: 'Laporan ini dibuat secara otomatis oleh <strong style="color:#7c5cfc;">Erpura</strong> • ',
        totalMenus: 'Total Menu',
        totalRelations: 'Total Relasi'
      }
    }[lang];

    // Convenience references with safe defaults
    const modules       = analysisResult.modules       || [];
    const models        = analysisResult.models        || [];
    const fields        = analysisResult.fields        || [];
    const methods       = analysisResult.methods       || [];
    const views         = analysisResult.views         || [];
    const issues        = analysisResult.issues        || [];
    const relationships = analysisResult.relationships || [];
    const businessFlows = analysisResult.businessFlows || [];
    const menus         = analysisResult.menus         || [];
    const stats         = analysisResult.stats         || {};
    const healthScore   = analysisResult.healthScore ?? stats.healthScore ?? 0;
    const odooVersion   = analysisResult.odooVersion || stats.odooVersion || T.noVersion;

    // ----- Inline style constants -----
    const S = {
      page:        'font-family:Inter,Segoe UI,Roboto,sans-serif;color:#e8e8f0;background:#0f0f23;padding:2rem 2.5rem;line-height:1.7;max-width:960px;margin:0 auto;',
      h1:          'font-size:1.75rem;font-weight:700;margin:0 0 0.25rem 0;color:#ffffff;border-bottom:2px solid #7c5cfc;padding-bottom:0.75rem;',
      h2:          'font-size:1.35rem;font-weight:600;margin:2rem 0 1rem 0;color:#c4b5fd;border-left:4px solid #7c5cfc;padding-left:0.75rem;',
      h3:          'font-size:1.1rem;font-weight:600;margin:1.5rem 0 0.75rem 0;color:#a5b4fc;',
      subtitle:    'color:#8888a8;font-size:0.9rem;margin-bottom:1.5rem;',
      card:        'background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;padding:1.25rem;margin-bottom:1rem;',
      table:       'width:100%;border-collapse:collapse;margin:1rem 0;font-size:0.85rem;',
      th:          'background:#1e1e3a;color:#c4b5fd;padding:0.6rem 0.75rem;text-align:left;border-bottom:2px solid #7c5cfc;font-weight:600;',
      td:          'padding:0.5rem 0.75rem;border-bottom:1px solid #2a2a4a;color:#d1d1e0;',
      badge:       'display:inline-block;padding:0.15rem 0.6rem;border-radius:999px;font-size:0.75rem;font-weight:600;margin-right:0.25rem;',
      badgeCritical: 'background:#7f1d1d;color:#fca5a5;',
      badgeWarning:  'background:#78350f;color:#fcd34d;',
      badgeInfo:     'background:#1e3a5f;color:#93c5fd;',
      scoreGood:     'color:#10b981;',
      scoreOk:       'color:#f59e0b;',
      scoreBad:      'color:#ef4444;',
      issueCard:     'background:#1a1a2e;border:1px solid #2a2a4a;border-radius:8px;padding:1rem;margin-bottom:0.75rem;',
      issueTitle:    'font-weight:600;color:#e8e8f0;margin-bottom:0.25rem;',
      issueDesc:     'color:#b0b0c8;font-size:0.85rem;margin-bottom:0.25rem;',
      issueMeta:     'color:#6b6b8a;font-size:0.8rem;',
      mermaidBox:    'background:#12122a;border:1px dashed #3a3a5a;border-radius:8px;padding:1rem;margin:1rem 0;overflow-x:auto;',
      statsGrid:     'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.75rem;margin:1rem 0;',
      statItem:      'background:#12122a;border:1px solid #2a2a4a;border-radius:8px;padding:1rem;text-align:center;',
      statValue:     'font-size:1.75rem;font-weight:700;color:#7c5cfc;',
      statLabel:     'font-size:0.8rem;color:#8888a8;margin-top:0.25rem;',
    };

    // ----- Health score helpers -----
    const scoreStyle = healthScore >= 70 ? S.scoreGood : (healthScore >= 40 ? S.scoreOk : S.scoreBad);
    const scoreEmoji = healthScore >= 70 ? '✅' : (healthScore >= 40 ? '⚠️' : '🔴');
    const scoreText  = healthScore >= 70 ? T.scoreGood : (healthScore >= 40 ? T.scoreOk : T.scoreBad);

    // ----- Count issues by severity -----
    const criticalCount = issues.filter(i => i && i.severity === 'critical').length;
    const warningCount  = issues.filter(i => i && i.severity === 'warning').length;
    const infoCount     = issues.filter(i => i && i.severity === 'info').length;

    // ----- Build HTML sections -----
    let html = `<div style="${S.page}">`;

    // ======== 1. Ringkasan Eksekutif ========
    html += `<h1 style="${S.h1}">${T.reportTitle}</h1>`;
    html += `<p style="${S.subtitle}">${T.reportSubtitle} ${escapeHtml(odooVersion)}</p>`;

    html += `<h2 style="${S.h2}">${T.secExecutive}</h2>`;
    html += `<div style="${S.card}">`;
    html += `  <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">`;
    html += `    <div style="font-size:2.5rem;">${scoreEmoji}</div>`;
    html += `    <div>`;
    html += `      <div style="font-size:2rem;font-weight:700;${scoreStyle}">${healthScore}/100</div>`;
    html += `      <div style="color:#8888a8;font-size:0.9rem;">${T.healthScoreLabel} <strong style="${scoreStyle}">${scoreText}</strong></div>`;
    html += `    </div>`;
    html += `  </div>`;

    html += `  <div style="${S.statsGrid}">`;
    html += _statBox(S, modules.length, T.statModul);
    html += _statBox(S, models.length || stats.totalModels || 0, T.statModel);
    html += _statBox(S, fields.length || stats.totalFields || 0, T.statField);
    html += _statBox(S, methods.length || stats.totalMethods || 0, T.statMethod);
    html += _statBox(S, views.length || stats.totalViews || 0, T.statView);
    html += _statBox(S, issues.length, T.statMasalah);
    html += `  </div>`;

    // Key findings
    html += `  <div style="margin-top:1rem;">`;
    html += `    <strong style="color:#c4b5fd;">${T.temuUtama}</strong>`;
    html += `    <ul style="margin:0.5rem 0 0 1.25rem;color:#b0b0c8;">`;
    if (criticalCount > 0) html += `<li style="color:#fca5a5;">${criticalCount} ${T.criticalText}</li>`;
    if (warningCount > 0)  html += `<li style="color:#fcd34d;">${warningCount} ${T.warningText}</li>`;
    if (infoCount > 0)     html += `<li style="color:#93c5fd;">${infoCount} ${T.infoText}</li>`;
    if (issues.length === 0) html += `<li style="color:#10b981;">${T.cleanText}</li>`;
    html += `    </ul>`;
    html += `  </div>`;
    html += `</div>`;

    // ======== 2. Ikhtisar Modul ========
    html += `<h2 style="${S.h2}">${T.secModul}</h2>`;
    if (modules.length === 0) {
      html += `<p style="color:#8888a8;">${T.noModul}</p>`;
    } else {
      html += `<table style="${S.table}">`;
      html += `<thead><tr>`;
      html += `<th style="${S.th}">${T.colModName}</th>`;
      html += `<th style="${S.th}">${T.colModModel}</th>`;
      html += `<th style="${S.th}">${T.colModVer}</th>`;
      html += `<th style="${S.th}">${T.colModDep}</th>`;
      html += `</tr></thead><tbody>`;
      modules.forEach(mod => {
        if (!mod) return;
        const modModels = Array.isArray(mod.models) ? mod.models.length : 0;
        const version = mod.version || '-';
        const deps = Array.isArray(mod.depends) ? mod.depends.join(', ') : (mod.depends || '-');
        html += `<tr>`;
        html += `<td style="${S.td}"><strong>${escapeHtml(mod.name || 'unknown')}</strong></td>`;
        html += `<td style="${S.td}">${modModels}</td>`;
        html += `<td style="${S.td}">${escapeHtml(version)}</td>`;
        html += `<td style="${S.td};font-size:0.8rem;">${escapeHtml(deps)}</td>`;
        html += `</tr>`;
      });
      html += `</tbody></table>`;
    }

    // ======== 3. Inventaris Model ========
    html += `<h2 style="${S.h2}">${T.secModel}</h2>`;
    const allModels = models.length > 0
      ? models
      : modules.flatMap(m => (m && m.models) || []);

    if (allModels.length === 0) {
      html += `<p style="color:#8888a8;">${T.noModel}</p>`;
    } else {
      html += `<table style="${S.table}">`;
      html += `<thead><tr>`;
      html += `<th style="${S.th}">${T.colMdlName}</th>`;
      html += `<th style="${S.th}">${T.colMdlInherit}</th>`;
      html += `<th style="${S.th}">${T.colMdlFields}</th>`;
      html += `<th style="${S.th}">${T.colMdlMethods}</th>`;
      html += `<th style="${S.th}">${T.colMdlDesc}</th>`;
      html += `</tr></thead><tbody>`;
      allModels.forEach(mdl => {
        if (!mdl) return;
        const inherit = mdl.inherit
          ? (Array.isArray(mdl.inherit) ? mdl.inherit.join(', ') : mdl.inherit)
          : '-';
        const fCount = Array.isArray(mdl.fields)  ? mdl.fields.length  : 0;
        const mCount = Array.isArray(mdl.methods) ? mdl.methods.length : 0;
        const desc = mdl.description || mdl._description || '-';
        html += `<tr>`;
        html += `<td style="${S.td}"><strong>${escapeHtml(mdl.name || 'unknown')}</strong></td>`;
        html += `<td style="${S.td};font-size:0.8rem;">${escapeHtml(inherit)}</td>`;
        html += `<td style="${S.td}">${fCount}</td>`;
        html += `<td style="${S.td}">${mCount}</td>`;
        html += `<td style="${S.td};font-size:0.8rem;">${escapeHtml(desc)}</td>`;
        html += `</tr>`;
      });
      html += `</tbody></table>`;
    }

    // ======== 4. Relasi & Business Flow ========
    html += `<h2 style="${S.h2}">${T.secRelFlow}</h2>`;

    if (relationships.length === 0 && businessFlows.length === 0) {
      html += `<p style="color:#8888a8;">${T.noRelFlow}</p>`;
    } else {
      if (relationships.length > 0) {
        html += `<h3 style="${S.h3}">${T.relTitle}</h3>`;
        html += `<p style="color:#b0b0c8;font-size:0.9rem;">${T.relSubtitle.replace('{count}', relationships.length)}</p>`;

        html += `<table style="${S.table}">`;
        html += `<thead><tr>`;
        html += `<th style="${S.th}">${T.colRelFrom}</th>`;
        html += `<th style="${S.th}">${T.colRelType}</th>`;
        html += `<th style="${S.th}">${T.colRelTo}</th>`;
        html += `<th style="${S.th}">${T.colRelField}</th>`;
        html += `</tr></thead><tbody>`;
        relationships.slice(0, 30).forEach(rel => {
          if (!rel) return;
          html += `<tr>`;
          html += `<td style="${S.td}">${escapeHtml(rel.from || '-')}</td>`;
          html += `<td style="${S.td}"><code>${escapeHtml(rel.type || '-')}</code></td>`;
          html += `<td style="${S.td}">${escapeHtml(rel.to || '-')}</td>`;
          html += `<td style="${S.td}"><code>${escapeHtml(rel.field || '-')}</code></td>`;
          html += `</tr>`;
        });
        if (relationships.length > 30) {
          html += `<tr><td colspan="4" style="${S.td};color:#8888a8;text-align:center;">${T.otherRel.replace('{count}', relationships.length - 30)}</td></tr>`;
        }
        html += `</tbody></table>`;

        html += `<div style="${S.mermaidBox}">`;
        html += `  <p style="color:#8888a8;font-size:0.8rem;margin:0 0 0.5rem 0;">${T.diagramER}</p>`;
        try {
          const erdCode = generateERDiagram(allModels, relationships);
          html += `  <div class="mermaid-report-diagram" data-mermaid-code="${escapeHtml(erdCode)}" style="overflow-x:auto;">`;
          html += `    <pre style="color:#b0b0c8;font-size:0.75rem;white-space:pre-wrap;margin:0;">${escapeHtml(erdCode)}</pre>`;
          html += `  </div>`;
        } catch (_e) {
          html += `  <p style="color:#ff6b6b;font-size:0.85rem;">${T.errER}</p>`;
        }
        html += `</div>`;
      }

      if (businessFlows.length > 0) {
        html += `<h3 style="${S.h3}">${T.flowTitle}</h3>`;
        html += `<p style="color:#b0b0c8;font-size:0.9rem;">${T.flowSubtitle.replace('{count}', businessFlows.length)}</p>`;
        businessFlows.forEach((flow, idx) => {
          if (!flow) return;
          const fName = flow.name || flow.modelName || flow.model || `Flow ${idx + 1}`;
          html += `<div style="${S.card}">`;
          html += `  <strong style="color:#c4b5fd;">${escapeHtml(fName)}</strong>`;
          html += `  <div style="${S.mermaidBox}">`;
          try {
            const sdCode = generateStateDiagram(flow);
            html += `    <div class="mermaid-report-diagram" data-mermaid-code="${escapeHtml(sdCode)}">`;
            html += `      <pre style="color:#b0b0c8;font-size:0.75rem;white-space:pre-wrap;margin:0;">${escapeHtml(sdCode)}</pre>`;
            html += `    </div>`;
          } catch (_e) {
            html += `    <p style="color:#ff6b6b;font-size:0.85rem;">${T.errState}</p>`;
          }
          html += `  </div>`;
          html += `</div>`;
        });
      }
    }

    // ======== 5. Masalah & Rekomendasi ========
    html += `<h2 style="${S.h2}">${T.secIssue}</h2>`;

    if (issues.length === 0) {
      html += `<div style="${S.card}"><p style="color:#10b981;">${T.cleanCodeCard}</p></div>`;
    } else {
      const severityOrder = ['critical', 'warning', 'info'];
      const severityLabels = {
        critical: { label: T.issueSevCritical, emoji: '🔴', badgeStyle: S.badgeCritical },
        warning:  { label: T.issueSevWarning, emoji: '🟡', badgeStyle: S.badgeWarning },
        info:     { label: T.issueSevInfo, emoji: '🔵', badgeStyle: S.badgeInfo }
      };

      severityOrder.forEach(sev => {
        const group = issues.filter(i => i && i.severity === sev);
        if (group.length === 0) return;

        const meta = severityLabels[sev] || { label: sev, emoji: '⚪', badgeStyle: '' };
        html += `<h3 style="${S.h3}">${meta.emoji} ${meta.label} (${group.length})</h3>`;

        group.forEach(issue => {
          if (!issue) return;
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

          html += `<div style="${S.issueCard}">`;
          html += `  <div style="${S.issueTitle}">`;
          html += `    <span style="${S.badge}${meta.badgeStyle}">${sev.toUpperCase()}</span> `;
          html += `    ${escapeHtml(title || ruleId || 'Masalah')}`;
          html += `  </div>`;
          if (description) {
            html += `  <div style="${S.issueDesc}">${escapeHtml(description)}</div>`;
          }
          if (suggestion) {
            html += `  <div style="color:#00d4aa;font-size:0.85rem;margin-top:0.25rem;">${T.issueRec} ${escapeHtml(suggestion)}</div>`;
          }
          const location = [];
          if (issue.file) location.push(issue.file);
          if (issue.line) location.push(`${T.issueLine} ${issue.line}`);
          if (location.length > 0) {
            html += `  <div style="${S.issueMeta}">📁 ${escapeHtml(location.join(', '))}</div>`;
          }
          html += `</div>`;
        });
      });
    }

    // ======== 6. Statistik ========
    html += `<h2 style="${S.h2}">${T.secStat}</h2>`;
    html += `<div style="${S.card}">`;

    const statRows = [
      [T.statModul,   modules.length],
      [T.statModel,   allModels.length || stats.totalModels || 0],
      [T.statField,   fields.length || stats.totalFields || 0],
      [T.statMethod,  methods.length || stats.totalMethods || 0],
      [T.statView,    views.length || stats.totalViews || 0],
      [T.totalRelations,  relationships.length],
      [T.totalMenus,    menus.length || 0],
      [T.statMasalah, issues.length],
      [`${T.statMasalah} ${T.issueSevCritical}`, criticalCount],
      [`${T.statMasalah} ${T.issueSevWarning}`, warningCount],
      [`${T.statMasalah} ${T.issueSevInfo}`,  infoCount],
    ];

    html += `<table style="${S.table}">`;
    html += `<thead><tr><th style="${S.th}">${T.statMetric}</th><th style="${S.th}">${T.statCount}</th></tr></thead><tbody>`;
    statRows.forEach(([label, value]) => {
      html += `<tr><td style="${S.td}">${label}</td><td style="${S.td}"><strong>${value}</strong></td></tr>`;
    });
    html += `</tbody></table>`;

    html += `<div style="margin-top:1rem;">`;
    html += `  <strong style="color:#c4b5fd;">${T.healthBreakdown}</strong>`;
    html += `  <div style="margin-top:0.5rem;background:#12122a;border-radius:8px;overflow:hidden;height:24px;position:relative;">`;
    html += `    <div style="width:${Math.min(healthScore, 100)}%;height:100%;background:linear-gradient(90deg,#7c5cfc,#00d4aa);border-radius:8px;transition:width 0.5s ease;"></div>`;
    html += `    <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:0.75rem;font-weight:600;color:#ffffff;">${healthScore}%</span>`;
    html += `  </div>`;
    html += `  <p style="color:#8888a8;font-size:0.8rem;margin-top:0.5rem;">${T.healthExplanation}</p>`;
    html += `</div>`;

    html += `</div>`; // close card

    const dateOptions = lang === 'en'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = lang === 'en'
      ? new Date().toLocaleDateString('en-US', dateOptions)
      : new Date().toLocaleDateString('id-ID', dateOptions);

    // Footer
    html += `<div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #2a2a4a;color:#6b6b8a;font-size:0.75rem;text-align:center;">`;
    html += `  ${T.footerText} ${dateStr}`;
    html += `</div>`;

    html += `</div>`; // close page wrapper

    return html;
  }

  /**
   * Create a single stat box HTML snippet for the executive summary grid.
   * @private
   */
  function _statBox(S, value, label) {
    return `<div style="${S.statItem}"><div style="${S.statValue}">${value}</div><div style="${S.statLabel}">${label}</div></div>`;
  }

  /**
   * Export analysis result to Excel using SheetJS.
   * Creates a multi-sheet workbook with:
   * 1. Summary (Ringkasan)
   * 2. Issues (Daftar Masalah)
   * 3. Models (Struktur Model)
   * 
   * @param {Object} result - AnalysisResult
   */
  function exportExcel(result) {
    if (!result || typeof XLSX === 'undefined') {
      console.warn('XLSX library not loaded or result empty.');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      const lang = localStorage.getItem('lang') || 'id';

      // --------------------------------------------------------
      // Sheet 1: Summary
      // --------------------------------------------------------
      const summaryRows = [
        [lang === 'en' ? 'Erpura Analysis Summary' : 'Ringkasan Analisis Erpura'],
        [],
        [lang === 'en' ? 'Metric' : 'Metrik', lang === 'en' ? 'Value' : 'Nilai'],
        [lang === 'en' ? 'Health Score' : 'Skor Kesehatan', `${result.stats?.healthScore || 0}/100`],
        [lang === 'en' ? 'Odoo Version Detected' : 'Versi Odoo Terdeteksi', result.stats?.odooVersionDetected || 'N/A'],
        [lang === 'en' ? 'Total Modules' : 'Total Modul', result.stats?.totalModules || 0],
        [lang === 'en' ? 'Total Models' : 'Total Model', result.stats?.totalModels || 0],
        [lang === 'en' ? 'Total Fields' : 'Total Field', result.stats?.totalFields || 0],
        [lang === 'en' ? 'Total Methods' : 'Total Method', result.stats?.totalMethods || 0],
        [lang === 'en' ? 'Total Views' : 'Total View', result.stats?.totalViews || 0],
        [],
        [lang === 'en' ? 'Issues by Severity' : 'Masalah Berdasarkan Tingkat Keparahan', ''],
        [lang === 'en' ? 'Critical' : 'Kritis', result.stats?.issuesBySeverity?.critical || 0],
        [lang === 'en' ? 'Warning' : 'Peringatan', result.stats?.issuesBySeverity?.warning || 0],
        [lang === 'en' ? 'Info' : 'Info', result.stats?.issuesBySeverity?.info || 0],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
      
      // Auto fit columns roughly
      wsSummary['!cols'] = [{ wch: 30 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, lang === 'en' ? 'Summary' : 'Ringkasan');

      // --------------------------------------------------------
      // Sheet 2: Issues
      // --------------------------------------------------------
      const issuesHeaders = lang === 'en'
        ? ['ID', 'Severity', 'Category', 'Title', 'Description', 'File', 'Line', 'Suggestion']
        : ['ID', 'Keparahan', 'Kategori', 'Judul', 'Deskripsi', 'File', 'Baris', 'Saran'];
      
      const issuesRows = [issuesHeaders];
      
      if (Array.isArray(result.issues)) {
        result.issues.forEach(issue => {
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

          issuesRows.push([
            issue.ruleId || issue.id || '',
            issue.severity || '',
            issue.category || '',
            title || '',
            description || '',
            issue.file || '',
            issue.line || '',
            suggestion || ''
          ]);
        });
      }
      
      const wsIssues = XLSX.utils.aoa_to_sheet(issuesRows);
      wsIssues['!cols'] = [
        { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 25 }, 
        { wch: 45 }, { wch: 30 }, { wch: 8 }, { wch: 45 }
      ];
      XLSX.utils.book_append_sheet(wb, wsIssues, lang === 'en' ? 'Issues' : 'Masalah');

      // --------------------------------------------------------
      // Sheet 3: Models Structure
      // --------------------------------------------------------
      const modelsHeaders = lang === 'en'
        ? ['Module', 'Model Name', 'Python Class', 'Inherits From', 'Fields Count', 'Methods Count', 'File']
        : ['Modul', 'Nama Model', 'Python Class', 'Inherit Dari', 'Jumlah Field', 'Jumlah Method', 'File'];

      const modelsRows = [modelsHeaders];

      if (Array.isArray(result.modules)) {
        result.modules.forEach(mod => {
          if (Array.isArray(mod.models)) {
            mod.models.forEach(model => {
              const inherits = Array.isArray(model.inherit)
                ? model.inherit.join(', ')
                : (model.inherit || '');

              modelsRows.push([
                mod.name || '',
                model.name || '',
                model.className || '',
                inherits,
                Array.isArray(model.fields) ? model.fields.length : 0,
                Array.isArray(model.methods) ? model.methods.length : 0,
                model.file || ''
              ]);
            });
          }
        });
      }

      const wsModels = XLSX.utils.aoa_to_sheet(modelsRows);
      wsModels['!cols'] = [
        { wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 25 },
        { wch: 12 }, { wch: 12 }, { wch: 35 }
      ];
      XLSX.utils.book_append_sheet(wb, wsModels, lang === 'en' ? 'Models' : 'Daftar Model');

      // Write File
      XLSX.writeFile(wb, 'Erpura_Analysis_Report.xlsx');
    } catch (err) {
      console.error('[Visualizers] exportExcel error:', err);
      throw err;
    }
  }

  /**
   * Generate a Mermaid flowchart TD representing Odoo module dependencies.
   * 
   * @param {Array} modules - Array of OdooModule objects
   * @returns {string} Mermaid flowchart code.
   */
  function generateModuleDependencyGraph(modules) {
    if (!Array.isArray(modules) || modules.length === 0) {
      return 'flowchart TD\n    A([No Module Data])';
    }

    const lines = ['flowchart TD'];
    const declaredModules = new Set(modules.map(m => m.name));

    // Style variables for nodes
    lines.push('    classDef default fill:#1a1a3e,stroke:#7c5cfc,stroke-width:1px,color:#e8e8f0;');
    lines.push('    classDef external fill:#12122a,stroke:#8888a8,stroke-width:1px,color:#8888a8,stroke-dasharray: 5 5;');

    modules.forEach(mod => {
      const safeName = (mod.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`    ${safeName}[${sanitizeLabel(mod.name)}]`);
      
      const depends = Array.isArray(mod.depends) ? mod.depends : [];
      depends.forEach(dep => {
        const safeDep = dep.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!declaredModules.has(dep)) {
          lines.push(`    ${safeDep}[${sanitizeLabel(dep)}]:::external`);
        }
        lines.push(`    ${safeName} --> ${safeDep}`);
      });
    });

    return lines.join('\n');
  }

  // ============================================================
  // Public API
  // ============================================================
  return {
    generateERDiagram,
    generateStateDiagram,
    generateFlowchart,
    generateMenuTree,
    generateModelClassDiagram,
    renderDiagram,
    generateFullReport,
    postProcessSVG: _postProcessSVG,
    exportExcel,
    generateModuleDependencyGraph
  };

})();
