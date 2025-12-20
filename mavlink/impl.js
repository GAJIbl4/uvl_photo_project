const { MAVLink20Processor: _MAVLink20Processor, mavlink20 } = require('../third_party/MAVLink20Next.js')
const { EventEmitter } = require('node:events')

/**
 * @typedef { [Key in keyof Type]: Type[Key] } Objectify<Type>
 */

/**
 * @type { Objectify<typeof mavlink20> }
 */
const mav2 = mavlink20

/**
 * @type { new(...args: Parameters<typeof _MAVLink20Processor>): InstanceType<typeof _MAVLink20Processor> & EventEmitter }
 */
const MAVLink20Processor = _MAVLink20Processor

const MAV_MISSION_descriptions = {
  MAV_MISSION_ACCEPTED: 'mission accepted OK',
  MAV_MISSION_ERROR: 'Generic error / not accepting mission commands at all right now.',
  MAV_MISSION_UNSUPPORTED_FRAME: 'Coordinate frame is not supported.',
  MAV_MISSION_UNSUPPORTED: 'Command is not supported.',
  MAV_MISSION_NO_SPACE: 'Mission items exceed storage space.',
  MAV_MISSION_INVALID: 'One of the parameters has an invalid value.',
  MAV_MISSION_INVALID_PARAM1: 'param1 has an invalid value.',
  MAV_MISSION_INVALID_PARAM2: 'param2 has an invalid value.',
  MAV_MISSION_INVALID_PARAM3: 'param3 has an invalid value.',
  MAV_MISSION_INVALID_PARAM4: 'param4 has an invalid value.',
  MAV_MISSION_INVALID_PARAM5_X: 'x / param5 has an invalid value.',
  MAV_MISSION_INVALID_PARAM6_Y: 'y / param6 has an invalid value.',
  MAV_MISSION_INVALID_PARAM7: 'z / param7 has an invalid value.',
  MAV_MISSION_INVALID_SEQUENCE: 'Mission item received out of sequence',
  MAV_MISSION_DENIED: 'Not accepting any mission commands from this communication partner.',
  MAV_MISSION_OPERATION_CANCELLED: 'Current mission operation cancelled (e.g. mission upload, mission download).'
}
const MAV_RESULT_descriptions = {
  MAV_RESULT_ACCEPTED: 'Command is valid (is supported and has valid parameters), and was executed.',
  MAV_RESULT_TEMPORARILY_REJECTED: "Command is valid, but cannot be executed at this time. This is used to indicate a problem that should be fixed just by waiting (e.g. a state machine is busy, can't arm because have not got GPS lock, etc.). Retrying later should work.",
  MAV_RESULT_DENIED: 'Command is invalid (is supported but has invalid parameters). Retrying same command and parameters will not work.',
  MAV_RESULT_UNSUPPORTED: 'Command is not supported (unknown).',
  MAV_RESULT_FAILED: 'Command is valid, but execution has failed. This is used to indicate any non-temporary or unexpected problem, i.e. any problem that must be fixed before the command can succeed/be retried. For example, attempting to write a file when out of memory, attempting to arm when sensors are not calibrated, etc.',
  MAV_RESULT_IN_PROGRESS: 'Command is valid and is being executed. This will be followed by further progress updates, i.e. the component may send further COMMAND_ACK messages with result MAV_RESULT_IN_PROGRESS (at a rate decided by the implementation), and must terminate by sending a COMMAND_ACK message with final result of the operation. The COMMAND_ACK.progress field can be used to indicate the progress of the operation.',
  MAV_RESULT_CANCELLED: 'Command has been cancelled (as a result of receiving a COMMAND_CANCEL message).'
}

const CONVERT_MAVLINK21_TO_MAVLINK20 = msg => {
  msg.msgbuf = msg.msgbuf || msg._msgbuf
  msg.name = msg.name || msg._name
  msg.id = msg.id || msg._id || msg.id
}

const parse = (parser, buff, onmsg, onbad) => {
  const msgs = parser.parseBuffer(buff)
  for (const msg of msgs) {
    //CONVERT_MAVLINK21_TO_MAVLINK20(msg)
    if (msg.id !== mav2.MAVLINK_MSG_ID_BAD_DATA)
      onmsg?.(msg)
    else
      onbad?.(msg)
  }
}

const sendAs = (processor, msg) => {
  if (msg._header) {
    const tmpSystem = processor.srcSystem
    const tmpComponent = processor.srcComponent
    processor.srcSystem = msg._header.srcSystem
    processor.srcComponent = msg._header.srcComponent
    const ret = processor.send(msg)
    processor.srcSystem = tmpSystem
    processor.srcComponent = tmpComponent
    return ret
  } else {
    return processor.send(msg)
  }
}

const apm = {

  /**
   * https://mavlink.io/en/messages/ardupilotmega.html#COPTER_MODE
   */

  /*
   * COPTER_MODE
   * [Enum] A mapping of copter flight modes for custom_mode field of heartbeat.
   */

  COPTER_MODE_STABILIZE: 0,
  COPTER_MODE_ACRO: 1,
  COPTER_MODE_ALT_HOLD: 2,
  COPTER_MODE_AUTO: 3,
  COPTER_MODE_GUIDED: 4,
  COPTER_MODE_LOITER: 5,
  COPTER_MODE_RTL: 6,
  COPTER_MODE_CIRCLE: 7,
  COPTER_MODE_LAND: 9,
  COPTER_MODE_DRIFT: 11,
  COPTER_MODE_SPORT: 13,
  COPTER_MODE_FLIP: 14,
  COPTER_MODE_AUTOTUNE: 15,
  COPTER_MODE_POSHOLD: 16,
  COPTER_MODE_BRAKE: 17,
  COPTER_MODE_THROW: 18,
  COPTER_MODE_AVOID_ADSB: 19,
  COPTER_MODE_GUIDED_NOGPS: 20,
  COPTER_MODE_SMART_RTL: 21,
  COPTER_MODE_FLOWHOLD: 22,
  COPTER_MODE_FOLLOW: 23,
  COPTER_MODE_ZIGZAG: 24,
  COPTER_MODE_SYSTEMID: 25,
  COPTER_MODE_AUTOROTATE: 26,

  /*
   * SUB_MODE
   * [Enum] A mapping of sub flight modes for custom_mode field of heartbeat.
   */

  SUB_MODE_STABILIZE: 0,
  SUB_MODE_ACRO: 1,
  SUB_MODE_ALT_HOLD: 2,
  SUB_MODE_AUTO: 3,
  SUB_MODE_GUIDED: 4,
  SUB_MODE_CIRCLE: 7,
  SUB_MODE_SURFACE: 9,
  SUB_MODE_POSHOLD: 16,
  SUB_MODE_MANUAL: 19,
}

module.exports = {
  mav2,
  MAVLink20Processor,
  MAV_MISSION_descriptions,
  MAV_RESULT_descriptions,
  parse,
  sendAs,
  apm,
}