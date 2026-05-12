test:
    pnpm vitest run

test-watch:
    pnpm vitest watch

build:
    pnpm tsc -p tsconfig.build.json

typecheck:
    pnpm tsc --noEmit -p tsconfig.json

# Run typecheck + test + build for the main package.
verify:
    pnpm verify

# Install dependencies for every standalone example.
examples-install:
    pnpm examples:install

# Run vitest + typecheck for every standalone example.
verify-examples:
    pnpm verify:examples

# Run the full verification matrix (main package + every example).
verify-all:
    pnpm verify:all
