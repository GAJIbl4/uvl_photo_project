const fs = require('node:fs/promises')
const { mav2 } = require('./impl')

class MavMissionItem {

  frame = undefined
  command = undefined
  current = undefined
  autocontinue = undefined
  param1 = 0
  param2 = 0
  param3 = 0
  param4 = 0
  x = undefined
  y = undefined
  z = undefined

  constructor() { }

  #toInt() {
    this.x = Math.round(this.x * 1e7)
    this.y = Math.round(this.y * 1e7)
  }

  fromMavMessage(message) {
    this.frame = message.frame
    this.command = message.command
    this.current = message.current
    this.autocontinue = message.autocontinue
    this.param1 = message.param1
    this.param2 = message.param2
    this.param3 = message.param3
    this.param4 = message.param4
    this.x = message.x
    this.y = message.y
    this.z = message.z
    return this
  }
  fromQGCPlanItem(item, current = false) {
    this.frame = item.frame
    this.command = item.command
    this.current = current ? 1 : 0
    this.autocontinue = +item.autoContinue
    this.param1 = item.params[0] || 0
    this.param2 = item.params[1] || 0
    this.param3 = item.params[2] || 0
    this.param4 = item.params[3] || 0
    this.x = item.params[4]
    this.y = item.params[5]
    this.z = item.params[6]
    if (this.frame === mav2.MAV_FRAME_GLOBAL_RELATIVE_ALT) {
      this.frame = mav2.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
      this.#toInt()
    }
    else if (this.frame === mav2.MAV_FRAME_GLOBAL) {
      this.frame = mav2.MAV_FRAME_GLOBAL_INT
      this.#toInt()
    }
    else if (this.frame === mav2.MAV_FRAME_GLOBAL_TERRAIN_ALT) {
      this.frame = mav2.MAV_FRAME_GLOBAL_TERRAIN_ALT_INT
      this.#toInt()
    }

    return this
  }
  mavMessage(seq, sysId = 0, compId = 0) {
    return new mav2.messages.mission_item_int(sysId, compId, seq,
      this.frame,
      this.command,
      this.current,
      this.autocontinue,
      this.param1,
      this.param2,
      this.param3,
      this.param4,
      this.x,
      this.y,
      this.z
    )
  }

  fromPoint(point, alt, command, ...rest) {
    const absolute = rest[0] === 'absolute' ? rest.shift() : false
    this.frame = absolute ? mav2.MAV_FRAME_GLOBAL : mav2.MAV_FRAME_GLOBAL_RELATIVE_ALT
    this.command = command
    this.current = command === mav2.MAV_CMD_NAV_TAKEOFF ? 1 : 0
    this.autocontinue = 1
    this.param1 = rest[0] || 0
    this.param2 = rest[1] || 0
    this.param3 = rest[2] || 0
    this.param4 = rest[3] || 0
    this.x = point.lat
    this.y = point.lon
    this.z = alt
    this.#toInt()
    return this
  }
  floatXY() {
    return [this.x / 1e7, this.y / 1e7]
  }
  floatYX() {
    return [this.y / 1e7, this.x / 1e7]
  }

  isEqual(item) {
    return this.frame === item.frame
      && this.command === item.command
      && this.current === item.current
      && this.autocontinue === item.autocontinue
      && this.param1 === item.param1
      && this.param2 === item.param2
      && this.param3 === item.param3
      && this.param4 === item.param4
      && this.x === item.x
      && this.y === item.y
      && this.z === item.z
  }
}

class MavMission {
  count = 0
  items = []

  constructor() { }

  fromMavMessages(MISSION_COUNT, MISSION_ITEM_INT_list) {
    this.count = MISSION_COUNT.count
    this.items = MISSION_ITEM_INT_list.map(v =>
      new MavMissionItem().fromMavMessage(v))
    return this
  }

  async fromQGCPlan(filename) {
    const qgcPlanStr = await fs.readFile(filename)
    const qgcPlan = JSON.parse(qgcPlanStr.toString())
    this.count = qgcPlan.mission.items.length
    this.items = qgcPlan.mission.items.map((v, i) =>
      new MavMissionItem().fromQGCPlanItem(v, !i/* Only i=0 is current item */))
    return this
  }

  toJSON() {
    return { count: this.count, items: this.items }
  }

  mavMessages(sysId = 0, compId = 0) {
    const MISSION_COUNT = new mav2.messages.mission_count(
      sysId, compId,
      this.count,
      mav2.MAV_MISSION_TYPE_MISSION)
    const MISSION_ITEM_INT_list = this.items.map((v, seq) =>
      v.mavMessage(seq, sysId, compId))
    return [MISSION_COUNT, MISSION_ITEM_INT_list]
  }

  fromPoints(_points, alt) {
    const [first, ...points] = _points
    const last = points[points.length - 1]
    this.items = [
      new MavMissionItem().fromPoint(first, 0, mav2.MAV_CMD_NAV_WAYPOINT, 'absolute'),
      new MavMissionItem().fromPoint(first, alt, mav2.MAV_CMD_NAV_TAKEOFF),
      ...points.map(p => new MavMissionItem().fromPoint(p, alt, mav2.MAV_CMD_NAV_WAYPOINT, 1)),
      new MavMissionItem().fromPoint(last, alt, mav2.MAV_CMD_NAV_LOITER_UNLIM),
      new MavMissionItem().fromPoint(last, 0, mav2.MAV_CMD_NAV_LAND),
    ]
    this.count = this.items.length
    return this
  }

  asCoordinates() {
    const coordinates = []
    for (const item of this.items) {
      if (
        item.command === mav2.MAV_CMD_NAV_WAYPOINT ||
        item.command === mav2.MAV_CMD_NAV_TAKEOFF ||
        item.command === mav2.MAV_CMD_NAV_LAND
      )
        coordinates.push(item.floatYX())
      else if (item.command === mav2.MAV_CMD_NAV_RETURN_TO_LAUNCH)
        coordinates.push(this.items[0].floatYX())
    }
    return coordinates
  }

  isEqual(mission) {
    if (this.count !== mission.count)
      return false
    for (let i = 0; i < this.count; i++)
      if (!this.items[i].isEqual(mission.items[i]))
        return false
    return true
  }
}
module.exports = {
  MavMission,
  MavMissionItem
}