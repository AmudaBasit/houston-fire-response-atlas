"use strict";

const byId = id => document.getElementById(id);
const data = window.houstonData;
const map = byId("map");
const ctx = map.getContext("2d");
const results = byId("results");
const mode = byId("mode");
const scenario = byId("scenario");
const incident = byId("incident");
const cutoff = byId("cutoff");
const scaleX = 96700;
const scaleY = 110850;
let rank = 1;
let zoom = 1;
let pan = [0, 0];
let drag = null;
const network = window.houstonNetwork;
const pins = {incident: null, destination: null};
let placement = null;
let customProjection;
let customResult;
let customError;

const role = (feature, name) => feature.properties.role === name;
const format = (value, digits = 1) => value.toLocaleString("en-US", {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});

function lineList(feature) {
  const {type, coordinates} = feature.geometry;
  return type === "LineString" ? [coordinates] : coordinates;
}

function fit(points, width, height) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  const pixelsPerMeter = zoom * Math.min(
    Math.max(1, width - 70) / Math.max(50, (east - west) * scaleX),
    Math.max(1, height - 70) / Math.max(50, (north - south) * scaleY),
  );
  const originX = width / 2 + pan[0];
  const originY = height / 2 + pan[1];
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const project = ([x, y]) => [
    originX + (x - centerX) * scaleX * pixelsPerMeter,
    originY - (y - centerY) * scaleY * pixelsPerMeter,
  ];
  project.unproject = (x, y) => [
    centerX + (x - originX) / (scaleX * pixelsPerMeter),
    centerY - (y - originY) / (scaleY * pixelsPerMeter),
  ];
  return project;
}

