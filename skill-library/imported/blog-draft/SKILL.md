---
name: blog-draft
description: Draft technical blog post with outline, code samples, SEO metadata, and CTA
version: 0.1.0
execution-mode: advisory
argument-hint: "<topic> [--audience dev|business|mixed] [--length short|medium|long]"
category: sales-marketing
status: candidate
---
# Blog Draft

Draft a technical blog post with a structured outline, inline code samples, SEO metadata (title tag, meta description, keywords), and a call-to-action. Adapts tone and depth based on target audience.

## When to Use
- You need to write a technical blog post about a project, feature, or concept
- You want a structured draft with SEO optimization baked in
- You need to turn internal knowledge into publishable content
- You are building content for a company blog or personal site

## Execution

### 0. Repo hygiene check
Before creating any output file:
1. Identify the target directory (default: `drafts/`)
2. Check if the repo is public: `gh repo view --json isPrivate --jq .isPrivate`
3. If public, verify the target directory is in `.gitignore`
4. If NOT gitignored: add it before writing any files, or warn the user and ask for a different output path
5. Never write confidential content (pitch decks, partner briefs, financial models, outreach targets) to a tracked directory in a public repo

1. Parse `$ARGUMENTS` for topic, audience (dev/business/mixed), and length (short ~500w, medium ~1200w, long ~2500w)
2. Research the topic from available project context, docs, and code
3. **Supadata source gathering** — enrich with live web content:
   ```bash
   export SUPADATA_API_KEY="$(cat ~/supadata\ api.txt | grep sd_)"
   # Scrape competitor/industry blogs for trend context and differentiation angles
   python3 ~/bin/supadata.py scrape "https://competitor.com/blog"
   # Scrape regulatory news if post touches compliance/governance
   python3 ~/bin/supadata.py scrape "https://www.nist.gov/news"
   # Extract transcript from a relevant conference talk or keynote
   python3 ~/bin/supadata.py transcript "https://youtube.com/watch?v=..." --text
   ```
4. Generate SEO metadata: title tag (under 60 chars), meta description (under 160 chars), 5-8 keywords
4. Create outline with hook, sections, code samples, and CTA
5. Draft the full post with appropriate technical depth for the audience
6. Include code samples with language annotations where relevant
7. Add internal/external link suggestions
8. Present the draft with metadata and review notes

## Output Format
```
Blog Draft | <topic>

## SEO Metadata
- Title: <title tag>
- Description: <meta description>
- Keywords: <comma-separated list>
- Slug: <url-friendly-slug>

## Outline
1. Hook / Introduction
2. <Section 1>
3. <Section 2>
4. <Section N>
5. Conclusion + CTA

## Draft
<full blog post content>

## Review Notes
- Audience: <dev|business|mixed>
- Word count: <N>
- Code samples: <N>
- Suggested links: <list>

Next action: <recommendation>
```

## Skill Chains
| After this skill... | Consider... |
|--------------------|-------------|
| Draft needs review | `[content-review]` for accuracy and brand compliance |
| Need SEO validation | `[seo-check]` to audit the published page |
| Promote the post | `[social-post]` to draft social announcements |
