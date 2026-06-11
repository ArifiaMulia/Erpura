# 🔍 Erpura — Odoo Code Analyzer & Remediation Platform

**Erpura** is a premium, browser-based Odoo ERP code analysis tool that helps developers and business stakeholders detect security vulnerabilities, deprecated patterns, performance issues, and bad practices in Odoo modules.

## ✨ Features

- **📁 Upload & Analysis**: Drag-and-drop `.py`, `.xml`, `.csv`, or `.zip` files
- **📊 Dashboard**: Health score gauge, issue summaries by severity, detected Odoo version
- **🔄 Business Flow**: Interactive ERD diagrams, state machine visualization, menu hierarchy
  - Color-coded lines based on issue severity (Critical / Warning / Info)
  - Click any line to navigate directly to related issues
- **🔴 Issues & Errors**: Filterable issue list with code snippets and fix suggestions
- **🔧 Code Fixer**: Side-by-side diff view with auto-fix capabilities
- **🧪 Test Bed**: Built-in test module to demonstrate all analysis features
- **📄 Reports**: Export analysis results to PDF, Word (DOCX), or JSON

## 🚀 Quick Start (Local)

```bash
# Serve with any static HTTP server
python -m http.server 8000

# Or use Node's http-server
npx http-server -p 8000
```

Then open **http://localhost:8000** in your browser.

## 🐳 Docker Deployment

```bash
# Build and run with Docker
docker build -t erpura .
docker run -d -p 80:80 erpura

# Or with Docker Compose (Coolify/Traefik)
docker-compose up -d
```

## 🌐 Live Deployment

This app is designed to deploy on **Coolify** with Traefik reverse proxy and automatic Let's Encrypt SSL.

Domain: `https://erpura.virtuenet.space`

## 🎨 Design

- Premium dark theme with glassmorphism
- Bilingual: Indonesian (default) / English
- Google Font: Inter
- Responsive layout

## 📁 Project Structure

```
├── index.html           # Main SPA entry point
├── css/
│   └── styles.css       # Full design system (dark theme, glassmorphism)
├── js/
│   ├── app.js           # Application state, routing, event handling
│   ├── parsers.js       # Odoo Python/XML/CSV file parsers
│   ├── analyzers.js     # Code analysis engine (30+ rules)
│   ├── code-fixer.js    # Auto-fix generator
│   ├── visualizers.js   # Mermaid diagram rendering & reports
│   ├── ui.js            # UI rendering helpers
│   └── test-data.js     # Built-in test module data
├── Dockerfile           # Nginx-based static deployment
├── docker-compose.yml   # Coolify/Traefik production config
└── nginx.conf           # Nginx server configuration
```

## 📋 License

MIT
