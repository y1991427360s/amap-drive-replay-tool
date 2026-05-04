import {
  AMAP_JS_KEY,
  AMAP_SECURITY_CODE,
  AMAP_SERVICE_KEY,
} from "./config.js";

const AMAP_JS_URL = "https://webapi.amap.com/maps?v=2.0";
const AMAP_REST_URL = "https://restapi.amap.com/v3";
const DEFAULT_CENTER = [117.12, 36.65];
const ROUTE_COLOR = "#1478ff";
const PASSED_COLOR = "#1fb56f";
const MAX_ANIMATION_POINTS = 4500;
const MAX_DRAW_POINTS = 9000;
const BASE_PLAYBACK_SECONDS = 90;
const AMAP_REQUEST_INTERVAL = 700;
const AMAP_RETRY_DELAYS = [900, 1800, 3200, 5000];
const AMAP_RETRYABLE_ERRORS = new Set(["CUQPS_HAS_EXCEEDED_THE_LIMIT", "IP_QUERY_OVER_LIMIT"]);
const STORAGE_KEYS = {
  config: "driveReplay.amapConfig",
  waypoints: "driveReplay.waypoints",
  legacySegments: "driveReplay.segments",
};

const dom = {
  jsKeyInput: document.querySelector("#jsKeyInput"),
  serviceKeyInput: document.querySelector("#serviceKeyInput"),
  securityCodeInput: document.querySelector("#securityCodeInput"),
  saveConfigBtn: document.querySelector("#saveConfigBtn"),
  clearConfigBtn: document.querySelector("#clearConfigBtn"),
  addWaypointBtn: document.querySelector("#addWaypointBtn"),
  loadDefaultBtn: document.querySelector("#loadDefaultBtn"),
  saveWaypointsBtn: document.querySelector("#saveWaypointsBtn"),
  clearWaypointsBtn: document.querySelector("#clearWaypointsBtn"),
  waypointsEditor: document.querySelector("#waypointsEditor"),
  loadBtn: document.querySelector("#loadBtn"),
  playBtn: document.querySelector("#playBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  resumeBtn: document.querySelector("#resumeBtn"),
  restartBtn: document.querySelector("#restartBtn"),
  speedSelect: document.querySelector("#speedSelect"),
  customSpeedInput: document.querySelector("#customSpeedInput"),
  message: document.querySelector("#message"),
  statusBadge: document.querySelector("#statusBadge"),
  currentSegment: document.querySelector("#currentSegment"),
  segmentCount: document.querySelector("#segmentCount"),
  totalDistance: document.querySelector("#totalDistance"),
  totalDuration: document.querySelector("#totalDuration"),
};

const state = {
  map: null,
  routeLine: null,
  passedLine: null,
  carMarker: null,
  waypointMarkers: [],
  fullPath: [],
  animationPath: [],
  resolvedWaypoints: [],
  segmentsMeta: [],
  totalDistance: 0,
  totalDuration: 0,
  loaded: false,
  waypointRows: [],
  lastAmapRequestAt: 0,
};

init();

async function init() {
  bindEvents();
  hydrateConfig();
  await hydrateWaypoints();
  renderWaypointRows();
  syncCustomSpeedState();
  setMessage("按顺序填写途经点，系统会自动拼接相邻两点之间的路段。");
}

function bindEvents() {
  dom.saveConfigBtn.addEventListener("click", saveConfig);
  dom.clearConfigBtn.addEventListener("click", clearConfig);
  dom.addWaypointBtn.addEventListener("click", () => {
    syncWaypointRowsFromDom();
    state.waypointRows.push(createEmptyWaypoint());
    renderWaypointRows();
  });
  dom.loadDefaultBtn.addEventListener("click", loadDefaultWaypoints);
  dom.saveWaypointsBtn.addEventListener("click", saveWaypointsFromForm);
  dom.clearWaypointsBtn.addEventListener("click", () => {
    state.waypointRows = [createEmptyWaypoint(), createEmptyWaypoint()];
    renderWaypointRows();
    localStorage.removeItem(STORAGE_KEYS.waypoints);
    setMessage("途经点已清空。");
  });
  dom.waypointsEditor.addEventListener("input", syncWaypointRowsFromDom);
  dom.waypointsEditor.addEventListener("change", syncWaypointRowsFromDom);
  dom.waypointsEditor.addEventListener("click", handleWaypointsEditorClick);
  dom.loadBtn.addEventListener("click", loadRoute);
  dom.playBtn.addEventListener("click", play);
  dom.pauseBtn.addEventListener("click", pause);
  dom.resumeBtn.addEventListener("click", resume);
  dom.restartBtn.addEventListener("click", restart);
  dom.speedSelect.addEventListener("change", () => {
    syncCustomSpeedState();
    if (state.loaded) setMessage(`速度已更新为 ${getPlaybackSpeed()}x，重新播放后生效。`);
  });
  dom.customSpeedInput.addEventListener("input", () => {
    dom.speedSelect.value = "custom";
    if (state.loaded) setMessage(`速度已更新为 ${getPlaybackSpeed()}x，重新播放后生效。`);
  });
}

function hydrateConfig() {
  const saved = readJsonStorage(STORAGE_KEYS.config);
  dom.jsKeyInput.value = saved?.jsKey || cleanPlaceholder(AMAP_JS_KEY);
  dom.serviceKeyInput.value = saved?.serviceKey || cleanPlaceholder(AMAP_SERVICE_KEY);
  dom.securityCodeInput.value = saved?.securityCode || cleanPlaceholder(AMAP_SECURITY_CODE);
}

async function hydrateWaypoints() {
  const saved = readJsonStorage(STORAGE_KEYS.waypoints);
  if (Array.isArray(saved) && saved.length >= 2) {
    state.waypointRows = saved.map(locationToWaypoint);
    return;
  }

  const legacySegments = readJsonStorage(STORAGE_KEYS.legacySegments);
  if (Array.isArray(legacySegments) && legacySegments.length) {
    state.waypointRows = segmentsToWaypoints(legacySegments).map(locationToWaypoint);
    return;
  }

  try {
    const defaults = await fetchDefaultSegments();
    state.waypointRows = segmentsToWaypoints(defaults).map(locationToWaypoint);
  } catch (error) {
    console.warn(error);
    state.waypointRows = [createEmptyWaypoint(), createEmptyWaypoint()];
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(getCurrentConfig()));
  setMessage("高德配置已保存到当前浏览器。");
}

function clearConfig() {
  dom.jsKeyInput.value = "";
  dom.serviceKeyInput.value = "";
  dom.securityCodeInput.value = "";
  localStorage.removeItem(STORAGE_KEYS.config);
  setMessage("高德配置已清空。");
}

async function loadDefaultWaypoints() {
  try {
    const defaults = await fetchDefaultSegments();
    state.waypointRows = segmentsToWaypoints(defaults).map(locationToWaypoint);
    renderWaypointRows();
    localStorage.setItem(STORAGE_KEYS.waypoints, JSON.stringify(collectWaypointsFromRows()));
    setMessage("已读取 data/segments.json 示例，并转换为途经点列表。");
  } catch (error) {
    console.error(error);
    setMessage(error.message || "读取示例失败。", "error");
  }
}

function saveWaypointsFromForm() {
  try {
    syncWaypointRowsFromDom();
    const waypoints = collectWaypointsFromRows();
    localStorage.setItem(STORAGE_KEYS.waypoints, JSON.stringify(waypoints));
    setMessage(`已保存 ${waypoints.length} 个途经点到当前浏览器。`);
  } catch (error) {
    setMessage(error.message || "保存途经点失败。", "error");
  }
}

function handleWaypointsEditorClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  syncWaypointRowsFromDom();
  const index = Number(button.closest(".segment-card")?.dataset.index);
  if (!Number.isInteger(index)) return;

  if (button.dataset.action === "delete") {
    state.waypointRows.splice(index, 1);
    while (state.waypointRows.length < 2) state.waypointRows.push(createEmptyWaypoint());
    renderWaypointRows();
  }
}

