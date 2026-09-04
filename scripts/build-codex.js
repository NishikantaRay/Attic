#!/usr/bin/env node
'use strict';
/**
 * build-codex.js — generate the Codex distribution from the Claude Code source.
 *
 * The skills are the same text. What differs between hosts:
 *   - the variable naming the skill's own directory
 *     (CLAUDE_SKILL_DIR vs CODEX_SKILL_DIR)
 *   - frontmatter fields Codex does not read (allowed-tools,
 *     disable-model-invocation, argument-hint), which are stripped so a
 *     strict parser cannot trip on them
 *   - hooks.json needs Codex's feature flag documented alongside it
 *
 * Layout:
 *   skills/, hooks/       the single source of truth, shared with Claude Code
 *   scripts/codex/        the two hand-written Codex-only files (launcher, installer)
 *   codex/                GENERATED output, committed so users can clone and install
 *
 * Never hand-edit codex/. Run `npm run build:codex` after changing a skill.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'skills');
const OUT = path.join(ROOT, 'codex');

// Codex reads name and description; the rest are Claude Code's.
const DROP_FIELDS = ['allowed-tools', 'disable-model-invocation', 'argument-hint', 'user-invocable'];

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1], body: m[2] };
}

function portFrontmatter(fm) {
  const lines = fm.split('\n');
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    const key = (line.match(/^([a-zA-Z-]+):/) || [])[1];
    if (key) {
      dropping = DROP_FIELDS.includes(key);
      if (dropping) continue;
      kept.push(line);
    } else if (!dropping) {
      kept.push(line); // continuation of a folded value
    }
  }
  return kept.join('\n');
}

// One line that finds attic.js in every layout Codex can install to:
// the plugin cache (newest version), a user skills dir, or a repo-local
// .agents/skills. Codex shows the model no absolute skill path, so the
// skill has to locate its own script.
const RESOLVER = 'ATTIC_JS=$(ls -d "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/attic/attic/*/skills/attic/scripts/attic.js "${CODEX_HOME:-$HOME/.codex}"/skills/attic/scripts/attic.js "$HOME"/.agents/skills/attic/scripts/attic.js .agents/skills/attic/scripts/attic.js 2>/dev/null | sort -V | tail -1)';

