Create a zero-dependency Node.js requirements tracker project in the current directory.

Requirements:
- Use CommonJS or ESM consistently; choose the simplest style for Node.js built-ins and node:test.
- Create package.json with scripts:
  - "test": runs the node:test suite.
  - "demo": runs a short CLI demo that lists the sample requirements.
- Create README.md with concise usage instructions.
- Create requirements.json with three sample requirements. Each item must have id, title, and completed fields.
- Create src/requirements.js exporting:
  - listRequirements()
  - addRequirement(title)
  - toggleRequirement(id)
- Create bin/reqs.js CLI supporting:
  - list
  - add <title>
  - toggle <id>
- The CLI must read/write requirements.json in the project root.
- Add node:test tests for listing, adding, and toggling requirements.
- Run the tests and fix any failures.

Keep the project zero-dependency and do not use network access.
