# @mizchi/props-fuzzing

React component の props 型から値を生成し、render で例外を吐かないかを fuzz する小さなライブラリ。

現状は 2 つのモードを持つ。

- property-based fuzzing: `fast-check` ベース。seed 固定と shrinking が効く
- experimental coverage-guided fuzzing: Node/V8 の precise coverage を見ながら corpus を増やす

## Install

```bash
pnpm add react react-dom
pnpm add -D @mizchi/props-fuzzing
```

## Quick Start

```tsx
import { fuzzReactComponent } from "@mizchi/props-fuzzing";
import { Button } from "./Button.js";

await fuzzReactComponent({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  numRuns: 200,
  seed: 42,
});
```

失敗時は `ReactComponentFuzzError` を投げる。

```ts
try {
  await fuzzReactComponent({
    component: Button,
    sourcePath: new URL("./Button.tsx", import.meta.url),
    exportName: "Button",
    seed: 42,
  });
} catch (error) {
  if (error instanceof ReactComponentFuzzError) {
    console.error(error.failingProps);
    console.error(error.seed);
  }
}
```

## Guided Mode

```tsx
import { fuzzReactComponentGuided } from "@mizchi/props-fuzzing";

const report = await fuzzReactComponentGuided({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  initialCorpusSize: 8,
  maxIterations: 100,
  seed: 7,
});

console.log(report);
// { corpusSize, discoveries, discoveredBlocks, iterations }
```

これは libFuzzer/Jazzer.js 相当の完全な instrumentation fuzzing ではない。`node:inspector` から `Profiler.startPreciseCoverage` / `takePreciseCoverage` を叩き、型に沿った mutation で corpus を育てる軽量版。

`report.discoveries` には coverage を増やした入力、または failure 時の入力が入る。

```ts
for (const discovery of report.discoveries) {
  console.log(discovery.reason, discovery.newBlocks, discovery.input);
}
```

## Quick Check

ランダム fuzzing とは別に、境界値中心の `quick-check` も使える。

```tsx
import { quickCheckReactComponent } from "@mizchi/props-fuzzing";

await quickCheckReactComponent({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  maxCases: 64,
});
```

内部では型から有限個の境界値ケースを作って順に render する。失敗時の `report` には `checkedCases` と `totalCases` が入る。

境界値ケースだけ欲しい場合は `sampleBoundaryProps()` を使う。

```ts
const cases = await sampleBoundaryProps({
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  maxCases: 32,
});
```

## DOM Runner

hook や effect 内の例外を拾いたい場合は `createDomRender()` を使う。

```tsx
import { createDomRender, fuzzReactComponent } from "@mizchi/props-fuzzing";
import { Widget } from "./Widget.js";

await fuzzReactComponent({
  component: Widget,
  sourcePath: new URL("./Widget.tsx", import.meta.url),
  exportName: "Widget",
  render: createDomRender(),
  numRuns: 100,
  seed: 1,
});
```

内部では `jsdom` と `@testing-library/react` を使って mount/unmount する。`renderToStaticMarkup` では拾えない `useEffect` 起因のクラッシュ検出向け。

Provider が必要なら `wrapper` を渡せる。

```tsx
render: createDomRender({
  wrapper: ({ children }) => <ThemeProvider theme="dark">{children}</ThemeProvider>,
})
```

Provider 自体の props も fuzz したいなら `providers` を使う。順序は outer -> inner。

```tsx
render: createDomRender({
  providers: [
    {
      key: "themeProvider",
      component: ThemeProvider,
      sourcePath: new URL("./ThemeProvider.tsx", import.meta.url),
      exportName: "ThemeProvider",
    },
  ],
})
```

この場合、fuzzer は内部的に次のような入力を生成する。

```ts
{
  props: { ...componentProps },
  providers: {
    themeProvider: { ...providerProps },
  },
}
```

`fixedProps` を渡すと、その key は fuzz 対象から外れて render 時に固定値でマージされる。

```tsx
render: createDomRender({
  providers: [
    {
      key: "themeProvider",
      component: ThemeProvider,
      sourcePath: new URL("./ThemeProvider.tsx", import.meta.url),
      exportName: "ThemeProvider",
      fixedProps: { locale: "ja-JP" },
    },
  ],
})
```

## Persistent Corpus

guided mode は corpus を JSON に保存できる。CI やローカルで少しずつ corpus を育てたいとき向け。

```tsx
await fuzzReactComponentGuided({
  component: Button,
  sourcePath: new URL("./Button.tsx", import.meta.url),
  exportName: "Button",
  corpusPath: new URL("./.props-fuzzing/button-corpus.json", import.meta.url),
  initialCorpusSize: 8,
  maxIterations: 100,
  seed: 7,
});
```

`function` と `undefined` を含む props も保存できるように、JSON では最小限の marker を使っている。

## Fuzz Tags

TypeScript の型だけでは長さ・範囲・件数まで取り切れないので、最小限の comment tag を追加している。

```ts
type Props = {
  /**
   * @fuzz.minLength 1
   * @fuzz.maxLength 16
   */
  label: string;

  /**
   * @fuzz.min 0
   * @fuzz.max 10
   */
  count?: number;

  /**
   * @fuzz.minItems 1
   * @fuzz.maxItems 4
   */
  items: string[];

  /**
   * @fuzz.pattern email
   */
  email: string;
};
```

サポートしている tag:

