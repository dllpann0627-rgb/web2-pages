"use strict";

const FuelData = (() => {
  const stationColumns = "주유소명 시도명 시군구명 소재지도로명주소 소재지지번주소 전화번호 위도 경도 상표구분명 대표자명 총직원수 데이터기준일자 제공기관코드 제공기관명".split(" ");
  const priceColumns = "번호 지역 상호 주소 기간 상표 셀프여부 고급휘발유 휘발유 경유 실내등유".split(" ");
  const fuels = priceColumns.slice(7);
  const columns = { stations: stationColumns, prices: priceColumns };
  const merged = "전남광주통합특별시";
  const legacy = ["전라남도", "광주광역시"];
  // Former districts represented in the bundled October 2026 boundaries.
  const mergedDistricts = new Map([
    ["전라남도", new Set("강진군 고흥군 곡성군 광양시 구례군 나주시 담양군 목포시 무안군 보성군 순천시 신안군 여수시 영광군 영암군 완도군 장성군 장흥군 진도군 함평군 해남군 화순군".split(" "))],
    ["광주광역시", new Set("광산구 남구 동구 북구 서구".split(" "))],
  ]);
  const provinceNames = [
    ["강원특별자치도", "강원도", "강원"], ["경기도", "경기"],
    ["경상남도", "경남"], ["경상북도", "경북"], ["대구광역시", "대구"],
    ["대전광역시", "대전"], ["부산광역시", "부산"], ["서울특별시", "서울"],
    ["세종특별자치시", "세종시", "세종"], ["울산광역시", "울산"],
    ["인천광역시", "인천"], [merged, "전남광주"],
    ["전라남도", "전남"], ["광주광역시", "광주"],
    ["전북특별자치도", "전라북도", "전북"], ["제주특별자치도", "제주도", "제주"],
    ["충청남도", "충남"], ["충청북도", "충북"],
  ];
  const aliases = new Map(provinceNames.flatMap(([canonical, ...names]) =>
    [canonical, ...names].map(name => [name, canonical])));
  const fullProvinceNames = provinceNames.map(([name]) => name)
    .concat(["강원도", "전라북도", "제주도"])
    .sort((a, b) => b.length - a.length);

  function compact(value) {
    return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  }

  function parseCsv(text, visit) {
    let fields = [], field = "", quoted = false, closed = false, line = 1, rowLine = 1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else {
          field += char;
          if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
        }
      } else if (char === "," || char === "\n" || char === "\r") {
        fields.push(field);
        field = "";
        closed = false;
        if (char !== ",") {
          visit(fields, rowLine);
          fields = [];
          if (char === "\r" && text[i + 1] === "\n") i++;
          rowLine = ++line;
        }
      } else if (char === '"' && !field && !closed) {
        quoted = true;
      } else {
        if (closed || char === '"') throw new Error(rowLine + "행의 CSV 따옴표를 확인하세요.");
        field += char;
      }
    }
    if (quoted) throw new Error(rowLine + "행의 CSV 따옴표가 닫히지 않았습니다.");
    if (fields.length || field || closed) visit(fields.concat(field), rowLine);
  }

  function decode(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
        throw new Error("UTF-8 파일을 읽을 수 없습니다.");
      }
    }
    try {
      return new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("CSV를 CP949 또는 UTF-8로 저장한 뒤 다시 선택하세요.");
    }
  }

  function validDate(text) {
    if (!/^\d{8}$/.test(text)) return false;
    const iso = text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6);
    const date = new Date(iso);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
  }

  function read(bytes, kind) {
    const text = decode(bytes);
    const required = columns[kind];
    const rows = [];
    let header, headerLine, metadata = false;
    parseCsv(text, (values, line) => {
      if (values.length === 1 && !values[0].trim()) return;
      if (!header) {
        header = values.map(value => value.trim());
        headerLine = line;
        const missing = required.filter(name => !header.includes(name));
        if (missing.length) throw new Error("필수 열이 없습니다. " + missing.join(", "));
        if (new Set(header).size !== header.length) throw new Error("중복 열 제목이 있습니다.");
        return;
      }
      if (kind === "prices" && !rows.length && !metadata &&
          values.slice(1).every(value => !value.trim()) && /^\s*기준\s*:\s*일간\s*\(.+\)\s*$/.test(values[0])) {
        metadata = true;
        return;
      }
      if (values.length !== header.length) {
        throw new Error(line + "행은 " + values.length + "개 열입니다. " + header.length + "개 열이 필요합니다.");
      }
      const row = Object.fromEntries(header.map((name, index) => [name, values[index]]));
      if (kind === "prices") {
        if (!row.번호.trim() || !row.지역.trim()) throw new Error(line + "행의 번호 또는 지역이 비어 있습니다.");
        if (!validDate(row.기간.trim())) throw new Error(line + "행의 기간이 올바른 YYYYMMDD 날짜가 아닙니다.");
        const invalid = fuels.find(name => row[name].trim() && !/^\d+(?:\.\d+)?$/.test(row[name].trim()));
        if (invalid) throw new Error(line + "행의 " + invalid + " 가격이 올바른 숫자가 아닙니다.");
      }
      if (kind === "stations" && !row.시도명.trim()) throw new Error(line + "행의 시도명이 비어 있습니다.");
      rows.push(row);
    });
    if (!headerLine) throw new Error("파일에 CSV 열 제목이 없습니다.");
    return rows;
  }

  function countyName(province, value) {
    const county = value.trim().replace(/\s+/g, "");
    if (province === "세종특별자치시" && ["", "없음", "세종특별자치시"].includes(county)) return "세종시";
    return county.match(/^(.+?시).+구$/)?.[1] || county;
  }

  function region(provinceText, districtText) {
    const rawProvince = provinceText.trim();
    let province = aliases.get(rawProvince) || rawProvince;
    const district = countyName(province, districtText);
    if (mergedDistricts.get(province)?.has(district)) province = merged;
    return { province, district };
  }

  function regionOf(row, kind) {
    if (kind === "stations") return region(row.시도명, row.시군구명);
    const [province, ...district] = row.지역.trim().split(/\s+/);
    return region(province, district.join(" "));
  }

  function boundaryIndex(geojson) {
    if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      throw new Error("올바른 행정동 GeoJSON이 아닙니다.");
    }
    const result = new Map();
    for (const { properties, geometry } of geojson.features) {
      if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) continue;
      const { sidonm, sggnm } = properties;
      const province = aliases.get(sidonm) || sidonm;
      const district = countyName(province, sggnm);
      if (!result.has(province)) result.set(province, new Map());
      const districts = result.get(province);
      if (!districts.has(district)) districts.set(district, []);
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of polygons) districts.get(district).push(polygon);
    }
    if (!result.size) throw new Error("표시할 행정동 경계가 없습니다.");
    return result;
  }

  function addressKey(address, area) {
    let text = address.trim().normalize("NFKC");
    const prefix = fullProvinceNames.find(name => text.startsWith(name));
    if (prefix) {
      text = text.slice(prefix.length);
    } else {
      const firstWord = text.split(/\s/)[0];
      const canonical = aliases.get(firstWord);
      if (canonical === area.province || (area.province === merged && legacy.includes(canonical))) {
        text = text.slice(firstWord.length);
      }
    }
    // A trailing reference such as "(토당동)" is optional in road-name addresses.
    text = compact(text.replace(/(\d)\s*\([^()]*\)\s*$/, "$1"));
    if (area.district && text.startsWith(area.district)) text = text.slice(area.district.length);
    return text;
  }

  function join(stations, prices) {
    const candidates = new Map();
    const pricesByStation = new Map();
    const key = (name, address, area) => {
      const station = compact(name);
      const street = addressKey(address, area);
      return station && street ? JSON.stringify([area.province, area.district, station, street]) : "";
    };
    for (const item of stations) {
      const { row, area } = item;
      const addresses = [row.소재지도로명주소, row.소재지지번주소];
      for (const address of new Set(addresses.map(value => key(row.주유소명, value, area)))) {
        if (!address) continue;
        if (!candidates.has(address)) candidates.set(address, new Set());
        candidates.get(address).add(item);
      }
    }
    const groups = new Map();
    for (const { row, area } of prices) {
      const id = row.번호.trim();
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({ row, area });
    }
    let unlinked = 0;
    for (const group of groups.values()) {
      let station;
      let matched = true;
      for (const { row, area } of group) {
        const options = candidates.get(key(row.상호, row.주소, area));
        if (options?.size !== 1) { matched = false; break; }
        const [candidate] = options;
        if (station && station !== candidate) { matched = false; break; }
        station = candidate;
      }
      if (!matched) {
        unlinked += group.length;
        continue;
      }
      if (!pricesByStation.has(station)) pricesByStation.set(station, []);
      pricesByStation.get(station).push(group.map(({ row }) => row));
    }
    // Conflicting source IDs cannot both identify the same station safely.
    const linked = new Map();
    for (const [station, histories] of pricesByStation) {
      if (histories.length === 1) {
        linked.set(station, histories[0].sort((a, b) => b.기간.trim().localeCompare(a.기간.trim())));
      } else {
        unlinked += histories.reduce((count, history) => count + history.length, 0);
      }
    }
    return { linked, unlinked };
  }

  function coordinates(row) {
    if (!row.경도.trim() || !row.위도.trim()) return null;
    const lon = Number(row.경도);
    const lat = Number(row.위도);
    return lon >= 123 && lon <= 133 && lat >= 32 && lat <= 40 ? [lon, lat] : null;
  }

  function exportCsv(kind, rows) {
    const escape = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    const lines = [columns[kind].join(",")];
    let range = "";
    if (kind === "prices" && rows.length) {
      let first = rows[0].기간.trim(), last = first;
      for (const row of rows) {
        const date = row.기간.trim();
        if (date < first) first = date;
        if (date > last) last = date;
      }
      range = first + "-" + last;
      lines.push("기준 : 일간(" + first + "~" + last + ")");
    }
    for (const row of rows) lines.push(columns[kind].map(name => escape(row[name])).join(","));
    return { csv: "\ufeff" + lines.join("\r\n") + "\r\n", range };
  }

  return { read, fuels, boundaryIndex, regionOf, join, coordinates, exportCsv };
})();
