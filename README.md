# ironoxlint

![ironoxlint logo](https://raw.githubusercontent.com/StephanOrgiazzi/ironoxlint/master/assets/logo/ironoxlint-logo.svg)

`ironoxlint` is a strict, opinionated linting setup that helps AI agents write maintainable, production-grade code.

Most repos are hard for agents (and developers) for one reason: too many unwritten conventions.
Rules live in people’s heads, feedback comes late, and structure is inconsistent.

`ironoxlint` fixes that with one goal: make your codebase predictable, navigable, and machine-checkable.

- Opinionated strict rules for readability and maintainability
- Fast local feedback (`lint` + `format`) without waiting for CI
- One-step adoption, minimal setup friction

Use it to make your repo easier to scale with humans and agents alike.

## One-step Setup

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
    "lint": "oxlint . -c ./node_modules/ironoxlint/oxlint/strict-react.json --ignore-path .gitignore && oxfmt . -c ./node_modules/ironoxlint/oxfmt/strict.mjs --check --ignore-path .gitignore",
    "format": "oxlint . -c ./node_modules/ironoxlint/oxlint/strict-react.json --fix --ignore-path .gitignore && oxfmt . -c ./node_modules/ironoxlint/oxfmt/strict.mjs --ignore-path .gitignore"
  }
}
```

It also ensures `ironoxlint` is added to `devDependencies` and installed in your project.

If `lint` or `format` already exist, they are not overwritten unless you run:

```bash
npx ironoxlint init --force
```

## Publish

```bash
bun publish --access public
```
