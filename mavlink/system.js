const { EventEmitter } = require('node:events')
const { MavMission } = require('./mission')
const { mav2, apm, MAVLink20Processor, parse } = require('./impl')
const { MAV_MISSION_descriptions } = require('./impl')
const { MAV_RESULT_descriptions } = require('./impl')
const { once, subscribe, repeatRetryUntilTimeout, debounce, log } = require('../utils')
const { global_distance } = require('./geo')
const _ = require('lodash')
const { unbitmap_v } = require('../utils')
const { CancelablePromise } = require('cancelable-promise')

const boot_time = Date.now()
const time_since_boot = () => Date.now() - boot_time
const ignoreErrors = error => console.log(error)

const catchRepeatRetryUntilTimeout = message => err => {
  if (err.message.startsWith('repeatRetryUntilTimeout'))
    throw new Error(message)
  else
    throw err
}

const mavTimeout = async (repeat, until, errMessage) =>
  await repeatRetryUntilTimeout(repeat, until, 1500, 5)
    .catch(catchRepeatRetryUntilTimeout(errMessage))

const mavTimeoutItem = async (repeat, until, errMessage) =>
  await repeatRetryUntilTimeout(repeat, until, 250, 5)
    .catch(catchRepeatRetryUntilTimeout(errMessage))

const MAV_MISSIONs = _.chain(mav2).pickBy((v, k) => k.match(/^MAV_MISSION_(?!TYPE_)/)).invert().value()
const check_MISSION_ACK = (mission) => msg => {
  if (msg.type === mav2.MAV_MISSION_ACCEPTED)
    return msg
  else if (msg.type === mav2.MAV_MISSION_INVALID_SEQUENCE)
    return false
  else
    throw new Error(
      'Mission operation failed, reason: '
      + MAV_MISSIONs[msg.type]
      + ': '
      + MAV_MISSION_descriptions[MAV_MISSIONs[msg.type]]
      + (mission ? JSON.stringify(mission, null, 2) : '')
    )
}

const MAV_CMDs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_CMD_') && !k.startsWith('MAV_CMD_ACK_'))
  .invert()
  .value()
const MAV_CMD_ACKs = _.chain(mav2).pickBy((v, k) => k.startsWith('MAV_CMD_ACK_')).invert().value()
const MAV_RESULTs = _.chain(mav2).pickBy((v, k) => k.startsWith('MAV_RESULT_')).invert().value()

class MavSystem extends EventEmitter {
  #processor = null
  sendRaw = buff => undefined
  reinit = async () => undefined
  id = 1
  componentId = mav2.MAV_COMP_ID_ONBOARD_COMPUTER
  requestedMessages = {}

  constructor(id, adapter, requestedMessages = {
    ATTITUDE: 500,
    SYS_STATUS: [500, process_SYS_STATUS],
    EXTENDED_SYS_STATE: [500, process_EXTENDED_SYS_STATE],
    BATTERY_STATUS: 500,
    SYSTEM_TIME: 500,
  }) {
    super()
    this.id = id
    this.#processor = new MAVLink20Processor(null, this.id, this.componentId)
    this.sendRaw = adapter(buff => parse(
      this.#processor, buff,
      msg => {
        this.emit('message', msg)
        this.emit(msg._name, msg)
      }
    ))
    this.on('HEARTBEAT', msg => this.emit('heartbeat', process_HEARTBEAT(msg)))
    this.on('MISSION_REQUEST', msg => this.emit('MISSION_REQUEST_INT', msg))
    this.requestedMessages = requestedMessages
    setInterval(() => this.heartbeat(), 1000)
    this.subscribeToMany(requestedMessages)
    this.requestInitialMessages().catch(() => { })
  }

  requestInitialMessages = () => once(this, 'HEARTBEAT')
    .then(() => this.setMessagesIntervals(this.requestedMessages))

