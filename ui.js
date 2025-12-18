import { debounce, shallowEqualAll } from './utils.js';
import * as osd from './osd.js';

let osdWrite = () => { };

const elemCache = {};
const elemNo = elem => {
  if (elemCache[elem])
    return elemCache[elem];
  const maxNo = Math.max(0, ...Object.values(elemCache));
  elemCache[elem] = maxNo + 1;
  return elemCache[elem];
};

const renderers = {};

let prevState = {};
let nextState = {};

export const update = (elem, ...state) => {
  if (typeof elem === 'object') {
    let updated = false;
    for (const el in elem)
      if (renderers[el] && !shallowEqualAll(prevState[el], [elem[el]])) {
        nextState[el] = [elem[el]];
        updated = true;
      }
    if (updated)
      render();
  } else {
    if (renderers[elem] && !shallowEqualAll(prevState[elem], state)) {
      nextState[elem] = state;
      render();
    }
  }
};

export const configure = (write, geometry) => {
  osdWrite = write;
  osd.setGeometry(geometry);
};

export const updateLayout = (elems, doRender = false) => {
  for (const [elem, render] of Object.entries(elems)) {
    nextState[elem] = [];
    if (Array.isArray(render))
      renderers[elem] = v => [render[0], render[1], v !== undefined ? v : render[2]];
    else
      renderers[elem] = render;
  }
  if (doRender) render();
};

const renderOne = ([elem, state]) => {
  let rendered = renderers[elem](...state);
  if (!Array.isArray(rendered[0]))
    rendered = [rendered];
  const finalized = [];
  for (let i = 0; i < rendered.length; i++) {
    let [y = 0, x = 0, text] = rendered[i];
    if (typeof text !== 'string' && !Buffer.isBuffer(text) && !Array.isArray(text))
      text = '';
    const no = elemNo(elem + i);
    finalized.push([no, osd.posY(y, text), osd.posX(x, text), text]);
  }
  return finalized;
};

const renderImmediate = () => {
  const elems = Object.entries(nextState).map(renderOne).flat(1);
  const buff = osd.renderElements(elems);
  prevState = { ...prevState, ...nextState };
  nextState = {};
  osdWrite(buff);
};

export const render = debounce(renderImmediate, 100);

