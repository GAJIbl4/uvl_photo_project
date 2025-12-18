const around = (v, ideal, margin) =>
  v >= ideal - margin &&
  v <= ideal + margin;

const btnsMeta = {};
export const checkButton = (msg, ch, ideal, label, cbOn, cbOff) => {
  if (!(label in btnsMeta))
    btnsMeta[label] = { value: null, prev: new Array(checkButton.debounce).fill(Infinity), curr: 0 };
  const meta = btnsMeta[label];
  const chRaw = msg[`chan${ch}_raw`];
  meta.prev[meta.curr] = chRaw;
  meta.curr = (meta.curr + 1) % checkButton.debounce;
  let btnValue = label;
  for (const chRawPrev of meta.prev) {
    btnValue = btnValue && (around(chRawPrev, ideal, 5) ? label : false);
    if (!btnValue) break;
  }
  let buttonChangeState = undefined;
  if (btnValue !== meta.value)
    buttonChangeState = btnValue;
  meta.value = btnValue;
  if (buttonChangeState)
    cbOn?.(label);
  else if (buttonChangeState === false)
    cbOff?.(label);
  return buttonChangeState;
};

checkButton.debounce = 5;

