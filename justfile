test:
    pnpm vitest run

test-watch:
    pnpm vitest watch

build:
    pnpm tsc -p tsconfig.build.json

typecheck:
    pnpm tsc --noEmit -p tsconfig.json
