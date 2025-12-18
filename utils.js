import pkg from 'cancelable-promise';
const { CancelablePromise } = pkg;
import fs from 'node:fs';
import path from 'node:path';

export const log = (arg, ...args) => (!log.off && console.log(arg, ...args), arg);

export const parseJson = data => {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

function is(x, y) {
  if (x === y) {
    return x !== 0 || y !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}

export function shallowEqual(objA, objB) {
  if (is(objA, objB))
    return true;

  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) return false;

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length)
    return false;

  for (let i = 0; i < keysA.length; i++) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, keysA[i]) ||
      !is(objA[keysA[i]], objB[keysA[i]])
    ) return false;
  }

  return true;
}

export function shallowEqualAll(all1, all2) {
  if (!Array.isArray(all1) || !Array.isArray(all2) || all1.length !== all2.length)
    return false;
  for (let i = 0; i < all1.length; i++)
    if (!shallowEqual(all1[i], all2[i]))
      return false;
  return true;
}

export const once = (
  emitter,
  event,
  check,
  transform,
) => {
  const simple = !check && !transform;
  if (simple) {
    return new CancelablePromise((resolve, reject, onCancel) => {
      emitter.once(event, resolve);
      onCancel(() => {
        emitter.off(event, resolve);
        reject();
      });
    });
  }
  else {
    return new CancelablePromise((resolve, reject, onCancel) => {
      const listen = (...args) => {
        if (!check || check(...args)) {
          emitter.off('error', reject);
          resolve(transform ? transform(...args) : args[0]);
        }
        else emitter.once(event, listen);
      };
      emitter.once(event, listen);
      emitter.once('error', reject);
      onCancel(() => {
        emitter.off(event, listen);
        emitter.off('error', reject);
      });
    });
  }
};

export const subscribe = (
  emitter,
  event, func,
  ...morelisteners
) => {
  if (!morelisteners.length) {
    emitter.on(event, func);
    return () => emitter.off(event, func);
  }
  const unsubbers = [() => emitter.off(event, func)];
  for (let i = 0; morelisteners[i + 1]; i += 2)
    unsubbers.push(() => emitter.off(morelisteners[i], morelisteners[i + 1]));
  emitter.on(event, func);
  for (let i = 0; morelisteners[i + 1]; i += 2)
    emitter.on(morelisteners[i], morelisteners[i + 1]);
  return () => unsubbers.forEach(f => f());
};

export function repeatRetryUntilTimeout(repeat, until, timeout = Infinity, retryLimit = Infinity, currentLimit = 0) {
  if (currentLimit >= retryLimit) return Promise.reject(new Error(
    `repeatRetryUntilTimeout hit retry limit of ${currentLimit} out of ${retryLimit} in:\n\trepeat ${repeat}\n\tuntil ${until}`
  ));
  return new Promise((resolve, reject) => {
    if (repeat) {
      try {
        const repeated = repeat();
        if (repeated instanceof Promise)
          repeated.catch(reject);
      } catch (e) {
        reject(e);
      }
    }
    const untilPromise = until();
    untilPromise.then(resolve).catch(reject);
    if (timeout !== Infinity) setTimeout(() => {
      if (untilPromise.cancel)
        untilPromise.cancel();
      reject();
    }, timeout);
  }).catch(reason => {
    if (reason instanceof Error)
      throw reason;
    else
      return repeatRetryUntilTimeout(repeat, until, timeout, retryLimit, currentLimit + 1);
  });
}

export const debounce = (
  func,
  ms,
  trailing = false
) => {
  let onTimeout = false;
  let trailingArgs = null;
  const handleTimeout = () => {
    onTimeout = false;
    if (trailing && trailingArgs)
      func(...trailingArgs);
    trailingArgs = null;
  };
  const debounced = (...args) => {
    if (onTimeout) {
      if (trailing)
        trailingArgs = args;
    }
    else {
      onTimeout = true;
      setTimeout(handleTimeout, ms);
      return func(...args);
    }
  };
  return debounced;
};

export const unbitmap_v = (value, bitmap) => Object.fromEntries(
  Object.entries(bitmap).filter(v => value & +v[1])
);

export const fsExists = filename => {
  try {
    fs.statSync(filename);
    return true;
  } catch (err) {
    return false;
  }
};

