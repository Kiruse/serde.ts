//////////////////////////////////////////////////////////////////////
// Submodule for performance measuring
const perf = globalThis.performance;
export default perf;
let perfCounter = 0;
let enabled = false;

export function measure<R>(name: string, callback: () => R) {
  const id = perfCounter++;
  const markStart = `${name}-${id}S`;
  const markEnd   = `${name}-${id}E`;
  const active = enabled && perf;
  active && perf.mark(markStart);
  
  try {
    const result = callback();
    active && perf.mark(markEnd);
    return result;
  } catch (err) {
    active && perf.mark(markEnd, { detail: err });
    throw err;
  }
  finally {
    active && perf.measure(`${name}-${id}`, markStart, markEnd);
  }
}

export const enable  = () => {enabled = true};
export const disable = () => {enabled = false};