async function loadRoute() {
  try {
    saveConfig();
    syncWaypointRowsFromDom();
    const waypoints = collectWaypointsFromRows();
    const segments = waypointsToSegments(waypoints);
    localStorage.setItem(STORAGE_KEYS.waypoints, JSON.stringify(waypoints));

    assertConfig();
    setLoading(true);
    resetRoute();
    setMessage("正在加载高德地图 JS API...");

    await loadAmapScript();
    createMap();
    await validateServiceKey();

    dom.segmentCount.textContent = String(segments.length);
    const result = await buildFullPath(segments);
    state.fullPath = optimizePath(dedupePath(result.fullPath), MAX_DRAW_POINTS);
    state.animationPath = optimizePath(state.fullPath, MAX_ANIMATION_POINTS);
    state.segmentsMeta = result.segmentsMeta;
    state.resolvedWaypoints = result.resolvedWaypoints;
    state.totalDistance = result.totalDistance;
    state.totalDuration = result.totalDuration;

    if (!state.fullPath.length) {
      throw new Error(formatRouteFailure(result.errors));
    }

    drawRoute();
    updateStats();
    fitRouteView();
    state.loaded = true;
    setReady(true);
    if (result.errors.length) {
      setMessage(
        `路线加载完成：有效路段 ${state.segmentsMeta.length} 段，跳过 ${result.errors.length} 段。${result.errors[0]}`,
        "warning",
      );
    } else {
      setMessage(`路线加载完成：有效路段 ${state.segmentsMeta.length} 段。`);
    }
  } catch (error) {
    console.error(error);
    setReady(false, true);
    setMessage(error.message || "路线加载失败，请查看控制台。", "error");
  } finally {
    setLoading(false);
  }
}

