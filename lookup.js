const MAX_IPS = 500;
const LOOKUP_DELAY_MS = 120;

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

function parseIpList(raw) {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  let parts;
  if (text.includes("\n")) {
    parts = text.split("\n");
  } else if (/[,;]/.test(text)) {
    parts = text.split(/[,;]+/);
  } else {
    parts = text.split(/\s+/);
  }

  return parts.map((p) => p.trim()).filter(Boolean);
}

function isValidIp(ip) {
  return IPV4_RE.test(ip) || IPV6_RE.test(ip);
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateOrReserved(ip) {
  if (!IPV4_RE.test(ip)) return false;

  const n = ipv4ToInt(ip);
  const ranges = [
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
  ];

  return ranges.some(([start, end]) => n >= start && n <= end);
}

function dedupeIps(ips) {
  const seen = new Set();
  const out = [];
  for (const ip of ips) {
    const key = ip.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ip);
    }
  }
  return out;
}

function prepareIps(raw, dedupe) {
  let ips = parseIpList(raw);
  if (dedupe) ips = dedupeIps(ips);

  const prepared = [];
  const invalid = [];

  for (const token of ips) {
    if (!isValidIp(token)) {
      invalid.push({ ip: token, error: "Неверный формат IP" });
      continue;
    }
    if (isPrivateOrReserved(token)) {
      invalid.push({ ip: token, error: "Локальный или служебный адрес" });
      continue;
    }
    prepared.push(token);
  }

  const limited = prepared.length > MAX_IPS;
  return {
    ips: prepared.slice(0, MAX_IPS),
    invalid,
    limited,
    totalParsed: ips.length,
  };
}

async function lookupOne(ip) {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    return { ip, ok: false, error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  if (!data.success) {
    return { ip, ok: false, error: data.message || "Не найдено" };
  }

  return {
    ip,
    ok: true,
    country: data.country || "—",
    countryCode: data.country_code || "",
    city: data.city || "—",
    region: data.region || "—",
    isp: data.connection?.isp || data.connection?.org || "—",
    timezone: data.timezone?.id || "—",
    flag: data.flag?.img || "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupBatch(ips, { onProgress, signal }) {
  const results = [];

  for (let i = 0; i < ips.length; i += 1) {
    if (signal?.aborted) break;

    const ip = ips[i];
    try {
      const row = await lookupOne(ip);
      results.push(row);
    } catch {
      results.push({ ip, ok: false, error: "Ошибка сети" });
    }

    onProgress?.(i + 1, ips.length);

    if (i < ips.length - 1) {
      await sleep(LOOKUP_DELAY_MS);
    }
  }

  return results;
}

function summarize(results) {
  const countries = new Map();
  const cities = new Map();
  let ok = 0;
  let fail = 0;

  for (const row of results) {
    if (!row.ok) {
      fail += 1;
      continue;
    }
    ok += 1;

    const countryKey = row.countryCode
      ? `${row.country} (${row.countryCode})`
      : row.country;
    countries.set(countryKey, (countries.get(countryKey) || 0) + 1);

    const cityKey =
      row.city && row.city !== "—"
        ? `${row.city}, ${row.country}`
        : row.country;
    cities.set(cityKey, (cities.get(cityKey) || 0) + 1);
  }

  const sortEntries = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    ok,
    fail,
    countries: sortEntries(countries),
    cities: sortEntries(cities),
  };
}

function toCsv(rows) {
  const header = ["ip", "status", "country", "city", "region", "isp", "timezone", "error"];
  const lines = [header.join(",")];

  for (const row of rows) {
    const cells = [
      row.ip,
      row.ok ? "ok" : "error",
      row.ok ? row.country : "",
      row.ok ? row.city : "",
      row.ok ? row.region : "",
      row.ok ? row.isp : "",
      row.ok ? row.timezone : "",
      row.ok ? "" : row.error || "",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }

  return lines.join("\n");
}
