const renderElements = elems =>
  Buffer.concat(elems.map(v => renderElement(...v)))

const renderElement = (elem, y, x, text) => {
  if (text === undefined)
    return renderElementFunctonal(elem, y, x)
  else
    return renderElementBasic(elem, y, x, text)
}

const renderElementBasic = (elem, y, x, text) => {
  const textBuff = typeof text === 'string'
    ? Buffer.from(text, 'utf-8')
    : Array.isArray(text)
      ? Buffer.from(text)
      : text
  const textBuffFin = textBuff.length > 30 ? textBuff.slice(0, 30) : textBuff
  const header = Buffer.from([85, 73, elem, y, x, textBuffFin.length])
  return Buffer.concat([header, textBuffFin])
}

const renderElementLiteral = (elem, y, x, strings, chars) => {
  const acc = [Buffer.from(strings[0], 'utf-8')]
  for (let i = 0; i < chars.length; i++) {
    acc.push(Buffer.from(typeof chars[i] === 'number' ? [chars[i]] : chars[i]))
    acc.push(Buffer.from(strings[i + 1], 'utf-8'))
  }
  const accBuff = Buffer.concat(acc)
  return renderElementBasic(elem, y, x, accBuff)
}

const renderElementFunctonal = (elem, y, x) => (text, ...rest) => {
  if (Array.isArray(text))
    return renderElementLiteral(elem, y, x, text, rest)
  else
    return renderElementBasic(elem, y, x, text)
}

const ch = {
  NoSignal: 0x01,
  QuoteAngleLeft: 0x02,
  QuoteAngleRight: 0x03,
  Spiral: 0x04,
  Hat: 0x05,
  V: 0x06,
  UnitMAh: 0x07,
  StarTop: 0x08,
  StarMiddle: 0x09,
  StarBottom: 0x0a,
  BorderCross: 0x0b,
  UnitMeter: 0x0c,
  UnitFahrenheit: 0x0d,
  UnitCelsius: 0x0e,
  UnitFeet: 0x0f,
  StrikeDot1: 0x10,
  StrikeDot2: 0x11,
  StrikeDot3: 0x12,
  StrikeDot4: 0x13,
  StrikeDot5: 0x14,
  StrikeDot6: 0x15,
  BorderVertical: 0x16,
  BorderHorizontal: 0x17,
  DirectionNorth: 0x18,
  DirectionSouth: 0x19,
  DirectionEast: 0x1a,
  DirectionWest: 0x1b,
  DirectionSeparatorLarge: 0x1c,
  DirectionSeparatorSmall: 0x1d,
  Sats1: 0x1e,
  Sats2: 0x1f,
  Number100: 0x21,
  Number500: 0x22,
  Number2k5: 0x23,
  Max: 0x24,
  ConnectedDotLeft: 0x26,
  ConnectedDotRight: 0x27,
  ArrowD: 0x60,
  ArrowDDR: 0x61,
  ArrowDR: 0x62,
  ArrowDRR: 0x63,
  ArrowR: 0x64,
  ArrowRRU: 0x65,
  ArrowRU: 0x66,
  ArrowRUU: 0x67,
  ArrowU: 0x68,
  ArrowUUL: 0x69,
  ArrowUL: 0x6a,
  ArrowULL: 0x6b,
  ArrowL: 0x6c,
  ArrowLLD: 0x6d,
  ArrowLD: 0x6e,
  ArrowLDD: 0x6f,
  OnHours: 0x70,
  FlyHours: 0x71,
  FrameTop: 0x72,
  FrameTopRight: 0x73,
  FrameRight: 0x74,
  FrameBottomRight: 0x75,
  FrameBottom: 0x76,
  FrameBottomLeft: 0x77,
  FrameLeft: 0x78,
  FrameTopLeft: 0x79,
  DottedCross: 0x7e,
  DottedVertical: 0x7f,
  PalletNotScanned: 0x80,
  PalletCurrent: 0x81,
  PalletScanned: 0x82,
  Unicode: 0x83,
  Unicode1: 0x84,
  Unicode2: 0x85,
  Unicode3: 0x86,
  Unicode4: 0x87,
  FatSmallUnderscore: 0x88,
  BlackPlus: 0x89,
  ProgressLeft: 0x8a,
  ProgressFull: 0x8b,
  ProgressHalf: 0x8c,
  ProgressEmpty: 0x8d,
  ProgressRight: 0x8e,
  Battery100: 0x8f,
  Battery090: 0x90,
  Battery075: 0x91,
  Battery060: 0x92,
  Battery045: 0x93,
  Battery030: 0x94,
  Battery015: 0x95,
  Battery000: 0x96,
  BatteryBAT: 0x97,
  BlackGY: 0x98,
  UnitFeetPerSecond: 0x99,
  UnitA: 0x9a,
  OnMinutes: 0x9b,
  Checkmark1: 0x9c,
  Checkmark2: 0x9d,
  Checkmark3: 0x9e,
  Checkmark4: 0x9f,
  Crossmark1: 0xa0,
  Crossmark2: 0xa1,
  Crossmark3: 0xa2,
  Crossmark4: 0xa3
}

const geometry = {
  width: 30,
  height: 16,
  paddingTop: 0,
  paddingBottom: 0,
  paddingRight: 0,
  paddingLeft: 0,
};

const setGeometry = opt => Object.assign(geometry, opt);

const posYShorthand = {
  top: () => geometry.paddingTop,
  bottom: () => geometry.height - geometry.paddingBottom,
  center: () => Math.round(
    (geometry.height - geometry.paddingTop - geometry.paddingBottom) / 2
    + geometry.paddingTop),
}

const posXShorthand = {
  left: () => geometry.paddingRight,
  right: str => geometry.width - geometry.paddingRight - str.length,
  center: str => str.length > geometry.width ? 0
    : Math.floor((geometry.width - str.length) / 2),
}

const posX = (x, str) => {
  if (typeof x === 'number') return x
  else {
    const [pos, add = 0] = x.split(' ')
    return posXShorthand[pos]?.(str) + +add || 0
  }
}

const posY = (y, str) => {
  if (typeof y === 'number') return y
  else {
    const [pos, add = 0] = y.split(' ')
    return posYShorthand[pos]?.(str) + +add || 0
  }
}

export { renderElement, renderElements, ch, posX, posY, setGeometry }

