/**
 * Decodes an encoded polyline (Google algorithm, precision 5) as used by OneMap's `legGeometry.points`.
 * Returns [lon, lat] pairs, the order GeoJSON and MapLibre expect.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated polyline');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lon += next();
    coords.push([lon / 1e5, lat / 1e5]);
  }
  return coords;
}
