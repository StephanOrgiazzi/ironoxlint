# ironoxlint

![ironoxlint logo](https://raw.githubusercontent.com/StephanOrgiazzi/ironoxlint/master/assets/logo/ironoxlint-logo.svg)

`ironoxlint` is a strict, opinionated Oxlint/Oxfmt setup for TypeScript projects.

It gives a project fast, shared defaults for code quality and formatting without
copying lint config between repos.

- Strict TypeScript-focused Oxlint rules for readability and maintainability
- Fast local feedback through `lint`
- One explicit formatting command through `format`
- Local Oxlint/Oxfmt config files can narrow behavior when a project needs it

## Setup

```bash
npx ironoxlint init
```

Alternative with Bun:

```bash
bunx ironoxlint init
```

Then run:

```bash
npm run lint
npm run format
```

`ironoxlint init` adds or merges these scripts into your `package.json`:

```json
{
  "scripts": {
    "lint": "ironoxlint lint",
    "format": "ironoxlint format"
  }
}
```

It also ensures `ironoxlint` is added to `devDependencies` and installed in your project.

If `lint` or `format` already exist, they are not overwritten unless you run:

```bash
npx ironoxlint init --force
```

## Local Overrides

IronOx runs Oxlint through its wrapper so bundled plugin dependencies resolve reliably.

If a project needs a narrow Oxlint override, add `.oxlintrc.json`, `.oxlintrc.jsonc`,
`oxlint.config.json`, or `oxlint.config.jsonc` at the project root. The wrapper loads
IronOx's strict config first and the local config second.

For formatting, `ironoxlint format` uses a project-local Oxfmt config when present,
otherwise it falls back to IronOx's empty Oxfmt config and Oxfmt defaults.

## Publish

```bash
bun publish --access public
```
