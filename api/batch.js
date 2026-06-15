const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

const FIELDS =
  "status,message,country,countryCode,regionName,city,isp,timezone,query";

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateOrReserved(ip) {
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

function isValidPublicIpv4(ip) {
  return typeof ip === "string" && IPV4_RE.test(ip) && !isPrivateOrReserved(ip);
}

function mapResult(item, ip) {
  if (!item || item.status === "fail") {
    return {
      ip,
      ok: false,
      error: item?.message || "Не найдено",
    };
  }
  return {
    ip: item.query || ip,
    ok: true,
    country: item.country || "—",
    countryCode: item.countryCode || "",
    city: item.city || "—",
    region: item.regionName || "—",
    isp: item.isp || "—",
    timezone: item.timezone || "—",
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const ips = body?.ips;
  if (!Array.isArray(ips) || ips.length === 0) {
    return res.status(400).json({ error: "ips array required" });
  }

  if (ips.length > 45) {
    return res.status(400).json({ error: "Max 45 IPs per request (API limit)" });
  }

  const validIps = [];
  for (const ip of ips) {
    if (!isValidPublicIpv4(ip)) {
      return res.status(400).json({ error: `Invalid or private IP: ${ip}` });
    }
    validIps.push(ip);
  }

  try {
    const apiRes = await fetch(
      `http://ip-api.com/batch?fields=${FIELDS}&lang=ru`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validIps),
      }
    );

    if (apiRes.status === 429) {
      return res.status(429).json({
        error: "Лимит запросов. Подождите около минуты и повторите.",
      });
    }

    if (!apiRes.ok) {
      return res.status(502).json({ error: "Upstream API error" });
    }

    const data = await apiRes.json();
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: "Unexpected API response" });
    }

    const results = data.map((item, i) => mapResult(item, validIps[i]));
    return res.status(200).json({ results });
  } catch {
    return res.status(502).json({ error: "Lookup failed" });
  }
}