async function fetchDefaultSegments() {
  const response = await fetch("./data/segments.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`读取 segments.json 失败：HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) throw new Error("segments.json 必须是非空数组。");
  return data;
}

async function buildFullPath(segments) {
  const fullPath = [];
  const segmentsMeta = [];
  const resolvedWaypoints = [];
  const errors = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const label = getSegmentLabel(segment, index);
    setMessage(`正在处理第 ${index + 1}/${segments.length} 段：${label}`);
    dom.currentSegment.textContent = label;

    try {
      const start = await normalizeLocation(segment.start, `第 ${index + 1} 段起点`);
      const end = await normalizeLocation(segment.end, `第 ${index + 1} 段终点`);
      const route = await requestDrivingRoute(start, end, label);
      const path = extractPolyline(route);

      if (!path.length) {
        const message = `第 ${index + 1} 段路线为空：${label}`;
        errors.push(message);
        warn(`${message}，已跳过。`);
        continue;
      }

      const cleanPath = dedupePath(path);
      appendPath(fullPath, cleanPath);
      if (!resolvedWaypoints.length) resolvedWaypoints.push(start);
      resolvedWaypoints.push(end);

      const distance = Number(route.distance || 0);
      const duration = Number(route.duration || 0);
      totalDistance += distance;
      totalDuration += duration;

      segmentsMeta.push({
        index,
        name: label,
        pointCount: cleanPath.length,
        distance,
        duration,
        cumulativeDistance: totalDistance,
      });
    } catch (error) {
      const message = `${label} 处理失败：${error.message}`;
      errors.push(message);
      warn(`${message}，已跳过。`);
      console.error(error);
    }
  }

  return { fullPath, resolvedWaypoints, segmentsMeta, totalDistance, totalDuration, errors };
}