  sendEnabled = false
  send = (msg, from = 'local') => {
    if (this.sendEnabled) {
      this.sendRaw(Buffer.from(msg._msgbuf || this.#processor.send(msg)))
      this.emit('messageToFlightController', msg, from)
    }
  }

  connect = what => send => {
    const processor = new MAVLink20Processor()
    this.on('message', msg => send(Buffer.from(msg._msgbuf)))
    this.on('messageToFlightController', (msg, from) => from !== what && send(Buffer.from(msg._msgbuf)))
    const recv = buff => parse(
      processor, buff, msg => this.send(msg, what))
    return recv
  }

  // Helper functions

  subscribeTo = (name, freq, transform) => {
    const lowname = name.toLowerCase()
    this.on(name, msg => {
      const fields = _.pick(msg, msg.fieldnames)
      this.emit(lowname, transform ? transform(fields, msg) : fields)
    })
  }

  subscribeToMany = (messages) =>
    Object.entries(messages)
      .forEach(([name, opt]) => Array.isArray(opt)
        ? this.subscribeTo(name, ...opt)
        : this.subscribeTo(name, opt))

  setMessagesIntervals = (messages) => {
    return CancelablePromise.all(Object
      .entries(messages)
      .map(([name, opt]) => Array.isArray(opt)
        ? this.setMessageInterval(name, ...opt)
        : this.setMessageInterval(name, opt)
      )
    )
  }

  #handle_COMMAND_ACK(msg) {
    if (msg.result === mav2.MAV_RESULT_ACCEPTED) {
      return msg
    } else if (msg.result === mav2.MAV_RESULT_IN_PROGRESS) {
      this.emit('COMMAND_ACK:progress', msg)
      return once(this, 'COMMAND_ACK', ({ command }) => command === msg.command).then(this.#handle_COMMAND_ACK)
    } else {
      throw new Error(
        `${MAV_CMDs[msg.command]}(${msg.command}) failed, reason: `
        + MAV_RESULTs[msg.result]
        + ': '
        + MAV_RESULT_descriptions[MAV_RESULTs[msg.result]]
      )
    }
  }

  // Main logic

  async getMission() {
    const mission_count = await mavTimeout(
      () => this.send(new mav2.messages.mission_request_list(this.id, mav2.MAV_COMP_ID_AUTOPILOT1)),
      () => once(this, 'MISSION_COUNT'),
      'Get mission timed out waiting for mission count'
    )
    const mission_items = []
    for (let i = 0; i < mission_count.count; i++) {
      const mission_item = await mavTimeoutItem(
        () => this.send(new mav2.messages.mission_request_int(this.id, mav2.MAV_COMP_ID_AUTOPILOT1, i)),
        () => once(this, 'MISSION_ITEM_INT', v => v.seq === i ? v : null),
        'Get mission timed out waiting for mission item'
      )
      mission_items.push(mission_item)
    }
    this.send(new mav2.messages.mission_ack(this.id, mav2.MAV_COMP_ID_AUTOPILOT1, mav2.MAV_MISSION_ACCEPTED))
    return new MavMission().fromMavMessages(mission_count, mission_items)
  }

  async clearMission() {
    await mavTimeout(
      () => this.send(new mav2.messages.mission_clear_all(this.id, mav2.MAV_COMP_ID_AUTOPILOT1)),
      () => once(this, 'MISSION_ACK').then(check_MISSION_ACK()),
      'Clear mission timed out waiting for mission ack'
    )
    this.emit('mission', null)
  }

  async setMission(mission, doublecheck = true) {
    const [MISSION_COUNT, MISSION_ITEM_INT_list] = mission.mavMessages(this.id, mav2.MAV_COMP_ID_AUTOPILOT1)
    const mission_count = await mavTimeout(
      () => this.send(MISSION_COUNT),
      () => once(this, 'MISSION_REQUEST_INT', v => v.seq === 0 ? v : null),
      'Set mission timed out after sending mission count'
    )
    for (let i = 0; i < MISSION_COUNT.count; i++) {
      if (i === MISSION_COUNT.count - 1) {
        await mavTimeout(
          () => this.send(MISSION_ITEM_INT_list[i]),
          () => once(this, 'MISSION_ACK').then(check_MISSION_ACK(mission)),
          'Set mission timed out waiting for mission ack'
        )
      } else {
        await mavTimeout(
          () => this.send(MISSION_ITEM_INT_list[i]),
          () => once(this, 'MISSION_REQUEST_INT', v => v.seq === i + 1 ? v : null),
          'Set mission timed out waiting to send next mission item'
        )
      }
    }
    if (doublecheck)
      await this.doublecheckMission(mission)
    this.emit('mission', mission)
  }

  /**
   * ArduPilot differes from standart MAVLink2 mission protocoll implementation
   */
  async setMissionApm(mission, doublecheck = false) {
    const [MISSION_COUNT, MISSION_ITEM_INT_list] = mission.mavMessages(this.id, mav2.MAV_COMP_ID_AUTOPILOT1)
    const handle_MISSION_REQUEST_INT = ({ seq }) => {
      this.send(MISSION_ITEM_INT_list[seq])
    }
    const unsub = subscribe(this, 'MISSION_REQUEST_INT', handle_MISSION_REQUEST_INT)
    await mavTimeout(
      () => this.send(MISSION_COUNT),
      () => once(this, 'MISSION_REQUEST_INT'),
      'Set mission timed out waiting to send next mission item'
    )
    await once(this, 'MISSION_ACK', check_MISSION_ACK(mission)).then(unsub)
    if (doublecheck)
      await this.doublecheckMission(mission)
    this.emit('mission', mission)
  }

  async doublecheckMission(mission) {
    const newMission = await this.getMission()
    if (!newMission.isEqual(mission))
      throw new Error(
        'Got different mission from the one being uploaded: \n'
        + JSON.stringify(newMission.toJSON(), null, 2)
        + '\n\nINSTEAD OF\n\n'
        + JSON.stringify(mission.toJSON(), null, 2))
  }

  async commandInt(frame, cmd, ...args) {
    await mavTimeout(
      () => this.send(new mav2.messages.command_int(this.id, mav2.MAV_COMP_ID_AUTOPILOT1, frame, cmd, ...args)),
      () => once(this, 'COMMAND_ACK', ({ command }) => command === cmd).then(this.#handle_COMMAND_ACK),
      'Command int timed out for ' + MAV_CMDs[cmd] + '(' + args.join(', ') + ')'
    )
  }

  async commandLong(cmd, ...args) {
    let confirmation = 0
    await mavTimeout(
      () => this.send(new mav2.messages.command_long(this.id, mav2.MAV_COMP_ID_AUTOPILOT1, cmd, confirmation++, ...args)),
      () => once(this, 'COMMAND_ACK', ({ command }) => command === cmd).then(this.#handle_COMMAND_ACK),
      'Command long timed out for ' + MAV_CMDs[cmd] + '(' + args.join(', ') + ')'
    )
  }

  async command(cmd, ...args) {
    await this.commandLong(cmd, ...args)
  }

  async arm() {
    await this.command(
      mav2.MAV_CMD_COMPONENT_ARM_DISARM,
      1, 0)
  }

  async setMessageInterval(name, freq) {
    await this.command(
      mav2.MAV_CMD_SET_MESSAGE_INTERVAL,
      mav2['MAVLINK_MSG_ID_' + name], freq * 1e3, 0,
    )
  }

  async disarm() {
    await this.command(
      mav2.MAV_CMD_COMPONENT_ARM_DISARM,
      0, 0)
  }

  async forceArm() {
    await this.command(
      mav2.MAV_CMD_COMPONENT_ARM_DISARM,
      1, 21196)
  }

  async forceDisarm() {
    await this.command(
      mav2.MAV_CMD_COMPONENT_ARM_DISARM,
      0, 21196)
  }

  land() {
    return CancelablePromise.resolve().then(() =>
      this.command(
        mav2.MAV_CMD_NAV_LAND,
        NaN, NaN, NaN, NaN,
        0, 0, NaN
      )
    ).then(() =>
      once(this, 'EXTENDED_SYS_STATE',
        msg => msg.landed_state === mav2.MAV_LANDED_STATE_ON_GROUND)
    )
  }

  heartbeat() {
    this.send(new mav2.messages.heartbeat(
      mav2.MAV_TYPE_ONBOARD_CONTROLLER,
      mav2.MAV_AUTOPILOT_INVALID,
      0,
      0,
      0,
      3
    ))
  }

  setApmMode(main_mode) {
    this.send(new mav2.messages.set_mode(
      this.id,
      mav2.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
      main_mode
    ))
  }

  guided() {
    this.setApmMode(apm.COPTER_MODE_GUIDED)
  }

  stabilize() {
    //no! this.setApmMode(apm.COPTER_MODE_STABILIZE)
  }

  takeOff(altitude) {
    return CancelablePromise.resolve().then(() =>
      this.command(
        mav2.MAV_CMD_NAV_TAKEOFF,
        NaN, NaN, NaN, NaN, NaN, NaN,
        altitude
      )
    ).then(() =>
      once(this, 'EXTENDED_SYS_STATE',
        msg => msg.landed_state === mav2.MAV_LANDED_STATE_IN_AIR
      )
    )
  }

  reached(lon, lat, accuracy, alt, accuracy_alt) {
    return once(this, 'GLOBAL_POSITION_INT', msg => {
      const dist = global_distance(lon, lat, msg.lon / 1e7, msg.lat / 1e7)
      if (alt === undefined)
        return dist <= accuracy
      const alt_diff = Math.abs(alt - msg.relative_alt / 1e3)
      return dist <= accuracy && alt_diff <= accuracy_alt
    }).then(() => {
      this.emit('reached', lon, lat, accuracy, alt, accuracy_alt)
    })
  }

  reachedAlt(alt, accuracy_alt) {
    return once(this, 'GLOBAL_POSITION_INT',
      msg => Math.abs(alt - msg.relative_alt / 1e3) <= accuracy_alt)
  }

  reachedYaw(deg, accuracy) {
    return once(this, 'GLOBAL_POSITION_INT',
      msg => Math.abs(deg - msg.hdg / 1e2) <= accuracy)
  }

  #position_target_global_int_mask = 0
    | mav2.POSITION_TARGET_TYPEMASK_VX_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_VY_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_VZ_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AX_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AY_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AZ_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_YAW_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE

  setPositionTarget(lon, lat, alt) {
    const lon_int = Math.round(lon * 1e7)
    const lat_int = Math.round(lat * 1e7)
    this.send(
      new mav2.messages.set_position_target_global_int(
        time_since_boot(),
        this.id, mav2.MAV_COMP_ID_AUTOPILOT1,
        mav2.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        this.#position_target_global_int_mask,
        lat_int, lon_int, alt,
        NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN,
      )
    )
  }

  flyto(lon, lat, alt, accuracy, accuracy_alt) {
    this.setPositionTarget(lon, lat, alt)
    if (accuracy_alt === undefined)
      return this.reached(lon, lat, accuracy)
    else
      return this.reached(lon, lat, accuracy, alt, accuracy_alt)
  }

  #position_target_global_int_mask_yaw = 0
    | mav2.POSITION_TARGET_TYPEMASK_X_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_Y_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_Z_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AX_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AY_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_AZ_IGNORE
    | mav2.POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE

  setYaw(yaw_deg) {
    const yaw_rad = (Math.PI * yaw_deg) / 180
    this.send(
      new mav2.messages.set_position_target_global_int(
        time_since_boot(),
        this.id, mav2.MAV_COMP_ID_AUTOPILOT1,
        mav2.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        this.#position_target_global_int_mask_yaw,
        NaN, NaN, NaN,
        0,
        0,
        0,
        NaN, NaN, NaN,
        yaw_rad,
        NaN,
      ),
    )
  }

  async turn(deg, accuracy) {
    await this.setYaw(deg)
    return this.reachedYaw(Math.abs(deg), accuracy)
  }

  async grip(grip) {
    await this.commandLong(mav2.MAV_CMD_DO_GRIPPER, 0, !grip ? 1 : 0)
  }


  statusText_id = 1
  statusText(value, severity = mav2.MAV_SEVERITY_INFO) {
    const text = String(value)
    if (text.length <= 50) {
      this.send(new mav2.messages.statustext(
        severity, text_msg, 0, 0
      ))
    }
    else {
      const chunks = text.match(/.{1,50}/g)
      for (let i = 0; i < chunks.length; i++) {
        this.send(new mav2.messages.statustext(
          severity, chunks[i], this.statusText_id, i
        ))
      }
      this.statusText_id = (this.statusText_id + 1) % 2 ** 16
    }
  }
}

const MAV_TYPEs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_TYPE_'))
  .invert()
  .mapValues((v, k) => v.slice('MAV_TYPE_'.length).toLowerCase())
  .value()
const MAV_AUTOPILOTs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_AUTOPILOT_'))
  .invert()
  .mapValues((v, k) => v.slice('MAV_AUTOPILOT_'.length).toLowerCase())
  .value()
const MAV_STATEs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_STATE_'))
  .invert()
  .mapValues((v, k) => v.slice('MAV_STATE_'.length).toLowerCase())
  .value()
const MAV_MODE_FLAG_bits = _
  .chain(mav2)
  .pickBy((v, k) =>
    k.startsWith('MAV_MODE_FLAG_')
    && !k.startsWith('MAV_MODE_FLAG_DECODE_POSITION_')
    && k !== 'MAV_MODE_FLAG_ENUM_END')
  .mapKeys((v, k) => k.slice('MAV_MODE_FLAG_'.length).toLowerCase())
  .invert()
  .mapValues(v => +v)
  .value()

const process_HEARTBEAT = msg => {
  const type = MAV_TYPEs[msg.type]
  const autopilot = MAV_AUTOPILOTs[msg.autopilot]
  const status = MAV_STATEs[msg.system_status]
  const base_mode = _.mapValues(
    MAV_MODE_FLAG_bits,
    (bit_value, key) => Boolean(msg.base_mode & bit_value))
  const custom_mode = msg.custom_mode
  return { type, autopilot, status, base_mode, custom_mode }
}

const MAV_SYS_STATUS_SENSOR_bits = _.mapKeys(
  _.pickBy(mav2, (v, k) => k.startsWith('MAV_SYS_STATUS_SENSOR')),
  (v, k) => k.slice('MAV_SYS_STATUS_SENSOR_'.length))
delete MAV_SYS_STATUS_SENSOR_bits['enum_end']

const process_SYS_STATUS = msg => {
  const present = unbitmap_v(
    msg.onboard_control_sensors_present,
    MAV_SYS_STATUS_SENSOR_bits)
  const healthy = unbitmap_v(
    msg.onboard_control_sensors_health,
    present)
  const enabled = unbitmap_v(
    msg.onboard_control_sensors_enabled,
    present)
  msg.onboard_control_sensors = _.mapValues(present, (v, k) => ({
    healthy: k in healthy,
    enabled: k in enabled
  }))
  return msg
}

const MAV_VTOL_STATEs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_VTOL_STATE_'))
  .invert()
  .mapValues((v, k) => v.slice('MAV_VTOL_STATE_'.length).toLowerCase())
  .value()
const MAV_LANDED_STATEs = _.chain(mav2)
  .pickBy((v, k) => k.startsWith('MAV_LANDED_STATE_'))
  .invert()
  .mapValues((v, k) => v.slice('MAV_LANDED_STATE_'.length).toLowerCase())
  .value()

const process_EXTENDED_SYS_STATE = msg => ({
  vtol_state: MAV_VTOL_STATEs[msg.vtol_state],
  landed_state: MAV_LANDED_STATEs[msg.landed_state]
})

module.exports = {
  MavSystem
}