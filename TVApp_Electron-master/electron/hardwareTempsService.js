const si = require('systeminformation');
const { execFile } = require('child_process');

function round1(n) {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function normalizeZoneName(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/\\/g, '/');
}

/**
 * Windows 10/11: senzori ACPI via performance WMI (funcționează frecvent când root/wmi MSAcpi e gol).
 */
function getWindowsPerfThermalRows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const ps = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation | ForEach-Object {
  $k = $_.Temperature
  if ($null -eq $k) { return }
  $c = $k - 273.15
  if ($c -lt 5 -or $c -gt 105) { return }
  $rows += [PSCustomObject]@{ Name = $_.Name; C = [double]([math]::Round($c, 1)) }
}
if ($rows.Count -eq 0) { Write-Output '[]' } else { Write-Output (ConvertTo-Json -InputObject @($rows) -Compress -Depth 5) }
`.trim();

    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 20000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(parsePsJsonArray(stdout));
      }
    );
  });
}

function parsePsJsonArray(stdout) {
  if (!stdout) return [];
  const text = String(stdout).replace(/^\uFEFF/, '');
  let data = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      try {
        data = JSON.parse(t);
        break;
      } catch {
        /* next */
      }
    }
  }
  if (data == null) {
    try {
      data = JSON.parse(text.trim());
    } catch {
      return [];
    }
  }
  return Array.isArray(data) ? data : data ? [data] : [];
}

/** Contoare Performance „Thermal Zone Information” (unele mini PC / NUC expun doar aici). */
function getWindowsCounterThermalRows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const ps = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
try {
  $cnt = Get-Counter '\\Thermal Zone Information(*)\\Temperature' -ErrorAction Stop
  foreach ($s in $cnt.CounterSamples) {
    $k = [double]$s.CookedValue
    $c = $k - 273.15
    if ($c -lt 5 -or $c -gt 115) { $c = ($k / 10.0) - 273.15 }
    if ($c -ge 5 -and $c -le 115) {
      $rows += [PSCustomObject]@{ Name = [string]$s.InstanceName; C = [double]([math]::Round($c, 1)) }
    }
  }
} catch {}
if ($rows.Count -eq 0) { Write-Output '[]' } else { Write-Output (ConvertTo-Json -InputObject @($rows) -Compress -Depth 5) }
`.trim();
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 20000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(parsePsJsonArray(stdout));
      }
    );
  });
}

