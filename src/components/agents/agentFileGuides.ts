// Guide content imports (from MD files)
import identityGuide from '../../templates/guides/IDENTITY.md?raw';
import agentsGuide from '../../templates/guides/AGENTS.md?raw';
import soulGuide from '../../templates/guides/SOUL.md?raw';
import memoryGuide from '../../templates/guides/MEMORY.md?raw';
import userGuide from '../../templates/guides/USER.md?raw';
import bootstrapGuide from '../../templates/guides/BOOTSTRAP.md?raw';
import heartbeatGuide from '../../templates/guides/HEARTBEAT.md?raw';
import toolsGuide from '../../templates/guides/TOOLS.md?raw';

// Template content imports (existing)
import identityTemplate from '../../templates/file-templates/IDENTITY.md?raw';
import agentsTemplate from '../../templates/file-templates/AGENTS.md?raw';
import soulTemplate from '../../templates/file-templates/SOUL.md?raw';
import memoryTemplate from '../../templates/file-templates/MEMORY.md?raw';
import userTemplate from '../../templates/file-templates/USER.md?raw';
import bootstrapTemplate from '../../templates/file-templates/BOOTSTRAP.md?raw';
import heartbeatTemplate from '../../templates/file-templates/HEARTBEAT.md?raw';
import toolsTemplate from '../../templates/file-templates/TOOLS.md?raw';

export interface FileGuide {
  title: string;
  subtitle: string;
  purpose: string;
  updateFrequency: string;
  sections: { heading: string; content: string }[];
  template: string;
  tips: string[];
}

function parseGuideMarkdown(raw: string, template: string): FileGuide {
  // Extract frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const fmRaw = fmMatch?.[1] ?? '';
  const body = (fmMatch?.[2] ?? raw).trim();

  const fm: Record<string, string> = {};
  for (const line of fmRaw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  // Split body by ## headings
  const parts = body.split(/^## /m).filter(Boolean);
  let purpose = '';
  const sections: { heading: string; content: string }[] = [];
  const tips: string[] = [];

  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const content = (nl === -1 ? '' : part.slice(nl + 1)).trim();

    if (heading === '用途') {
      purpose = content;
    } else if (heading === '使用建议') {
      for (const line of content.split('\n')) {
        const m = line.match(/^-\s+(.+)/);
        if (m) tips.push(m[1].trim());
      }
    } else {
      sections.push({ heading, content });
    }
  }

  return {
    title: fm.title ?? '',
    subtitle: fm.subtitle ?? '',
    purpose,
    updateFrequency: fm.updateFrequency ?? '',
    sections,
    template,
    tips,
  };
}

export const FILE_GUIDES: Record<string, FileGuide> = {
  'IDENTITY.md':  parseGuideMarkdown(identityGuide,  identityTemplate),
  'AGENTS.md':    parseGuideMarkdown(agentsGuide,    agentsTemplate),
  'SOUL.md':      parseGuideMarkdown(soulGuide,      soulTemplate),
  'MEMORY.md':    parseGuideMarkdown(memoryGuide,    memoryTemplate),
  'USER.md':      parseGuideMarkdown(userGuide,      userTemplate),
  'BOOTSTRAP.md': parseGuideMarkdown(bootstrapGuide, bootstrapTemplate),
  'HEARTBEAT.md': parseGuideMarkdown(heartbeatGuide, heartbeatTemplate),
  'TOOLS.md':     parseGuideMarkdown(toolsGuide,     toolsTemplate),
};

export const ALL_FILE_NAMES = Object.keys(FILE_GUIDES);