- `@fuzz.min`
- `@fuzz.max`
- `@fuzz.minLength`
- `@fuzz.maxLength`
- `@fuzz.minItems`
- `@fuzz.maxItems`
- `@fuzz.pattern`

`@fuzz.pattern` は正規表現文字列に加えて、いまは `email` と `url` も domain-aware に扱う。

## What It Handles

- function component の第一引数 props
- `string` / `number` / `boolean`
- literal union
- array / tuple
- object
- optional props
- function props
- `ReactNode` の簡易生成
- intersection object の単純 merge

function props は no-op 関数へ落とす。`ReactNode` は `null | string | number | boolean` に縮約して生成する。

## Design

`props-fuzzing` は TypeScript compiler API で props 型を直接読む。JSON Schema を主経路にしなかった理由は、React props に callback や `ReactNode` が混ざるため。

設計の流れ:

1. `sourcePath` と `exportName` から component symbol を見つける
2. 第一引数 props の型を `TypeChecker` で辿る
3. 独自の `TypeDescriptor` に落とす
4. property-based では `fast-check` Arbitrary に変換する
5. guided mode では同じ `TypeDescriptor` から generator / mutator を組む
6. default render は `renderToStaticMarkup` を使う

## Why This Shape

型から値を得る方法は大きく 4 系統ある。

1. compiler API を直接使う
2. TS -> JSON Schema -> generator に変換する
3. transformer/AOT で generator を埋め込む
4. runtime reflection metadata を埋め込む

このライブラリでは 1 を選んだ。

- 2 はデータ形状には強いが、callback props や `ReactNode` の扱いで追加ルールが必要
- 3 は強力だが、transformer 導入を利用側に要求しやすい
- 4 も有力だが、同様に metadata 生成のための build step 依存が増える

推論:
`ts-json-schema-generator` と `JSON Schema Faker` の組み合わせ、あるいは `typia.random<T>()` ベースの実装も十分成立する。ただしこの repo では「Vitest 上ですぐ使える」「transformer 必須にしない」を優先した。

## Testing Strategy

React component の props fuzzing では、単一手法に寄せない方がいい。

- example-based test: 既知仕様を固定する
- property-based fuzzing: 型を満たす入力空間を広く回す
- coverage-guided fuzzing: 分岐未到達の入力を寄せていく
- differential / metamorphic test: 複数 renderer や invariant があるときに効く

このライブラリが今実装しているのは 2 と、軽量な 3。

## Limitations

- class component は未対応
- default render は `renderToStaticMarkup` なので effect 系は拾えない
- DOM runner を使うと effect 系は拾えるが、ブラウザ API の完全再現ではない
- exact な domain constraint は comment tag か custom render 側の guard が必要
- guided mode は軽量版で、libFuzzer/Jazzer.js の mutation engine や sanitizer integration は持たない
- persisted corpus は JSON ベースなので class instance の完全復元はしない
- recursive type の扱いはまだ保守的

## Future Work

- `@testing-library/react` / jsdom runner
- custom mutator hook
- component 単位ではなく module / story 単位の corpus 保存
- branch novelty だけでなく error novelty も score に入れる
- class component / memo / forwardRef への対応

## Research Notes

property-based 側は `fast-check` を採用した。理由は seed 指定・複数 run・shrinking が揃っていて、Vitest のような任意 test runner 上で動かしやすいから。  
Source: https://fast-check.dev/docs/introduction/getting-started/

coverage-guided fuzzing の基本モデルは libFuzzer を参照した。in-process 実行、coverage を見ながら corpus を育てる、初期 corpus が重要、という構図がそのまま使える。  
Source: https://bcain-llvm.readthedocs.io/projects/llvm/en/release_37/LibFuzzer/

JavaScript/Node 側の近い先行例として Jazzer.js がある。これは libFuzzer ベースの coverage-guided, in-process fuzzer として設計され、Jest 統合も持っていた。  
Source: https://github.com/CodeIntelligenceTesting/jazzer.js

coverage の取り方は Chrome DevTools Protocol の `Profiler.startPreciseCoverage` / `takePreciseCoverage` を参照した。`takePreciseCoverage` が実行カウンタを reset するので、各 trial ごとの差分が取りやすい。  
Source: https://chromedevtools.github.io/devtools-protocol/tot/Profiler/

TypeScript type から値を得る別案としては `typia.random<T>()` がある。constraint tags を使える AOT generator でかなり魅力的だったが、transformer 前提になる。  
Sources:
- https://typia.io/docs/random/
- https://typia.io/

TS -> schema 変換案としては `ts-json-schema-generator` があり、`interface`, `enum`, `union`, `tuple`, `type[]`, literal, generics, conditional types, functions などを扱える。データ指向の props ならこのルートは強い。  
Source: https://github.com/vega/ts-json-schema-generator

schema から値生成する側では `JSON Schema Faker` があり、`$ref`, arrays, regex patterns, seed 指定まで揃っている。これは別 backend として将来差し替え可能。  
Source: https://json-schema-faker.js.org/

runtime reflection 案としては `typescript-rtti` のような transformer もある。interface / union / intersection / tuple などの reflection が可能で、将来の backend 候補。  
Source: https://www.npmjs.com/package/typescript-rtti

補足:
依頼に含まれていた Pierre Zemb の記事 URL はこの実装時点で直接取得できなかったため、coverage-guided 部分は libFuzzer, CDP Profiler, Jazzer.js の一次情報を優先して設計した。

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
