# React First Example

`props-fuzzing` を React 起点で使う最小サンプル。`examples/react-first/test/react-first.example.test.tsx` が executable docs になっていて、主要ユースケースを追える。

- `sampleProps()` で props 値を先に眺める
- `fuzzReactComponent()` で通常の property-based fuzzing を回す
- `createDomRender()` で `useEffect` 由来の例外を拾う
- `createDomRender({ providers })` で Provider props も一緒に fuzz する
- `samplePropsFromSchema()` で Zod schema から直接値を作る
- `fuzzReactComponentGuided()` で corpus を保存しながら guided fuzzing を回す
- `quickCheckReactComponent()` で boundary case を回す

このフォルダは repo 内でそのまま再現できる sample project として `package.json` と `tsconfig.json` も置いている。example test 自体の import は consumer app と同じ `props-fuzzing` で統一してあり、repo 内では Vitest alias で local source に解決する。依存関係は `file:../..` なので、このフォルダ単体で `pnpm install` すれば root のライブラリ実装を使って再現できる。

## Install

```bash
pnpm install
```

前提:

- Node.js `24+`
- ESM (`"type": "module"`)
- example 単体の `pnpm typecheck` は `src/` を対象にする
- 他リポジトリへコピーする場合は `props-fuzzing` の dependency spec を公開先に合わせて差し替える

## Run

repo 内では次で example も含めて検証される。

```bash
pnpm vitest run
```

このフォルダを consumer app として切り出すなら、依存関係を install した上で次を実行する。

```bash
pnpm test
pnpm typecheck
```
