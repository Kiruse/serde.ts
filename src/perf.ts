//////////////////////////////////////////////////////////////////////
// Submodule for performance measuring
const perf = globalThis.performance;
const measures: Record<string, Measure[]> = {};
let enabled = false;

type Measure = {
  name: string;
  startTime: number;
  duration: number;
  detail?: any;
}

export function measure<R>(name: string, callback: () => R) {
  const t0 = perf?.now() || Date.now();
  try {
    const result = callback();
    const t1 = perf?.now() || Date.now();
    pushMeasure(name, t0, t1);
    return result;
  } catch (err) {
    const t1 = perf?.now() || Date.now();
    pushMeasure(name, t0, t1, err);
    throw err;
  }
}

function pushMeasure(name: string, t0: number, t1: number, detail?: any) {
  if (!enabled) return;
  if (!(name in measures)) measures[name] = [];
  measures[name].push({
    name,
    startTime: t0,
    duration: t1-t0,
    detail,
  });
}

export const enable  = () => {enabled = true};
export const disable = () => {enabled = false};
export const getMeasures = () => measures;
