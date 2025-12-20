const deg = rad => rad * 180 / Math.PI
const rad = deg => deg * Math.PI / 180

const R = 6371e3 // metres, earth’s radius (mean radius = 6,371km)

function global_distance(lon1, lat1, lon2, lat2) {
  /**
   * φ is latitude, λ is longitude
   */
  const φ1 = lat1 * Math.PI / 180 // φ, λ in radians
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  const d = R * c
  return d
}

function find_closest(target, points, max_dist = Infinity) {
  if (!points.length) return null
  let min_point = points[0]
  let min_dist = global_distance(
    target.lon,
    target.lat,
    min_point.lon,
    min_point.lat)
  for (const point of points) {
    const dist = global_distance(
      target.lon,
      target.lat,
      point.lon,
      point.lat)
    if (dist < min_dist) {
      min_dist = dist
      min_point = point
    }
  }
  return min_dist < max_dist ? min_point : null
}

function destination_raw(lon, lat, Δlon, Δlat) {
  const dLat = Δlat * 180 / (Math.PI * R)
  const dLon = Δlon * 180 / (Math.PI * R * Math.cos(deg(lat)))
  return {
    lon: lon + dLon,
    lat: lat + dLat,
  }
}

function destination_point(point, Δlon, Δlat) {
  return destination_raw(point.lon, point.lat, Δlon, Δlat)
}

function destination(...args) {
  if (typeof args[0] === 'number')
    return destination_raw(args[0], args[1], args[2], args[3])
  else
    return destination_point(args[0], args[1], args[2])
}

module.exports = {
  global_distance,
  find_closest,
  destination
}