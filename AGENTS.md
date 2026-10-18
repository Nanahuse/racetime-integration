# Agent Guidelines

## Package Manager
This project uses `pnpm` as its package manager.  
Configuration files for other package managers should not be committed although using tools compatible with `pnpm` is tolerated.

## Commit Messages
Follow [Conventonal Commits](https://www.conventionalcommits.org/) specification.

### Commit relates to issues on GitHub
Add issue numbers at the end of the commit message.  
Example:  
`feat: Add messages to control timer (#5)`

## Comments
These conventions apply to all comments in the codebase.

### Conventions
- Do not write a comment that is obvious from the code.
- Do not write the description of a past implementation after the code changes.

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: `npx openskills read <skill-name>` (run in your shell)
  - For multiple: `npx openskills read skill-one,skill-two`
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>yomiyasu</name>
<description>AIが生成した日本語の推敲に使うスキル。「この文章を読みやすくして」「AIっぽさをなくして」「自然な日本語にして」「文章を脱臭して」といった依頼や、技術記事、仕様書、PR説明文、社内レポート、エッセイ・noteの文章を見直すときに使用する。意味と条件を保ち、不自然な比喩、曖昧な主述関係、不要な装飾やコピー調を整える。</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>
