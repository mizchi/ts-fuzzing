import fc from "fast-check";

export type StatefulAction<Model, Real, Input = void> = {
  name: string;
  generate?: fc.Arbitrary<Input>;
  precondition?: (model: Model) => boolean;
  apply: (context: { input: Input; model: Model; real: Real }) => void | Promise<void>;
};

export type StatefulFuzzOptions<Model, Real> = {
  actions: ReadonlyArray<StatefulAction<Model, Real, any>>;
  invariant?: (context: { model: Model; real: Real }) => void | Promise<void>;
  maxActions?: number;
  numRuns?: number;
  perRunTimeoutMs?: number;
  seed?: number;
  setup: () => { model: Model; real: Real } | Promise<{ model: Model; real: Real }>;
  timeoutMs?: number;
};

export type StatefulTraceEntry = {
  action: string;
  input?: unknown;
};

export class StatefulFuzzError extends Error {
  cause: unknown;
  failingTrace: StatefulTraceEntry[];
  seed: number | undefined;

  constructor(
    message: string,
    options: {
      cause: unknown;
      failingTrace: StatefulTraceEntry[];
      seed?: number;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "StatefulFuzzError";
    this.cause = options.cause;
    this.failingTrace = options.failingTrace;
    this.seed = options.seed;
  }
}

export const fuzzStateful = async <Model, Real>(
  options: StatefulFuzzOptions<Model, Real>,
): Promise<void> => {
  if (options.actions.length === 0) {
    throw new Error("fuzzStateful requires at least one action");
  }

  const maxActions = options.maxActions ?? 10;
  const numRuns = options.numRuns ?? 50;

  const stepArbitrary = fc
    .integer({ min: 0, max: options.actions.length - 1 })
    .chain((actionIndex) => {
      const action = options.actions[actionIndex];
      const generate = action.generate ?? (fc.constant(undefined) as fc.Arbitrary<unknown>);
      return generate.map((input) => ({ actionIndex, input }));
    });

  const traceArbitrary = fc.array(stepArbitrary, { minLength: 0, maxLength: maxActions });

  let failingTrace: StatefulTraceEntry[] = [];
  let lastError: unknown;

  try {
    await fc.assert(
      fc.asyncProperty(traceArbitrary, async (steps) => {
        const { model, real } = await options.setup();
        const trace: StatefulTraceEntry[] = [];
        try {
          for (const step of steps) {
            const action = options.actions[step.actionIndex];
            if (action.precondition && !action.precondition(model)) {
              continue;
            }
            const entry: StatefulTraceEntry =
              action.generate === undefined
                ? { action: action.name }
                : { action: action.name, input: step.input };
            trace.push(entry);
            await action.apply({ input: step.input, model, real });
            if (options.invariant) {
              await options.invariant({ model, real });
            }
          }
          failingTrace = [];
        } catch (error) {
          lastError = error;
          failingTrace = trace;
          throw error;
        }
      }),
      {
        endOnFailure: true,
        interruptAfterTimeLimit: options.timeoutMs,
        markInterruptAsFailure: false,
        numRuns,
        seed: options.seed,
        timeout: options.perRunTimeoutMs,
      },
    );
  } catch (error) {
    throw new StatefulFuzzError("stateful fuzzing failed", {
      cause: lastError ?? error,
      failingTrace,
      seed: options.seed,
    });
  }
};
