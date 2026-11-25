"use strict";

const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat("ko-KR");
const kinds = ["stations", "prices"];
const titles = { extract: "지역 데이터 추출", lookup: "지도에서 주유소·유가 조회" };
const fileState = {};
const province = byId("province");
const district = byId("district");
const summary = byId("summary");
const result = byId("lookup-result");
const detail = byId("station-detail");
const map = new FuelMap(byId("map"), showStation);
const boundaryStates = new Map();
let mode, origin, regionRows, currentRows;

function message(text, tag = "p") {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function showStation(item, history) {
  const { row } = item;
  const name = message(row.주유소명 || "이름 없는 주유소", "h3");
  const address = message(row.소재지도로명주소 || row.소재지지번주소 || "주소 정보 없음");
  const details = [row.상표구분명 || history?.[0]?.상표, history?.[0]?.셀프여부].filter(Boolean);
  detail.replaceChildren(name, address);
  if (details.length) detail.append(message(details.join(" · ")));
  if (!history?.length) {
    detail.append(message("연결된 가격 기록 없음"));
    return;
  }
  detail.append(message("단위 원/L"));
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "날짜별 판매가격");
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  for (const label of ["날짜", ...FuelData.fuels]) {
    const cell = message(label, "th");
    cell.scope = "col";
    header.append(cell);
  }
  const body = table.createTBody();
  for (const price of history) {
    const tr = body.insertRow();
    const date = price.기간.trim();
    tr.insertCell().textContent = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6);
    for (const fuel of FuelData.fuels) {
      const cell = tr.insertCell();
      const value = price[fuel].trim();
      if (!value || Number(value) === 0) {
        cell.textContent = "—";
        cell.title = "가격 정보 없음";
        cell.setAttribute("aria-label", "가격 정보 없음");
      } else {
        const [integer, fractional] = value.split(".");
        cell.textContent = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fractional === undefined ? "" : "." + fractional);
      }
    }
  }
  wrap.append(table);
  detail.append(wrap, message("— 가격 정보 없음"));
}

function updateBoundaryStatus() {
  const status = byId("boundary-status");
  const { loading, error } = boundaryStates.get(province.value) || {};
  byId("boundary-controls").hidden = mode !== "lookup" || !(loading || error);
  status.textContent = error || (loading ? "행정동 경계를 불러오는 중입니다…" : "");
  status.classList.toggle("error", Boolean(error));
  byId("boundary-recovery").hidden = !error;
}

async function fetchBoundaries(code) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("boundaries/" + code + ".gz", { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const decoded = response.body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(decoded).json();
    } catch (error) {
      if (attempt === 1 || !(error instanceof TypeError || error.name === "TimeoutError")) throw error;
    }
  }
}

async function loadBoundaries(name, file) {
  const code = boundaryCodes.get(name);
  const previous = boundaryStates.get(name);
  if ((!code && !file) || previous?.districts || previous?.loading) return;
  const state = { loading: true };
  boundaryStates.set(name, state);
  updateBoundaryStatus();
  try {
    const geojson = file ? JSON.parse(await file.text()) : await fetchBoundaries(code);
    const districts = FuelData.boundaryIndex(geojson).get(name);
    if (!districts) throw new Error("Missing province");
    state.districts = districts;
  } catch {
    state.error = file
      ? "선택한 파일에서 이 지역의 경계를 읽을 수 없습니다. HangJeongDong_ver20261001.geojson을 선택하세요."
      : "이 지역의 행정동 경계를 불러오지 못했습니다. 다시 시도하거나 로컬 경계 파일을 선택하세요.";
  } finally {
    state.loading = false;
    if (mode === "lookup" && province.value === name) refreshResult();
  }
}

function options(select, values, placeholder, selected) {
  select.replaceChildren(new Option(placeholder, ""), ...values.map(value => new Option(value, value)));
  if (values.includes(selected)) select.value = selected;
}