/** LibreHardwareMonitor / Open Hardware Monitor – WMI (dacă rulează unul dintre ele). */
function getLibreOpenHardwareMonitorRows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const ps = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
foreach ($ns in @('root\\LibreHardwareMonitor','root\\OpenHardwareMonitor')) {
  try {
    Get-CimInstance -Namespace $ns -Class Sensor -ErrorAction SilentlyContinue | ForEach-Object {
      $v = $_.Value
      if ($null -eq $v) { return }
      $v = [double]$v
      if ($v -lt 15 -or $v -gt 125) { return }
      $name = [string]$_.Name
      $type = $_.SensorType
      $ok = $false
      if ($type -is [string] -and $type -eq 'Temperature') { $ok = $true }
      if ($type -is [int] -or $type -is [uint32] -or $type -is [long]) {
        $ti = [int]$type
        if ($ti -eq 3) { $ok = $true }
        if ($ti -eq 0 -and $name -match '(?i)temp|cpu|core|tdie|package|pch|socket|board') { $ok = $true }
      }
      if (-not $ok -and $name -match '(?i)cpu|core|package|tdie|socket|pch\\b|motherboard|mainboard|board') { $ok = $true }
      if (-not $ok) { return }
      $rows += [PSCustomObject]@{ Name = $name; C = [double]([math]::Round($v, 1)) }
    }
  } catch {}
}
if ($rows.Count -eq 0) { Write-Output '[]' } else { Write-Output (ConvertTo-Json -InputObject @($rows) -Compress -Depth 5) }
`.trim();
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 20000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(parsePsJsonArray(stdout));
      }
    );
  });
}

function assignTempsFromZoneRows(rows) {
  let cpuC = null;
  let motherboardC = null;
  let batteryC = null;

  const list = Array.isArray(rows) ? rows : [];
  const getC = (pred) => {
    for (const z of list) {
      const n = normalizeZoneName(z.Name);
      if (pred(n)) return typeof z.C === 'number' ? z.C : null;
    }
    return null;
  };

  cpuC = getC((n) => n.includes('CPUZ') || n.includes('/CPUZ') || n.includes('TZ.CPU'));
  if (cpuC == null) {
    cpuC = getC((n) => n.includes('TZ00') || n.includes('TZ01') || n.includes('THERMALZONE'));
  }
  batteryC = getC((n) => n.includes('BATZ') || n.includes('/BATZ'));
  motherboardC = getC((n) => n.includes('PCHZ') || n.includes('/PCHZ'));

  if (motherboardC == null) {
    const sk = list.filter((z) => {
      const n = normalizeZoneName(z.Name);
      return n.includes('SK1Z') || n.includes('SK2Z');
    });
    if (sk.length > 0) {
      const sum = sk.reduce((a, z) => a + (typeof z.C === 'number' ? z.C : 0), 0) / sk.length;
      motherboardC = round1(sum);
    }
  }
  if (motherboardC == null) {
    motherboardC = getC((n) => n.includes('MSHZ') || n.includes('/MSHZ'));
  }
  if (motherboardC == null) {
    motherboardC = getC((n) => n.includes('LOCZ') || n.includes('/LOCZ'));
  }

  if (cpuC == null && list.length > 0) {
    const excludeBat = list.filter((z) => !normalizeZoneName(z.Name).includes('BATZ'));
    const candidates = (excludeBat.length ? excludeBat : list).filter((z) => typeof z.C === 'number');
    if (candidates.length > 0) {
      cpuC = round1(Math.max(...candidates.map((z) => z.C)));
    }
  }

  return { cpuC, motherboardC, batteryC };
}

/** Fallback: MSAcpi_ThermalZoneTemperature (zecimi Kelvin) */
function getLegacyAcpiZonesCelsius() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    const ps =
      'Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { $_.CurrentTemperature }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 12000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const out = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          const tk = parseFloat(String(line).trim().replace(',', '.'));
          if (Number.isNaN(tk)) continue;
          const c = tk / 10 - 273.15;
          if (c >= 5 && c <= 105) out.push(round1(c));
        }
        resolve(out);
      }
    );
  });
}

async function getHardwareTemps() {
  const result = {
    cpuC: null,
    motherboardC: null,
    batteryC: null,
    at: Date.now()
  };

  if (process.platform === 'win32') {
    let rows = await getWindowsPerfThermalRows();
    if (rows.length === 0) {
      rows = await getWindowsCounterThermalRows();
    }
    if (rows.length === 0) {
      rows = await getLibreOpenHardwareMonitorRows();
    }
    const fromPerf = assignTempsFromZoneRows(rows);
    result.cpuC = fromPerf.cpuC;
    result.motherboardC = fromPerf.motherboardC;
    result.batteryC = fromPerf.batteryC;

    if (result.cpuC == null || result.motherboardC == null) {
      const zones = await getLegacyAcpiZonesCelsius();
      if (zones.length > 0) {
        const hi = Math.max(...zones);
        const lo = Math.min(...zones);
        if (result.cpuC == null) result.cpuC = round1(hi);
        if (result.motherboardC == null) {
          result.motherboardC = zones.length > 1 ? round1(lo) : round1(hi);
        }
      }
    }
  }

  try {
    const ct = await si.cpuTemperature();
    if (ct) {
      if (result.cpuC == null && typeof ct.main === 'number' && ct.main > 5) result.cpuC = round1(ct.main);
      if (result.cpuC == null && typeof ct.max === 'number' && ct.max > 5) result.cpuC = round1(ct.max);
      if (result.motherboardC == null) {
        const mbTry = [ct.socket && ct.socket[0], ct.chipset, ct.pch];
        for (const v of mbTry) {
          if (typeof v === 'number' && v > 5 && v < 105) {
            result.motherboardC = round1(v);
            break;
          }
        }
      }
    }
  } catch (e) {}

  try {
    if (result.batteryC == null) {
      const bat = await si.battery();
      if (bat && typeof bat.temperature === 'number' && bat.temperature > 5 && bat.temperature < 60) {
        result.batteryC = round1(bat.temperature);
      }
    }
  } catch (e) {}

  return result;
}

module.exports = { getHardwareTemps };
