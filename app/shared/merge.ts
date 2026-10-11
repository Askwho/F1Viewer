// F1 live timing sends partial updates. Objects merge deeply; an object with
// numeric keys patches an array by index; a real array replaces wholesale;
// `_deleted` lists keys to drop; `_kf` is a keyframe marker we ignore.
// Shared by the relay and the browser so both build state identically.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function merge(target: any, delta: any): any {
  if (delta === null || typeof delta !== "object") return delta;
  if (Array.isArray(delta)) return delta.map((v) => merge(undefined, v));
  if (target === null || typeof target !== "object") target = {};

  const deleted = delta._deleted;
  if (Array.isArray(deleted)) {
    for (const k of deleted) {
      if (Array.isArray(target)) target.splice(Number(k), 1);
      else delete target[k];
    }
  }

  for (const k in delta) {
    if (k === "_kf" || k === "_deleted") continue;
    if (Array.isArray(target)) {
      const i = Number(k);
      target[i] = merge(target[i], delta[k]);
    } else {
      target[k] = merge(target[k], delta[k]);
    }
  }
  return target;
}
