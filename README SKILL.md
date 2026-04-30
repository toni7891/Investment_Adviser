---
name: readme
description: >
  Create professional, structured README.md files for software projects. Use this skill whenever
  the user asks to write, generate, or create a README, project documentation, or a markdown
  project overview. Also trigger when the user provides a project description, codebase, or tech
  stack and wants polished documentation for it. The output should always be a downloadable .md
  file. Trigger even for casual requests like "make me a readme for this" or "document my project"
  — this skill defines the exact structure, formatting conventions, and all required sections to
  match a high-quality, real-world README standard.
---

# README Skill

Produces polished, professional `README.md` files for software projects — matching the structure
and style of high-quality real-world project documentation.

---

## Workflow

1. **Gather info** — Ask the user for: project name, language/framework, database, key features,
   any existing folder structure, license type, and whether they want a Contributing section.  
   If the user provides an existing codebase, README, or tech stack description, extract as much
   info as possible from it before asking clarifying questions.
2. **Draft the README** — Follow the structure below top-to-bottom.
3. **Write to file** — Save to `/mnt/user-data/outputs/<project-name>-README.md`
4. **Present** — Use `present_files` to share the file with the user.

---

## Document Structure

Every README must follow this exact section order:

### 1. Banner

Wrap in `<div align="center">`:

- A decorative banner image via `https://placehold.co/`:  
  `https://placehold.co/900x200/<bg-hex>/<text-hex>?text=<ProjectName>&font=montserrat`  
  Use dark/moody backgrounds (e.g. `1a1a2e`, `0d1117`, `1e1e2e`) with white text.
- Project name as `# ⚡ <Project Name>` (swap ⚡ for a relevant emoji if appropriate)
- Short tagline in `###` — lead with the value proposition
- Badge row using `shields.io` badges (`style=for-the-badge`) for:
  - Language + version
  - Framework + version
  - Database / key dependencies
  - License
  - PRs Welcome (if open source)

---

### 2. Table of Contents

Markdown anchor links to all major sections:

```markdown
## 📖 Table of Contents
- [Tech Stack](#-tech-stack)
- [Key Features](#-key-features)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [License](#-license)
```

---

### 3. Tech Stack Table

Markdown table with columns: **Layer** | **Technology** | **Version**

Example rows: Language, Framework, Database, Cloud provider, key libraries (TLS/certs, env
management, testing, WSGI, etc.)

---

### 4. Key Features

Bulleted list of 6–10 features. Each bullet:

- Starts with a **bolded feature name** followed by em dash `—`
- Contains one sentence explaining what it does and why it matters
- Covers: architecture pattern, database integration, error handling, CRUD ops, validation,
  serialization, config management, testing

---

### 5. Getting Started

#### Prerequisites
Bulleted list of required tools (language runtime, package manager, external services) with hyperlinks.

#### Installation
Numbered steps with fenced `bash` code blocks:
1. Clone the repo
2. Create and activate a virtual environment (with OS variants: macOS/Linux vs Windows)
3. Install dependencies
4. Configure environment variables (`.env` file with example values)

Include a `> ⚠️` callout warning never to commit `.env`.

Add a `<details>` collapsible **Troubleshooting** block covering common failure modes
(connection errors, module not found, etc.)

#### Run the App
Short bash snippet + the resulting localhost URL.

#### Run Tests
Short bash snippet using the project's test runner.

---

### 6. Usage

Intro line stating the API base path and content type.

#### Endpoints Overview Table
Columns: **Method** | **Endpoint** | **Description** — list all CRUD routes.

#### Per-Endpoint Examples
For each endpoint:
- `###` heading with HTTP method and path
- `curl` bash example
- **Response** with HTTP status and fenced JSON block

#### Error Responses
Show the standard error JSON shape the API returns.

---

### 7. Architecture

#### Folder Structure
Fenced `text` block showing the directory tree with inline comments (`#`, `#   ↳` for sub-items).

Use emojis: `📄` for files, `📁` for directories.

#### Request Flow
ASCII art diagram of the request lifecycle:

```
HTTP Request → app.py → Blueprint routes → models/logic → database → JSON Response
```

Include error-handler interception in the diagram.

---

### 8. Contributing *(optional but standard)*

A `<details>` collapsible with **Code Style Guidelines** — bullet points covering naming
conventions, function responsibilities, error handling patterns, type hints, and docstrings.

---

### 9. Footer

Centered `<div align="center">`:
- One fun/personal tagline line (e.g. "Made with ☕ and…")
- Star CTA: `⭐ **If this project helped you, consider giving it a star!** ⭐`
- Credit line: `Built with 💻 by [Author Name](https://github.com/author)`

---

## Formatting Rules

| Rule | Detail |
|------|--------|
| Section separators | `---` horizontal rule between every major section |
| Section emoji headings | `## 🛠 Tech Stack`, `## ✨ Key Features`, `## 🚀 Getting Started`, `## 💡 Usage`, `## 🏗 Architecture` |
| Code blocks | Triple-backtick fences with a language tag (`bash`, `json`, `env`, `text`) |
| Collapsibles | HTML `<details>` + `<summary>` with a relevant emoji and **bold text** |
| Badges | `shields.io`-compatible URLs with `style=for-the-badge` |
| Banner font | `montserrat` via `placehold.co` |
| Cleanliness | No trailing spaces; consistent blank lines between sections |