function portBody(body) {
  let out = body
    .replace(/node "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/scripts\/attic-stats\.js"/g, 'node "$(dirname "$ATTIC_JS")/../../../scripts/attic-stats.js"')
    .replace(/node "\$\{CLAUDE_SKILL_DIR\}[^"]*attic\.js"/g, 'node "$ATTIC_JS"')
    .replace(/\$\{CLAUDE_SKILL_DIR\}\/\.\.\/attic\//g, '$(dirname "$ATTIC_JS")/../')
    .replace(/\$\{CLAUDE_SKILL_DIR\}\//g, '$(dirname "$ATTIC_JS")/../')
    .replace(/\bCLAUDE_PROJECT_DIR\b/g, 'CODEX_PROJECT_DIR');
  if (out.includes('$ATTIC_JS')) {
    // Put the resolver where the model will read it before any command.
    out = out.replace(/^(# [^\n]+\n)/m, `$1\nFirst, in the same shell command as anything below, locate the script:\n\n\`\`\`bash\n${RESOLVER}\n\`\`\`\n`);
  }
  return out;
}

// Development-only directories. Nothing reads these at runtime, and the
// recorded results are measured against a specific host, so they stay behind.
const SKIP_DIRS = new Set(['evals']);

function copyTree(from, to, transform) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst, transform);
    else if (entry.name.endsWith('.md') && transform) fs.writeFileSync(dst, transform(fs.readFileSync(src, 'utf8')));
    else fs.copyFileSync(src, dst);
  }
}

function portSkill(raw) {
  const { fm, body } = splitFrontmatter(raw);
  if (!fm) return portBody(raw);
  return `---\n${portFrontmatter(fm)}\n---\n${portBody(body)}`;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const skillsOut = path.join(OUT, 'skills');
  fs.mkdirSync(skillsOut, { recursive: true });

  const names = fs.readdirSync(SRC).filter((d) => fs.existsSync(path.join(SRC, d, 'SKILL.md')));
  for (const name of names) {
    copyTree(path.join(SRC, name), path.join(skillsOut, name), portSkill);
  }

  // Installer ships alongside the payload.
  const inst = path.join(__dirname, 'codex', 'install.sh');
  if (fs.existsSync(inst)) {
    fs.copyFileSync(inst, path.join(OUT, 'install.sh'));
    fs.chmodSync(path.join(OUT, 'install.sh'), 0o755);
  }

  // The launcher that puts `attic` on PATH.
  const binSrc = path.join(__dirname, 'codex', 'bin');
  if (fs.existsSync(binSrc)) {
    copyTree(binSrc, path.join(OUT, 'bin'), null);
    fs.chmodSync(path.join(OUT, 'bin', 'attic'), 0o755);
  }

  // attic-stats.js lives outside skills/, so ship it alongside.
  fs.mkdirSync(path.join(OUT, 'scripts'), { recursive: true });
  for (const f of ['attic-stats.js', 'attic-merge.js']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(OUT, 'scripts', f));
  }

  // Hooks are shared verbatim: the stdin/stdout contract matches.
  copyTree(path.join(ROOT, 'hooks'), path.join(OUT, 'hooks'), null);

  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const ported = JSON.parse(JSON.stringify(hooksJson).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '${ATTIC_HOME}'));
  ported.description = 'Attic hooks for Codex. Set ATTIC_HOME to the directory holding hooks/. Requires [features] hooks = true in config.toml.';
  fs.writeFileSync(path.join(OUT, 'hooks', 'hooks.json'), JSON.stringify(ported, null, 2) + '\n');

  // Native Codex plugin packaging. `codex plugin add` installs this directory
  // as a plugin: skills from ./skills, hooks from ./hooks.json with commands
  // resolved relative to the plugin root. No ${ATTIC_HOME}, no manual merge.
  const claudeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  fs.mkdirSync(path.join(OUT, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(OUT, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'attic',
    version: claudeManifest.version,
    description: claudeManifest.description.replace(/^Offloads context\. Claude stashes/, 'Offloads context. Stashes'),
    author: claudeManifest.author,
    homepage: claudeManifest.homepage,
    repository: claudeManifest.repository,
    license: claudeManifest.license,
    keywords: claudeManifest.keywords,
    skills: './skills/',
    interface: {
      displayName: 'Attic',
      shortDescription: 'Offload context into .attic/ so it survives compaction and new sessions',
      longDescription: 'Stashes findings, decisions and long outputs into a project-local .attic/ folder and keeps only a one-line index in the conversation. The live context stays lean and what matters survives /compact, /clear and new sessions.',
      developerName: claudeManifest.author.name,
      category: 'Developer Tools',
      capabilities: ['Read', 'Write'],
      websiteURL: claudeManifest.homepage,
    },
  }, null, 2) + '\n');
  const pluginHooks = JSON.parse(JSON.stringify(hooksJson).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '.'));
  delete pluginHooks.description;
  fs.writeFileSync(path.join(OUT, 'hooks.json'), JSON.stringify(pluginHooks, null, 2) + '\n');

  fs.writeFileSync(path.join(OUT, 'GENERATED'), [
    'This directory is generated by scripts/build-codex.js.',
    'Edit skills/ and hooks/ at the repository root, then run:',
    '',
    '  npm run build:codex',
    '',
    'Hand edits here are overwritten.',
    '',
  ].join('\n'));

  console.log(`codex/: ${names.length} skills + hooks + .codex-plugin manifest (evals excluded)`);
  return names;
}

if (require.main === module) main();
module.exports = { portSkill, portFrontmatter, portBody };
