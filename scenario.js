"use strict";

function solveScenario(network, incidentPoint, destinationPoint, closedRoad, unavailable, fixedIncident) {
  const {edges, stations, roads} = network;
  const cuts = new Map();
  const metersX = 96700, metersY = 110850;
  function snapPoint(point, id) {
    let best = null;
    for (const [index, edge] of edges.entries()) {
      const [from, to, road, , length, , start, end] = edge;
      if (!length || ["A10", "A63"].includes(roads[road][1])) continue;
      const dx = (end[0] - start[0]) * metersX, dy = (end[1] - start[1]) * metersY;
      if (!dx && !dy) continue;
      const px = (point[0] - start[0]) * metersX, py = (point[1] - start[1]) * metersY;
      const fraction = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const offset = Math.hypot(px - fraction * dx, py - fraction * dy);
      if (!best || offset < best.offset) best = {index, fraction, offset, from, to, start, end};
    }
    if (!best || best.offset > 250) throw Error("Choose a point within 250 m of an eligible road.");
    const {index, fraction, offset, from, to, start, end} = best;
    const coordinate = start.map((value, axis) => value + fraction * (end[axis] - value));
    if (fraction === 0 || fraction === 1) return {id: fraction === 0 ? from : to, coordinate, offset};
    if (!cuts.has(index)) cuts.set(index, []);
    const splits = cuts.get(index);
    const existing = splits.find(item => item.fraction === fraction);
    if (existing) return {id: existing.id, coordinate, offset};
    splits.push({id, fraction, coordinate});
    return {id, coordinate, offset};
  }

  const incident = fixedIncident === undefined ? snapPoint(incidentPoint, -1) : {id: fixedIncident};
  const destination = destinationPoint && snapPoint(destinationPoint, -2);
  const outgoing = new Map(), incoming = new Map();
  function connect(from, to, start, end, distance, time, road) {
    const arc = {from, to, start, end, distance, time, road};
    if (!outgoing.has(from)) outgoing.set(from, []);
    if (!incoming.has(to)) incoming.set(to, []);
    outgoing.get(from).push(arc);
    incoming.get(to).push(arc);
  }
  for (const [index, edge] of edges.entries()) {
    const [from, to, road, direction, distance, time, start, end] = edge;
    if (road === closedRoad) continue;
    const vertices = [{id: from, fraction: 0, coordinate: start},
      ...(cuts.get(index) || []).sort((a, b) => a.fraction - b.fraction),
      {id: to, fraction: 1, coordinate: end}];
    for (let i = 1; i < vertices.length; i++) {
      const a = vertices[i - 1], b = vertices[i];
      const fraction = b.fraction - a.fraction;
      if (direction !== "TF") connect(a.id, b.id, a.coordinate, b.coordinate, distance * fraction, time * fraction, road);
      if (direction !== "FT") connect(b.id, a.id, b.coordinate, a.coordinate, distance * fraction, time * fraction, road);
    }
  }

  function search(start, reverse, targets) {
    const queue = [[0, start]], costs = new Map([[start, 0]]), parents = new Map();
    const remaining = new Set(targets);
    while (queue.length && remaining.size) {
      const [cost, node] = queue[0];
      const last = queue.pop();
      if (queue.length) {
        let i = 0;
        while (2 * i + 1 < queue.length) {
          let child = 2 * i + 1;
          if (child + 1 < queue.length && queue[child + 1][0] < queue[child][0]) child++;
          if (queue[child][0] >= last[0]) break;
          queue[i] = queue[child];
          i = child;
        }
        queue[i] = last;
      }
      if (cost !== costs.get(node)) continue;
      remaining.delete(node);
      for (const arc of (reverse ? incoming : outgoing).get(node) || []) {
        const next = reverse ? arc.from : arc.to;
        const time = cost + arc.time;
        if (time >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, time);
        parents.set(next, arc);
        let i = queue.length;
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (queue[parent][0] <= time) break;
          queue[i] = queue[parent];
          i = parent;
        }
        queue[i] = [time, next];
      }
    }
    return {costs, parents};
  }

  function route(node, searchResult, reverse) {
    const arcs = [];
    for (let arc = searchResult.parents.get(node); arc; arc = searchResult.parents.get(node)) {
      arcs.push(arc);
      node = reverse ? arc.to : arc.from;
    }
    if (!reverse) arcs.reverse();
    return {arcs, time: arcs.reduce((sum, arc) => sum + arc.time, 0),
      distance: arcs.reduce((sum, arc) => sum + arc.distance, 0)};
  }

  const available = stations.filter(([, name]) => name !== unavailable);
  const towardIncident = search(incident.id, true, available.map(([node]) => node));
  const ranked = available.filter(([node]) => towardIncident.costs.has(node))
    .sort((a, b) => towardIncident.costs.get(a[0]) - towardIncident.costs.get(b[0]) || a[1].localeCompare(b[1]))
    .slice(0, 3).map(([node, station]) => ({station, ...route(node, towardIncident, true)}));
  let onward = null;
  if (destination) {
    const fromIncident = search(incident.id, false, [destination.id]);
    if (fromIncident.costs.has(destination.id)) onward = route(destination.id, fromIncident, false);
  }
  return {incident, destination, ranked, onward};
}

if (typeof module !== "undefined") module.exports = solveScenario;