function stroke(lines, project, color, width, dash = []) {
  ctx.beginPath();
  for (const [first, ...rest] of lines) {
    ctx.moveTo(...project(first));
    for (const point of rest) ctx.lineTo(...project(point));
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function coverageLines(index) {
  const {segments, origin, coordinateScale} = data.coverage;
  const lines = [];
  for (let offset = 0; offset < segments.length; offset += 5) {
    if (!(segments[offset + 4] & (1 << index))) continue;
    const x = origin[0] + segments[offset];
    const y = origin[1] + segments[offset + 1];
    lines.push([[x / coordinateScale, y / coordinateScale],
      [(x + segments[offset + 2]) / coordinateScale, (y + segments[offset + 3]) / coordinateScale]]);
  }
  return lines;
}

function label(point, value, project, color = "#40545b", offset = 0) {
  const [x, y] = project(point);
  ctx.font = offset ? "bold 13px system-ui" : "11px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.strokeText(value, x, y - offset);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y - offset);
}

function marker(feature, project, color, name) {
  const point = feature.geometry.coordinates;
  ctx.beginPath();
  ctx.arc(...project(point), 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  label(point, name, project, color, 11);
}

function paragraph(value, tag = "p") {
  const element = document.createElement(tag);
  element.textContent = value;
  results.append(element);
}

function drawStreetNetwork(project, width, height) {
  const lines = [];
  const names = new Set();
  const occupied = [];
  const labels = [];
  for (const [, , road, , distance, , start, end] of network.edges) {
    const a = project(start), b = project(end);
    if (Math.max(a[0], b[0]) < 0 || Math.min(a[0], b[0]) > width ||
        Math.max(a[1], b[1]) < 0 || Math.min(a[1], b[1]) > height) continue;
    lines.push([a, b]);
    const name = network.roads[road][0];
    if (!name || distance < 30 || names.has(name) || Math.hypot(a[0]-b[0], a[1]-b[1]) < 28) continue;
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    if (x < 50 || x > width-50 || y < 14 || y > height-14 ||
        occupied.some(([px, py]) => Math.abs(px-x) < 100 && Math.abs(py-y) < 22)) continue;
    occupied.push([x, y]);
    names.add(name);
    labels.push([[x, y], name]);
  }
  const identity = point => point;
  stroke(lines, identity, "#a6ada4", 1);
  for (const [point, name] of labels) label(point, name, identity);
}

function calculateCustom() {
  customResult = null;
  customError = null;
  if (!network || !pins.incident) return;
  try {
    customResult = solveScenario(network, pins.incident, pins.destination,
      scenario.value === "closure" ? 4114 : null, byId("unavailable").value);
  } catch (error) {
    customError = error.message;
  }
}

function renderCustom(width, height, closure) {
  byId("map-title").textContent = "Build a scenario · Central Houston";
  byId("legend").textContent = "Teal shows station to incident. Purple shows incident to destination. Dashed lines connect pins to their snapped road points.";
  if (!network) {
    paragraph("The routing network could not load. Refresh to retry.");
    return;
  }
  const boundary = data.reportingBoundary.geometry.coordinates;
  customProjection = fit(boundary[0], width, height);
  const project = customProjection;
  drawStreetNetwork(project, width, height);
  stroke(boundary, project, "#4a676d", 1.2, [5, 4]);
  if (scenario.value === "closure") stroke(lineList(closure), project, "#ba4729", 4, [7, 4]);
  const fastest = customResult?.ranked[0];
  for (const [route, color] of [[fastest, "#08776c"], [customResult?.onward, "#7045a0"]]) {
    if (route) {
      const lines = route.arcs.map(arc => [arc.start, arc.end]);
      stroke(lines, project, "#fff", 7);
      stroke(lines, project, color, 4);
    }
  }
  if (fastest) {
    const station = data.closestFacilities.features.find(f =>
      role(f, "station") && f.properties.station === fastest.station);
    if (station) marker(station, project, "#154875", fastest.station.replace(/ \[ID \d+\]/, "").replace("Houston Fire Dept ", ""));
  }
  for (const [kind, color] of [["incident", "#a62c43"], ["destination", "#7045a0"]]) {
    const point = pins[kind];
    if (!point) continue;
    const snapped = customResult?.[kind]?.coordinate;
    if (snapped) stroke([[point, snapped]], project, color, 2, [3, 3]);
    marker({geometry: {coordinates: point}}, project, color, kind === "incident" ? "Incident" : "Destination");
  }
  if (customError) paragraph(customError);
  else if (!pins.incident) paragraph("Place an incident to calculate routes.");
  else if (!fastest) paragraph("No available modeled station can reach this incident.");
  for (const entry of customResult?.ranked || []) {
    paragraph(entry.station.replace(/ \[ID \d+\]/, "") + " · " +
      format(entry.time) + " s · " + format(entry.distance / 1000, 3) + " km");
  }
  if (customResult) paragraph("Incident snap offset " + format(customResult.incident.offset) + " m" +
    (customResult.destination ? " · Destination snap offset " + format(customResult.destination.offset) + " m" : ""));
  if (pins.incident && pins.destination && customResult) {
    const onward = customResult.onward;
    paragraph(onward ? "Incident to destination · " + format(onward.time) + " s · " +
      format(onward.distance / 1000, 3) + " km" : "No modeled route from the incident to the destination.");
  }
}

function render() {
  const activeScenario = scenario.value;
  const comparison = mode.value === "compare";
  const coverage = mode.value === "coverage";
  const custom = mode.value === "custom";
  byId("incident-control").hidden = comparison || coverage || custom;
  byId("cutoff-control").hidden = comparison || custom;
  byId("custom-controls").hidden = !custom;
  results.replaceChildren();
  const width = map.clientWidth;
  const height = map.clientHeight;
  const resolution = window.devicePixelRatio || 1;
  map.width = Math.round(width * resolution);
  map.height = Math.round(height * resolution);
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const midtown = data.midtown.features;
  const background = midtown.find(f => role(f, "street_background"));
  const closure = midtown.find(f => role(f, "closure"));
  if (custom) {
    renderCustom(width, height, closure);
    return;
  }
  const records = data.closestFacilities.features;
  const points = records.filter(f => role(f, "station"));
  if (coverage) {
    const index = data.coverage.layers.findIndex(layer =>
      layer.scenario === activeScenario && layer.minutes === Number(cutoff.value));
    const layer = data.coverage.layers[index];
    const boundary = data.reportingBoundary.geometry.coordinates;
    const project = fit(boundary[0], width, height);
    stroke(boundary, project, "#4a676d", 1.2, [5, 4]);
    stroke(coverageLines(index), project, "#08776c", 1);
    if (activeScenario === "closure") stroke(lineList(closure), project, "#ba4729", 4);
    byId("map-title").textContent = "Central Houston service area";
    byId("legend").textContent = "Teal lines show reachable roads. Dashed outline shows the reporting boundary.";
    paragraph(format(layer.reachable_km) + " km", "strong");
    paragraph("Road length reachable within " + layer.minutes + " minutes from at least one modeled station.");
    return;
  }

  const incidentId = comparison ? "SIM-02" : incident.value;
  const destination = records.find(f => role(f, "incident") && f.properties.incident_id === incidentId);
  const candidates = records.filter(f => role(f, "closest_facility") &&
    f.properties.incident_id === incidentId && f.properties.scenario === activeScenario &&
    f.properties.modeled_time_seconds <= Number(cutoff.value) * 60);
  const selected = comparison ? midtown.find(f => role(f, "route") && f.properties.scenario === activeScenario)
    : candidates.find(f => f.properties.rank === rank) || candidates[0];
  const station = selected && points.find(f => f.properties.station === selected.properties.station);
  const isMidtown = incidentId === "SIM-02";
  const focus = [destination.geometry.coordinates];
  if (station) focus.push(station.geometry.coordinates);
  if (network && !isMidtown) drawStreetNetwork(project, width, height);
  if (isMidtown) {
    for (const route of midtown.filter(f => role(f, "route"))) focus.push(...lineList(route).flat());
  } else if (selected) {
    focus.push(...lineList(selected).flat());
  }
  const project = fit(focus, width, height);
  if (isMidtown) {
    stroke(lineList(background), project, "#a6ada4", 1.25);
    for (const feature of midtown.filter(f => role(f, "street_label"))) {
      label(feature.geometry.coordinates, feature.properties.name, project);
    }
  }
  if (selected) {
    stroke(lineList(selected), project, "#fff", 8);
    stroke(lineList(selected), project, "#08776c", 5);
  }
  if (activeScenario === "closure") stroke(lineList(closure), project, "#ba4729", 5, [7, 4]);
  if (station) marker(station, project, "#154875", station.properties.station.replace(/ \[ID \d+\]/, "").replace("Houston Fire Dept ", ""));
  marker(destination, project, "#a62c43", incidentId);
  byId("map-title").textContent = destination.properties.area + " · " + incidentId;
  byId("legend").textContent = "Teal route · Blue station · Red simulated incident" +
    (activeScenario === "closure" ? " · Dashed orange closure" : "") +
    (isMidtown ? " · Gray Harris County streets" : "");
  if (!selected) {
    paragraph("No modeled station within the selected cutoff.");
    return;
  }
  const route = selected.properties;
  paragraph(format(route.modeled_time_seconds) + " seconds", "strong");
  paragraph(route.station.replace(/ \[ID \d+\]/, "") + " · " + format(route.distance_meters / 1000, 3) + " km");
  if (comparison && activeScenario === "closure") {
    const baseline = midtown.find(f => role(f, "route") && f.properties.scenario === "baseline");
    paragraph("+" + format(route.modeled_time_seconds - baseline.properties.modeled_time_seconds) + " seconds versus baseline. Station 7 remains fastest.");
  }
  if (!comparison) {
    for (const candidate of candidates) {
      const p = candidate.properties;
      const button = document.createElement("button");
      button.textContent = p.rank + ". " + p.station.replace(/ \[ID \d+\]/, "") + " · " + format(p.modeled_time_seconds) + " s";
      button.setAttribute("aria-pressed", String(candidate === selected));
      button.onclick = () => { rank = p.rank; reset(); };
      results.append(button);
    }
  }
}

function reset() {
  zoom = 1;
  pan = [0, 0];
  render();
}

function armPin(kind) {
  placement = kind;
  for (const name of Object.keys(pins)) {
    byId("place-" + name).setAttribute("aria-pressed", String(kind === name));
  }
  map.style.cursor = kind ? "crosshair" : "";
  byId("placement-help").textContent = kind ? "Click inside the dashed boundary to place the " + kind + "."
    : "Choose a pin, then click inside the dashed boundary.";
}

if (!data || !ctx) {
  results.textContent = "The bundled map data or drawing surface could not load.";
} else {
  for (const feature of data.closestFacilities.features.filter(f => role(f, "incident"))) {
    const p = feature.properties;
    incident.add(new Option(p.area + " · " + p.incident_id, p.incident_id));
  }
  incident.value = "SIM-02";
  for (const kind of Object.keys(pins)) byId("place-" + kind).onclick = () => armPin(kind);
  for (const [, name] of network?.stations || []) {
    byId("unavailable").add(new Option(name.replace(/ \[ID \d+\]/, ""), name));
  }
  byId("unavailable").onchange = () => { calculateCustom(); render(); };
  byId("clear-pins").onclick = () => {
    pins.incident = pins.destination = null;
    armPin(null);
    calculateCustom();
    render();
  };
  for (const control of [mode, scenario, incident, cutoff]) {
    control.onchange = () => {
      rank = 1;
      armPin(null);
      if (mode.value === "custom") calculateCustom();
      reset();
    };
  }
  byId("reset").onclick = reset;
  byId("zoom-in").onclick = () => { zoom = Math.min(16, zoom * 1.4); render(); };
  byId("zoom-out").onclick = () => { zoom = Math.max(.5, zoom / 1.4); render(); };
  map.onpointerdown = event => {
    if (mode.value === "custom" && placement && customProjection) {
      const rect = map.getBoundingClientRect();
      const point = customProjection.unproject(event.clientX - rect.left - map.clientLeft,
        event.clientY - rect.top - map.clientTop);
      const ring = data.reportingBoundary.geometry.coordinates[0];
      const longitudes = ring.map(p => p[0]), latitudes = ring.map(p => p[1]);
      if (point[0] < Math.min(...longitudes) || point[0] > Math.max(...longitudes) ||
          point[1] < Math.min(...latitudes) || point[1] > Math.max(...latitudes)) {
        byId("placement-help").textContent = "Place the pin inside the dashed reporting boundary.";
        return;
      }
      pins[placement] = point;
      armPin(null);
      calculateCustom();
      render();
      return;
    }
    drag = [event.clientX - pan[0], event.clientY - pan[1]];
    map.setPointerCapture(event.pointerId);
  };
  map.onpointermove = event => {
    if (!drag) return;
    pan = [event.clientX - drag[0], event.clientY - drag[1]];
    render();
  };
  map.onpointerup = map.onlostpointercapture = () => { drag = null; };
  new ResizeObserver(render).observe(map);
  render();
}