async function normalizeLocation(input, label) {
  if (typeof input === "string") return geocode(input, label);

  if (
    input &&
    typeof input === "object" &&
    Number.isFinite(Number(input.lng)) &&
    Number.isFinite(Number(input.lat))
  ) {
    return {
      name: input.name || `${input.lng},${input.lat}`,
      lng: Number(input.lng),
      lat: Number(input.lat),
    };
  }

  throw new Error(`${label} 格式无效，必须是地址字符串或包含 lng/lat 的对象。`);
}

async function geocode(address, label) {
  const params = new URLSearchParams({
    key: getCurrentConfig().serviceKey,
    address,
  });
  const data = await requestAmap(`${AMAP_REST_URL}/geocode/geo?${params}`);

  if (data.status !== "1" || !data.geocodes?.length) {
    throw new Error(`${label} 地址解析失败：${address}。${formatAmapError(data.info)}`);
  }

  const [lng, lat] = data.geocodes[0].location.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${label} 地址解析结果无效：${address}`);
  }

  return { name: address, lng, lat };
}

async function requestDrivingRoute(start, end, label) {
  const params = new URLSearchParams({
    key: getCurrentConfig().serviceKey,
    origin: `${start.lng},${start.lat}`,
    destination: `${end.lng},${end.lat}`,
    extensions: "all",
    strategy: "0",
  });
  const data = await requestAmap(`${AMAP_REST_URL}/direction/driving?${params}`);

  if (data.status !== "1" || !data.route?.paths?.length) {
    throw new Error(`路线规划失败：${label}。${formatAmapError(data.info)}`);
  }

  return data.route.paths[0];
}

async function requestAmap(url) {
  for (let attempt = 0; attempt <= AMAP_RETRY_DELAYS.length; attempt += 1) {
    await throttleAmapRequest();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`高德 Web Service 请求失败：HTTP ${response.status}`);

    const data = await response.json();
    if (!AMAP_RETRYABLE_ERRORS.has(data.info) || attempt === AMAP_RETRY_DELAYS.length) {
      return data;
    }

    setMessage(`高德接口触发限流，${AMAP_RETRY_DELAYS[attempt] / 1000} 秒后重试...`, "warning");
    await sleep(AMAP_RETRY_DELAYS[attempt]);
  }

  throw new Error("高德 Web Service 请求失败。");
}

async function throttleAmapRequest() {
  const elapsed = Date.now() - state.lastAmapRequestAt;
  if (elapsed < AMAP_REQUEST_INTERVAL) {
    await sleep(AMAP_REQUEST_INTERVAL - elapsed);
  }
  state.lastAmapRequestAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function validateServiceKey() {
  setMessage("正在检测 Web Service Key...");
  const params = new URLSearchParams({
    key: getCurrentConfig().serviceKey,
    address: "北京市天安门",
    city: "北京",
  });
  const data = await requestAmap(`${AMAP_REST_URL}/geocode/geo?${params}`);

  if (data.status !== "1") {
    throw new Error(`Web Service Key 检测失败：${formatAmapError(data.info)}。`);
  }

  if (!data.geocodes?.length) {
    throw new Error("Web Service Key 检测失败：地理编码服务没有返回结果。");
  }
}

function extractPolyline(routePath) {
  const points = [];
  for (const step of routePath.steps || []) {
    if (!step.polyline) continue;
    for (const item of step.polyline.split(";")) {
      const [lng, lat] = item.split(",").map(Number);
      if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng, lat]);
    }
  }
  return points;
}

function appendPath(target, path) {
  if (!path.length) return;
  if (!target.length) {
    target.push(...path);
    return;
  }

  const last = target[target.length - 1];
  target.push(...path.slice(samePoint(last, path[0]) ? 1 : 0));
}

function dedupePath(path) {
  const result = [];
  for (const point of path) {
    if (!result.length || !samePoint(result[result.length - 1], point)) result.push(point);
  }
  return result;
}

function optimizePath(path, maxPoints) {
  if (path.length <= maxPoints) return path;

  const step = Math.ceil(path.length / maxPoints);
  const result = path.filter((_, index) => index % step === 0);
  const last = path[path.length - 1];
  if (!samePoint(result[result.length - 1], last)) result.push(last);

  warn(`轨迹点过多，已按间隔 ${step} 采样：${path.length} -> ${result.length}`);
  return result;
}

function samePoint(a, b) {
  return a && b && Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001;
}

function drawRoute() {
  state.routeLine = new AMap.Polyline({
    path: state.fullPath,
    strokeColor: ROUTE_COLOR,
    strokeWeight: 7,
    strokeOpacity: 0.9,
    lineJoin: "round",
    lineCap: "round",
    showDir: true,
    zIndex: 40,
  });

  state.passedLine = new AMap.Polyline({
    path: [],
    strokeColor: PASSED_COLOR,
    strokeWeight: 7,
    strokeOpacity: 0.95,
    lineJoin: "round",
    lineCap: "round",
    zIndex: 45,
  });

  state.carMarker = new AMap.Marker({
    map: state.map,
    position: state.animationPath[0],
    anchor: "center",
    content: createCarIcon(),
    zIndex: 60,
  });

  state.carMarker.on("moving", (event) => {
    if (event.passedPath?.length) {
      state.passedLine.setPath(event.passedPath);
      updateCurrentSegmentByProgress(event.passedPath.length);
    }
  });

  state.map.add([state.routeLine, state.passedLine]);
  drawWaypointMarkers();
}

function drawWaypointMarkers() {
  state.waypointMarkers = state.resolvedWaypoints.map((point, index) => {
    const marker = new AMap.Marker({
      map: state.map,
      position: [point.lng, point.lat],
      anchor: "bottom-center",
      content: createWaypointMarker(point, index),
      zIndex: 55,
    });
    marker.setTitle(point.name || `途经点 ${index + 1}`);
    return marker;
  });
}

function createWaypointMarker(point, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "waypoint-marker";
  wrapper.innerHTML = `
    <span class="waypoint-index">${index + 1}</span>
    <span class="waypoint-label">${escapeHtml(point.name || `途经点 ${index + 1}`)}</span>
  `;
  return wrapper;
}

function createCarIcon() {
  const wrapper = document.createElement("div");
  wrapper.className = "car-marker";
  wrapper.innerHTML = `
    <svg viewBox="0 0 48 48" role="img" aria-label="小车">
      <path d="M24 3 39 42 24 35 9 42 24 3Z" fill="#ffffff" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>
      <path d="M24 10 32 32 24 28 16 32 24 10Z" fill="#1478ff"/>
    </svg>
  `;
  return wrapper;
}

function play() {
  if (!canPlay()) return;

  stopAnimation();
  state.passedLine.setPath([]);
  state.carMarker.setPosition(state.animationPath[0]);
  state.carMarker.moveAlong(state.animationPath, {
    duration: getSegmentAnimationDuration(),
    autoRotation: true,
  });

  setMessage("轨迹播放中。");
  setPlaybackButtons("playing");
}

function pause() {
  if (!state.carMarker) return;
  state.carMarker.pauseMove();
  setMessage("播放已暂停。");
  setPlaybackButtons("paused");
}

function resume() {
  if (!state.carMarker) return;
  state.carMarker.resumeMove();
  setMessage("继续播放。");
  setPlaybackButtons("playing");
}

function restart() {
  play();
}

function stopAnimation() {
  if (state.carMarker?.stopMove) state.carMarker.stopMove();
}

function canPlay() {
  if (!state.fullPath.length || !state.animationPath.length) {
    setMessage("fullPath 为空，禁止播放动画。", "error");
    return false;
  }
  if (!state.carMarker) {
    setMessage("小车未初始化，请先加载路线。", "error");
    return false;
  }
  return true;
}

function getSegmentAnimationDuration() {
  const speed = getPlaybackSpeed();
  const pointCountFactor = Math.min(2.5, Math.max(0.7, state.animationPath.length / 1200));
  const totalPlaybackMs = Math.max(8000, (BASE_PLAYBACK_SECONDS * 1000 * pointCountFactor) / speed);
  return Math.max(8, totalPlaybackMs / Math.max(1, state.animationPath.length - 1));
}

function getPlaybackSpeed() {
  const rawValue =
    dom.speedSelect.value === "custom" ? dom.customSpeedInput.value : dom.speedSelect.value;
  const speed = Number(rawValue);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(200, Math.max(0.1, speed));
}

function syncCustomSpeedState() {
  const isCustom = dom.speedSelect.value === "custom";
  dom.customSpeedInput.disabled = !isCustom;
  if (!isCustom) dom.customSpeedInput.value = dom.speedSelect.value;
}

function createMap() {
  if (state.map) return;

  state.map = new AMap.Map("map", {
    zoom: 6,
    center: DEFAULT_CENTER,
    viewMode: "2D",
    resizeEnable: true,
  });
}

function fitRouteView() {
  if (state.map && state.routeLine) state.map.setFitView([state.routeLine], false, [80, 80, 80, 460]);
}

function resetRoute() {
  stopAnimation();
  state.loaded = false;
  state.fullPath = [];
  state.animationPath = [];
  state.resolvedWaypoints = [];
  state.segmentsMeta = [];
  state.totalDistance = 0;
  state.totalDuration = 0;

  if (state.map) state.map.clearMap();

  state.routeLine = null;
  state.passedLine = null;
  state.carMarker = null;
  state.waypointMarkers = [];
  dom.currentSegment.textContent = "-";
  dom.segmentCount.textContent = "0";
  dom.totalDistance.textContent = "0 km";
  dom.totalDuration.textContent = "0 分钟";
  setPlaybackButtons("empty");
}

function updateStats() {
  dom.segmentCount.textContent = String(state.segmentsMeta.length);
  dom.totalDistance.textContent = formatDistance(state.totalDistance);
  dom.totalDuration.textContent = formatDuration(state.totalDuration);
  dom.currentSegment.textContent = state.segmentsMeta[0]?.name || "-";
}

function updateCurrentSegmentByProgress(passedPointCount) {
  if (!state.segmentsMeta.length) return;

  const progressRatio = Math.min(1, passedPointCount / Math.max(1, state.animationPath.length));
  const targetDistance = state.totalDistance * progressRatio;
  const current =
    state.segmentsMeta.find((segment) => targetDistance <= segment.cumulativeDistance) ||
    state.segmentsMeta[state.segmentsMeta.length - 1];

  dom.currentSegment.textContent = current.name;
}

function renderWaypointRows() {
  dom.waypointsEditor.innerHTML = state.waypointRows
    .map((row, index) => renderWaypointRow(row, index))
    .join("");
  updateWaypointVisibility();
}

function renderWaypointRow(row, index) {
  const role = index === 0 ? "起点" : index === state.waypointRows.length - 1 ? "终点" : "途经点";
  return `
    <article class="segment-card waypoint-card" data-index="${index}">
      <div class="segment-card-header">
        <strong>${role} ${index + 1}</strong>
        <button type="button" class="icon-btn" data-action="delete" aria-label="删除途经点">删除</button>
      </div>
      ${renderWaypointInput(row)}
    </article>
  `;
}

function renderWaypointInput(data) {
  const type = data.type || "address";
  return `
    <div class="endpoint waypoint" data-prefix="point">
      <div class="endpoint-title">
        <span>位置</span>
        <select data-field="type">
          <option value="address" ${type === "address" ? "selected" : ""}>地址</option>
          <option value="coords" ${type === "coords" ? "selected" : ""}>经纬度</option>
        </select>
      </div>
      <label class="input-field address-field">
        <span>地址</span>
        <input data-field="address" value="${escapeAttr(data.address)}" placeholder="例如：青岛市五四广场" />
      </label>
      <div class="coords-fields">
        <label class="input-field">
          <span>名称</span>
          <input data-field="name" value="${escapeAttr(data.name)}" placeholder="例如：青岛五四广场" />
        </label>
        <label class="input-field">
          <span>经纬度</span>
          <input data-field="coords" value="${escapeAttr(data.coords)}" placeholder="120.3841, 36.0608" inputmode="decimal" />
        </label>
      </div>
    </div>
  `;
}

function updateWaypointVisibility() {
  for (const waypoint of dom.waypointsEditor.querySelectorAll(".waypoint")) {
    const type = waypoint.querySelector('[data-field="type"]').value;
    waypoint.classList.toggle("is-coords", type === "coords");
  }
}

function syncWaypointRowsFromDom() {
  const rows = [];
  for (const card of dom.waypointsEditor.querySelectorAll(".segment-card")) {
    rows.push({
      type: getFieldValue(card, "type") || "address",
      address: getFieldValue(card, "address"),
      name: getFieldValue(card, "name"),
      coords: getFieldValue(card, "coords"),
    });
  }
  if (rows.length) state.waypointRows = rows;
  updateWaypointVisibility();
}

function getFieldValue(scope, field) {
  return scope.querySelector(`[data-field="${field}"]`)?.value.trim() || "";
}

function collectWaypointsFromRows() {
  const waypoints = state.waypointRows.map((row, index) => collectWaypoint(row, `第 ${index + 1} 个点`));
  if (waypoints.length < 2) throw new Error("请至少填写 2 个途经点。");
  return waypoints;
}

function collectWaypoint(row, label) {
  if (row.type === "coords") {
    const { lng, lat } = parseCoords(row.coords, label);
    return {
      name: row.name || `${lng},${lat}`,
      lng,
      lat,
    };
  }

  if (!row.address) throw new Error(`${label} 地址不能为空。`);
  return row.address;
}

function formatRouteFailure(errors) {
  if (!errors?.length) {
    return "fullPath 为空，没有可播放轨迹。请检查地址或经纬度。";
  }

  const sample = errors.slice(0, 4).join("；");
  const suffix = errors.length > 4 ? `；还有 ${errors.length - 4} 条失败信息，请查看控制台。` : "";
  return `fullPath 为空，所有路段都规划失败。${sample}${suffix}`;
}

function formatAmapError(info) {
  const knownErrors = {
    USERKEY_PLAT_NOMATCH:
      "USERKEY_PLAT_NOMATCH。Key 平台类型不匹配，请在 Web Service Key 输入框填写“Web服务”类型 Key，不要填写 JS API Key",
    INVALID_USER_KEY: "INVALID_USER_KEY。Key 无效，请检查是否复制完整",
    SERVICE_NOT_AVAILABLE:
      "SERVICE_NOT_AVAILABLE。当前 Key 没有开通这个 Web Service 服务或服务不可用",
    DAILY_QUERY_OVER_LIMIT: "DAILY_QUERY_OVER_LIMIT。Key 当日调用量已超限",
    CUQPS_HAS_EXCEEDED_THE_LIMIT: "CUQPS_HAS_EXCEEDED_THE_LIMIT。接口访问频率超限，程序会自动降速重试",
    IP_QUERY_OVER_LIMIT: "IP_QUERY_OVER_LIMIT。Key 当前访问频率过高",
    USER_DAILY_QUERY_OVER_LIMIT: "USER_DAILY_QUERY_OVER_LIMIT。账号当日调用量已超限",
  };

  return knownErrors[info] || info || "未知错误";
}

function parseCoords(value, label) {
  const parts = value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length !== 2) throw new Error(`${label} 经纬度格式应为：经度, 纬度。`);

  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`${label} 经纬度必须是数字，格式例如：120.3841, 36.0608。`);
  }

  if (isLikelyChinaLatLng(lng, lat)) {
    return { lng: lat, lat: lng };
  }

  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`${label} 经纬度超出有效范围。`);
  }

  return { lng, lat };
}

function isLikelyChinaLatLng(first, second) {
  return first >= 18 && first <= 54 && second >= 73 && second <= 136;
}

function waypointsToSegments(waypoints) {
  const segments = [];
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    segments.push({
      start: waypoints[index],
      end: waypoints[index + 1],
    });
  }
  return segments;
}

function segmentsToWaypoints(segments) {
  const points = [];
  for (const segment of segments) {
    if (!points.length) points.push(segment.start);
    points.push(segment.end);
  }
  return points;
}

function locationToWaypoint(location) {
  if (typeof location === "string") {
    return { type: "address", address: location, name: "", coords: "" };
  }
  if (location && typeof location === "object") {
    return {
      type: "coords",
      address: "",
      name: location.name || "",
      coords:
        Number.isFinite(Number(location.lng)) && Number.isFinite(Number(location.lat))
          ? `${location.lng}, ${location.lat}`
          : "",
    };
  }
  return createEmptyWaypoint();
}

function createEmptyWaypoint() {
  return { type: "address", address: "", name: "", coords: "" };
}

function getSegmentLabel(segment, index) {
  const start = getLocationName(segment?.start) || "未知起点";
  const end = getLocationName(segment?.end) || "未知终点";
  return `${index + 1}. ${start} -> ${end}`;
}

function getLocationName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || `${value.lng},${value.lat}`;
  return "";
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 km";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 分钟";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

function getCurrentConfig() {
  return {
    jsKey: dom.jsKeyInput.value.trim(),
    serviceKey: dom.serviceKeyInput.value.trim(),
    securityCode: dom.securityCodeInput.value.trim(),
  };
}

function assertConfig() {
  const config = getCurrentConfig();
  if (!config.jsKey) throw new Error("请先填写 JS API Key。");
  if (!config.serviceKey) throw new Error("请先填写 Web Service Key。");
}

function loadAmapScript() {
  if (window.AMap) return Promise.resolve();

  const config = getCurrentConfig();
  if (config.securityCode) {
    window._AMapSecurityConfig = { securityJsCode: config.securityCode };
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${AMAP_JS_URL}&key=${encodeURIComponent(config.jsKey)}&plugin=AMap.MoveAnimation`;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("高德地图 JS API 加载失败。"));
    document.head.appendChild(script);
  });
}