function refreshRegions() {
  const ready = kinds.every(kind => fileState[kind]?.rows);
  const oldProvince = province.value;
  const oldDistrict = district.value;
  regionRows = new Map();
  if (ready) {
    for (const kind of kinds) {
      for (const [index, row] of fileState[kind].rows.entries()) {
        const area = FuelData.regionOf(row, kind);
        if (!regionRows.has(area.province)) regionRows.set(area.province, new Map());
        const groups = regionRows.get(area.province);
        if (!groups.has(area.district)) groups.set(area.district, { stations: [], prices: [] });
        groups.get(area.district)[kind].push({ row, area, index });
      }
    }
  }
  const provinces = [...regionRows.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  const automatic = mode === "lookup" && provinces.length === 1;
  options(province, provinces, "시·도를 선택하세요", oldProvince || (automatic ? provinces[0] : ""));
  province.disabled = !provinces.length;
  refreshDistricts(oldDistrict, automatic);
  if (ready && !provinces.length) summary.textContent = "두 CSV에 표시할 지역 데이터가 없습니다.";
}

function refreshDistricts(selected = "", automatic = false) {
  const groups = regionRows.get(province.value);
  const districts = groups ? [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko")) : [];
  options(district, districts, "전체", selected || (automatic && groups?.size === 1 ? districts[0] : ""));
  district.disabled = !groups || !districts.length;
  refreshResult();
}

function refreshResult() {
  const groups = regionRows.get(province.value);
  byId("save-stations").disabled = !groups;
  byId("save-prices").disabled = !groups;
  result.hidden = mode !== "lookup" || !groups;
  updateBoundaryStatus();
  if (!groups) {
    currentRows = null;
    summary.textContent = regionRows.size ? "조회하거나 저장할 지역을 선택하세요." : "CSV 두 개를 선택하면 지역을 고를 수 있습니다.";
    if (mode === "lookup") map.setData([], [], new Map());
    return;
  }
  const selected = district.value ? [groups.get(district.value)] : [...groups.values()];
  currentRows = Object.fromEntries(kinds.map(kind => {
    const items = selected.flatMap(group => group[kind]);
    return [kind, items.sort((a, b) => a.index - b.index)];
  }));
  summary.textContent = "주유소 기본정보 " + number.format(currentRows.stations.length) +
    "건 · 판매가격 " + number.format(currentRows.prices.length) + "건";
  if (mode !== "lookup") return;
  if (!boundaryStates.has(province.value)) loadBoundaries(province.value);
  const { districts, loading } = boundaryStates.get(province.value) || {};
  const polygons = district.value ? districts?.get(district.value) || [] : [...(districts?.values() || [])].flat();
  const coordinates = currentRows.stations.filter(item => {
    item.point = FuelData.coordinates(item.row);
    return item.point;
  });
  const { linked, unlinked } = FuelData.join(currentRows.stations, currentRows.prices);
  const counts = [
    "지도에 표시된 주유소 " + number.format(coordinates.length) + "곳",
    "유효한 좌표 없음 " + number.format(currentRows.stations.length - coordinates.length) + "곳",
    "가격 미연결 기록 " + number.format(unlinked) + "건",
  ];
  if (!polygons.length && !loading) counts.push("선택한 지역의 경계를 확인할 수 없습니다.");
  byId("map-note").textContent = counts.join(" · ");
  detail.replaceChildren(message(coordinates.length ? "지도에서 주유소를 선택하세요." : "표시할 주유소가 없습니다."));
  map.setData(polygons, coordinates, linked);
}

function save(kind) {
  if (!currentRows) return;
  const { csv, range } = FuelData.exportCsv(kind, currentRows[kind].map(({ row }) => row));
  const parts = [province.value, district.value, kind === "stations" ? "주유소" : "판매가격", range];
  const fileName = parts.filter(Boolean).join("_").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") + ".csv";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileMessage(kind, text, error = false) {
  const status = byId(kind + "-status");
  status.textContent = text;
  status.classList.toggle("error", error);
}

async function readFile(kind) {
  const [file] = byId(kind).files;
  const request = fileState[kind] = {};
  if (!file) {
    fileMessage(kind, "파일을 선택하세요.");
    refreshRegions();
    return;
  }
  fileMessage(kind, file.name + " 읽는 중…");
  refreshRegions();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== fileState[kind]) return;
    request.rows = FuelData.read(bytes, kind);
    fileMessage(kind, file.name + " · " + number.format(request.rows.length) + "건 · 검증 완료");
  } catch (error) {
    if (request !== fileState[kind]) return;
    fileMessage(kind, file.name + " · " + error.message, true);
  }
  refreshRegions();
}

for (const kind of kinds) byId(kind).addEventListener("change", () => readFile(kind));
for (const button of document.querySelectorAll("[data-open]")) {
  button.onclick = () => {
    origin = button;
    mode = button.dataset.open;
    byId("title").textContent = titles[mode];
    byId("home").hidden = true;
    byId("workflow").hidden = false;
    byId("exports").hidden = mode !== "extract";
    refreshRegions();
    byId("title").focus();
  };
}
byId("back").onclick = () => {
  mode = null;
  updateBoundaryStatus();
  for (const kind of kinds) {
    fileState[kind] = null;
    byId(kind).value = "";
    fileMessage(kind, "파일을 선택하세요.");
  }
  province.value = "";
  district.value = "";
  map.setData([], [], new Map());
  refreshRegions();
  byId("workflow").hidden = true;
  byId("home").hidden = false;
  origin.focus();
};
province.onchange = () => refreshDistricts();
district.onchange = refreshResult;
byId("save-stations").onclick = () => save("stations");
byId("save-prices").onclick = () => save("prices");
byId("retry").onclick = () => loadBoundaries(province.value);
byId("boundary-file").onchange = event => {
  const [file] = event.currentTarget.files;
  event.currentTarget.value = "";
  if (file) loadBoundaries(province.value, file);
};