function setPlaybackButtons(mode) {
  const hasPath = state.fullPath.length > 0;
  dom.playBtn.disabled = !hasPath || mode === "playing";
  dom.pauseBtn.disabled = mode !== "playing";
  dom.resumeBtn.disabled = mode !== "paused";
  dom.restartBtn.disabled = !hasPath;
}

function setLoading(isLoading) {
  dom.loadBtn.disabled = isLoading;
  if (isLoading) {
    dom.statusBadge.textContent = "加载中";
    dom.statusBadge.className = "status-badge loading";
  }
}

function setReady(isReady, isError = false) {
  if (isError) {
    dom.statusBadge.textContent = "错误";
    dom.statusBadge.className = "status-badge error";
    return;
  }

  dom.statusBadge.textContent = isReady ? "已就绪" : "未加载";
  dom.statusBadge.className = isReady ? "status-badge ready" : "status-badge";
  setPlaybackButtons(isReady ? "ready" : "empty");
}

function setMessage(text, type = "normal") {
  dom.message.textContent = text;
  dom.message.className = type === "normal" ? "message" : `message ${type}`;
}

function warn(text) {
  console.warn(text);
  setMessage(text, "warning");
}

function cleanPlaceholder(value) {
  if (!value || value.includes("请在这里填写") || value.includes("如果需要")) return "";
  return value;
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
