/**
 * ============================================================================
 * RM·OPS — Torre de Control Logística y Riesgo Climático (Obsidian Minimal)
 * Arquitectura Unidireccional:
 *   Estado Único -> Ingesta Multi-Hub (1 fetch) -> Analítica -> Render SVG Puro
 * ============================================================================
 */

/* --------------------------------------------------------------------------
 * 0. CONFIGURACIÓN DE DOMINIO Y ESTADO
 * -------------------------------------------------------------------------- */
const HUBS = [
  { id: "maipu",        nombre: "Maipú",        zona: "Polo Industrial",     lat: -33.5106, lon: -70.7573, sesgoTemp: 0.6,  sesgoViento: 1.0 },
  { id: "pudahuel",     nombre: "Pudahuel",     zona: "ENEA / Aeropuerto",   lat: -33.4417, lon: -70.7511, sesgoTemp: 0.4,  sesgoViento: 4.5 },
  { id: "quilicura",    nombre: "Quilicura",    zona: "Hub Logístico Norte", lat: -33.3642, lon: -70.7336, sesgoTemp: 1.1,  sesgoViento: 2.0 },
  { id: "san_bernardo", nombre: "San Bernardo", zona: "Corredor Ruta 5 Sur", lat: -33.5922, lon: -70.6996, sesgoTemp: -0.2, sesgoViento: 1.5 },
  { id: "santiago",     nombre: "Santiago",     zona: "Última Milla Centro", lat: -33.4489, lon: -70.6693, sesgoTemp: 0.9,  sesgoViento: -1.5 },
];

const METRICAS = {
  temperatura: {
    campo: "temperature_2m",
    nombre: "Temperatura Operativa",
    corto: "Temp.",
    unidad: "°C",
    umbralDefault: 27,
    min: 15,
    max: 40,
    axisMinTop: 34,
    axisCap: 46,
    foco: "Cadena de Frío",
  },
  viento: {
    campo: "wind_speed_10m",
    nombre: "Velocidad de Viento",
    corto: "Viento",
    unidad: "km/h",
    umbralDefault: 24,
    min: 10,
    max: 55,
    axisMinTop: 36,
    axisCap: 80,
    foco: "Flota y Grúas",
  },
  precipitacion: {
    campo: "precipitation_probability",
    nombre: "Probabilidad de Lluvia",
    corto: "Lluvia",
    unidad: "%",
    umbralDefault: 35,
    min: 10,
    max: 90,
    axisMinTop: 100,
    axisCap: 100,
    foco: "Seguridad Última Milla",
  },
};

const CACHE_KEY = "rmops_multihub_cache_v2";
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8500;

const STATE = {
  hubId: "maipu",
  metrica: "temperatura",
  ventana: "hoy_operativo",
  umbral: METRICAS.temperatura.umbralDefault,
  polling: false,
  pollingTimer: null,
  toastTimer: null,
  hubsData: {},
  origen: "loading", // 'live' | 'cache' | 'fallback'
  latenciaMs: 0,
  endpointUrl: "",
  ultimaActualizacion: "--:--:--",
};

const $ = (id) => document.getElementById(id);

const DOM = {
  statusBadge: $("statusBadge"),
  statusText: $("statusText"),
  btnRefresh: $("btnRefresh"),
  btnPolling: $("btnPolling"),
  pollingLabel: $("pollingLabel"),
  btnSimularFallo: $("btnSimularFallo"),
  btnOpenDrawer: $("btnOpenDrawer"),
  btnCloseDrawer: $("btnCloseDrawer"),
  btnCopyJson: $("btnCopyJson"),
  btnTheme: $("btnTheme"),
  metricaGroup: $("metricaGroup"),
  ventanaGroup: $("ventanaGroup"),
  rangeUmbral: $("rangeUmbral"),
  umbralValue: $("umbralValue"),
  insightStrip: $("insightStrip"),
  insightTag: $("insightTag"),
  insightHubLabel: $("insightHubLabel"),
  lastUpdated: $("lastUpdated"),
  insightHeadline: $("insightHeadline"),
  insightBody: $("insightBody"),
  dispatchWindows: $("dispatchWindows"),
  kpi1Label: $("kpi1Label"),
  kpi1Delta: $("kpi1Delta"),
  kpi1Value: $("kpi1Value"),
  kpi1Sub: $("kpi1Sub"),
  spark1: $("spark1"),
  kpi2Range: $("kpi2Range"),
  kpi2Value: $("kpi2Value"),
  kpi2Sub: $("kpi2Sub"),
  spark2: $("spark2"),
  kpi3Pct: $("kpi3Pct"),
  kpi3Value: $("kpi3Value"),
  kpi3Sub: $("kpi3Sub"),
  exposureMiniBar: $("exposureMiniBar"),
  kpi4State: $("kpi4State"),
  kpi4Value: $("kpi4Value"),
  kpi4Sub: $("kpi4Sub"),
  spark4: $("spark4"),
  chartTitle: $("chartTitle"),
  chartSubtitle: $("chartSubtitle"),
  chartStage: $("chartStage"),
  loadingOverlay: $("loadingOverlay"),
  mainSvg: $("mainSvg"),
  tooltip: $("tooltip"),
  timelineCells: $("timelineCells"),
  hubRankingList: $("hubRankingList"),
  actionList: $("actionList"),
  protocolTag: $("protocolTag"),
  drawer: $("jsonDrawer"),
  drawerBackdrop: $("drawerBackdrop"),
  drawerOrigin: $("drawerOrigin"),
  drawerLatency: $("drawerLatency"),
  drawerEndpoint: $("drawerEndpoint"),
  jsonViewer: $("jsonViewer"),
  syncToast: $("syncToast"),
};

/* --------------------------------------------------------------------------
 * 1. INGESTA ASÍNCRONA MULTI-HUB CON MEDICIÓN DE LATENCIA (ms)
 * -------------------------------------------------------------------------- */
function construirUrlMultiHub() {
  const lats = HUBS.map((h) => h.lat).join(",");
  const lons = HUBS.map((h) => h.lon).join(",");
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,wind_speed_10m,precipitation_probability` +
    `&timezone=America%2FSantiago&forecast_days=2`
  );
}

function generarRespaldoMultiHub(motivo) {
  const hoy = new Date();
  const resultado = {};

  HUBS.forEach((hub) => {
    const time = [];
    const temperature_2m = [];
    const wind_speed_10m = [];
    const precipitation_probability = [];

    for (let d = 0; d < 2; d++) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + d);
      const yyyy = fecha.getFullYear();
      const mm = String(fecha.getMonth() + 1).padStart(2, "0");
      const dd = String(fecha.getDate()).padStart(2, "0");

      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, "0");
        time.push(`${yyyy}-${mm}-${dd}T${hh}:00`);

        const baseT = 18.2 + 10.6 * Math.sin(((h - 8) / 24) * Math.PI * 2) + hub.sesgoTemp + d * 0.7;
        const baseW = 9 + 16 * Math.max(0, Math.sin(((h - 11) / 13) * Math.PI)) + hub.sesgoViento;
        const baseR = h >= 15 && h <= 19 ? Math.min(85, 32 + Math.round(hub.sesgoViento * 6)) : 10;

        temperature_2m.push(Number(baseT.toFixed(1)));
        wind_speed_10m.push(Number(Math.max(2, baseW).toFixed(1)));
        precipitation_probability.push(Math.max(0, baseR));
      }
    }

    resultado[hub.id] = {
      _fallback: true,
      _motivo: motivo,
      latitude: hub.lat,
      longitude: hub.lon,
      hourly: { time, temperature_2m, wind_speed_10m, precipitation_probability },
    };
  });

  return resultado;
}

async function fetchMultiHubConResiliencia({ forceRefresh = false, simularError = false } = {}) {
  const t0 = performance.now();
  const url = construirUrlMultiHub();
  STATE.endpointUrl = url;

  // 1. Caché localStorage con TTL 60s
  if (!forceRefresh && !simularError) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.hubsData) {
          return {
            hubsData: parsed.hubsData,
            origen: "cache",
            latenciaMs: Math.max(1, Math.round(performance.now() - t0)),
          };
        }
      }
    } catch {
      // Continuar a red si localStorage está bloqueado
    }
  }

  // 2. Petición real con AbortController (Timeout)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    if (simularError) {
      throw new Error("Simulación manual de caída de conectividad / Error 429");
    }

    const res = await fetch(url, {
      signal: controller.signal,
      cache: forceRefresh ? "no-store" : "default",
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status} desde Open-Meteo`);
    const json = await res.json();

    const lista = Array.isArray(json) ? json : [json];
    if (lista.length !== HUBS.length) {
      throw new Error("Respuesta multi-hub incompleta");
    }

    const hubsData = {};
    HUBS.forEach((hub, i) => {
      hubsData[hub.id] = lista[i];
    });

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), hubsData }));
    } catch {
      // Ignorar límite de cuota
    }

    return {
      hubsData,
      origen: "live",
      latenciaMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[RM·OPS Resiliencia] Activando respaldo local:", err.message);
    return {
      hubsData: generarRespaldoMultiHub(err.message),
      origen: "fallback",
      latenciaMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  }
}

/* --------------------------------------------------------------------------
 * 2. TRANSFORMACIÓN ANALÍTICA, KPIs E ÍNDICE DE RIESGO (0-100)
 * -------------------------------------------------------------------------- */
function normalizarSerie(hubPayload, metricaKey, ventanaKey) {
  const campo = METRICAS[metricaKey].campo;
  const tiempos = hubPayload?.hourly?.time || [];
  const valores = hubPayload?.hourly?.[campo] || [];

  let inicio = 6;
  let fin = 23; // 06:00 a 22:00 inclusive (17 bloques)
  if (ventanaKey === "hoy_24h") {
    inicio = 0;
    fin = 24;
  } else if (ventanaKey === "manana_operativo") {
    inicio = 30;
    fin = 47;
  }

  const puntos = [];
  for (let i = inicio; i < Math.min(fin, tiempos.length); i++) {
    const num = Number(valores[i]);
    if (Number.isFinite(num)) {
      puntos.push({
        hora: tiempos[i].slice(11, 16),
        iso: tiempos[i],
        valor: num,
      });
    }
  }

  // Media móvil centrada de 3 horas
  return puntos.map((p, idx, arr) => {
    const a = Math.max(0, idx - 1);
    const b = Math.min(arr.length - 1, idx + 1);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += arr[j].valor;
    return { ...p, mediaMovil: Number((sum / (b - a + 1)).toFixed(1)) };
  });
}

function analizarSerie(serie, umbral) {
  if (!serie.length) {
    return {
      max: 0, horaMax: "--:--", min: 0, promedio: 0, deltaPct: 0,
      criticos: [], pctExposicion: 0, riskScore: 0, nivel: "ÓPTIMO",
      ventanaSegura: "--", ventanaCritica: "Ninguna",
    };
  }

  let maxP = serie[0];
  let minVal = serie[0].valor;
  let sum = 0;

  for (const p of serie) {
    if (p.valor > maxP.valor) maxP = p;
    if (p.valor < minVal) minVal = p.valor;
    sum += p.valor;
  }

  const promedio = sum / serie.length;
  const deltaPct = promedio > 0 ? ((maxP.valor - promedio) / promedio) * 100 : 0;
  const criticos = serie.filter((p) => p.valor >= umbral);
  const pctExposicion = (criticos.length / serie.length) * 100;

  const excesoRelativo = umbral > 0 ? Math.max(0, (maxP.valor - umbral) / umbral) : 0;
  const cercaniaBase = umbral > 0 ? Math.min(1, maxP.valor / umbral) * 35 : 0;
  const scoreBruto = cercaniaBase + pctExposicion * 0.55 + excesoRelativo * 90;
  const riskScore = Math.min(100, Math.round(scoreBruto));

  let nivel = "ÓPTIMO";
  if (criticos.length >= 3 || riskScore >= 70) nivel = "CRÍTICO";
  else if (criticos.length >= 1 || riskScore >= 45) nivel = "ALERTA";

  const seguros = serie.filter((p) => p.valor < umbral);
  const ventanaSegura = seguros.length
    ? `${seguros[0].hora} – ${seguros[seguros.length - 1].hora} hrs`
    : "Sin ventana libre";

  const ventanaCritica = criticos.length
    ? `${criticos[0].hora} – ${criticos[criticos.length - 1].hora} hrs`
    : "Sin restricciones";

  return {
    max: Number(maxP.valor.toFixed(1)),
    horaMax: maxP.hora,
    min: Number(minVal.toFixed(1)),
    promedio: Number(promedio.toFixed(1)),
    deltaPct: Number(deltaPct.toFixed(1)),
    criticos,
    pctExposicion: Math.round(pctExposicion),
    riskScore,
    nivel,
    ventanaSegura,
    ventanaCritica,
  };
}

function construirInsights(hub, metricaCfg, stats, umbral) {
  const u = metricaCfg.unidad;

  if (stats.nivel === "ÓPTIMO") {
    return {
      clase: "is-ok",
      tag: "OPERACIÓN ÓPTIMA",
      titular: `${hub.nombre} opera bajo el umbral toda la jornada (máx. ${stats.max} ${u} a las ${stats.horaMax} hrs).`,
      cuerpo: `No se proyectan brechas en ${metricaCfg.foco.toLowerCase()}. Mantener frecuencias de despacho habituales en ${hub.zona}.`,
      acciones: [
        { texto: `Mantener ruteo estándar en ${hub.zona} sin recargos de contingencia.`, priority: false },
        { texto: `Consolidar carga sensible aprovechando el margen de ${(umbral - stats.max).toFixed(1)} ${u} bajo umbral.`, priority: false },
        { texto: `Revisar el ranking lateral: priorizar apoyo en comunas con mayor índice de riesgo.`, priority: false },
      ],
    };
  }

  const esCritico = stats.nivel === "CRÍTICO";
  const recomendacion = {
    temperatura: `Adelantar carga perecible en ${hub.nombre} antes de las ${stats.criticos[0]?.hora || "13:00"} hrs y activar pre-enfriamiento de flota durante ${stats.ventanaCritica}.`,
    viento: `Suspender maniobras de grúa en altura en ${hub.zona} durante ${stats.ventanaCritica} y reforzar sujeción de carga liviana.`,
    precipitacion: `Despachar pedidos críticos antes de las ${stats.criticos[0]?.hora || "14:00"} hrs, sumar +20% de holgura de ruta y habilitar equipamiento impermeable.`,
  }[STATE.metrica];

  return {
    clase: esCritico ? "is-critical" : "is-warn",
    tag: esCritico ? "ACCIÓN GERENCIAL INMEDIATA" : "PRECAUCIÓN OPERATIVA",
    titular: `${hub.nombre}: ${stats.criticos.length} bloques sobre ${umbral} ${u} (pico de ${stats.max} ${u} a las ${stats.horaMax} hrs).`,
    cuerpo: recomendacion,
    acciones: [
      { texto: `Bloquear o mitigar despachos críticos entre ${stats.ventanaCritica} (${stats.pctExposicion}% de la ventana).`, priority: true },
      { texto: recomendacion, priority: esCritico },
      { texto: `Reasignar salidas prioritarias a la ventana segura (${stats.ventanaSegura}) y alertar a jefatura de ${hub.zona}.`, priority: false },
    ],
  };
}

/* --------------------------------------------------------------------------
 * 3. ESCALAS PURAS + GRÁFICO SVG CON ANIMACIÓN DE TRAZADO Y CROSSHAIR
 * -------------------------------------------------------------------------- */
function scaleLinear(dMin, dMax, rMin, rMax) {
  const span = dMax - dMin || 1;
  return (val) => rMin + ((val - dMin) / span) * (rMax - rMin);
}

function elSvg(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function renderSparkline(svgEl, values, strokeColor) {
  svgEl.innerHTML = "";
  if (values.length < 2) return;

  const w = 96;
  const h = 32;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sx = scaleLinear(0, values.length - 1, pad, w - pad);
  const sy = scaleLinear(min === max ? min - 1 : min, min === max ? max + 1 : max, h - pad, pad);

  const pts = values.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  svgEl.appendChild(
    elSvg("polyline", {
      points: pts,
      fill: "none",
      stroke: strokeColor,
      "stroke-width": 1.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );

  const lastX = sx(values.length - 1);
  const lastY = sy(values[values.length - 1]);
  svgEl.appendChild(elSvg("circle", { cx: lastX, cy: lastY, r: 2.6, fill: strokeColor }));
}

function renderMainSvg(serie, umbral, metricaCfg, { animate = true } = {}) {
  const svg = DOM.mainSvg;
  const titleNode = svg.querySelector("title");
  const descNode = svg.querySelector("desc");
  svg.innerHTML = "";
  if (titleNode) svg.appendChild(titleNode);
  if (descNode) svg.appendChild(descNode);

  if (!serie.length) return;

  const W = 820;
  const H = 340;
  const m = { top: 24, right: 26, bottom: 40, left: 56 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const maxVal = Math.max(...serie.map((d) => d.valor), umbral);
  const yMax = Math.min(
    metricaCfg.axisCap,
    Math.ceil(Math.max(maxVal * 1.16, metricaCfg.axisMinTop))
  );
  const yMin = 0;

  const scaleX = scaleLinear(0, Math.max(1, serie.length - 1), m.left, W - m.right);
  const scaleY = scaleLinear(yMin, yMax, m.top + innerH, m.top);
  const yBase = scaleY(0);
  const yUmbral = scaleY(Math.min(yMax, umbral));

  // 1. Gradientes SVG
  const defs = elSvg("defs");

  const areaGrad = elSvg("linearGradient", { id: "areaGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
  areaGrad.appendChild(elSvg("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "0.28" }));
  areaGrad.appendChild(elSvg("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0.0" }));
  defs.appendChild(areaGrad);

  const dangerGrad = elSvg("linearGradient", { id: "dangerGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
  dangerGrad.appendChild(elSvg("stop", { offset: "0%", "stop-color": "var(--alert)", "stop-opacity": "0.14" }));
  dangerGrad.appendChild(elSvg("stop", { offset: "100%", "stop-color": "var(--alert)", "stop-opacity": "0.02" }));
  defs.appendChild(dangerGrad);

  svg.appendChild(defs);

  // 2. Zona Crítica sobre el umbral
  if (yUmbral > m.top) {
    svg.appendChild(
      elSvg("rect", {
        x: m.left,
        y: m.top,
        width: innerW,
        height: Math.max(0, yUmbral - m.top),
        fill: "url(#dangerGrad)",
      })
    );
  }

  // 3. Grilla horizontal y eje Y
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = yMin + ((yMax - yMin) / ticks) * i;
    const y = scaleY(val);

    svg.appendChild(
      elSvg("line", {
        x1: m.left,
        x2: W - m.right,
        y1: y,
        y2: y,
        stroke: "var(--grid-line)",
        "stroke-width": 1,
      })
    );

    const lbl = elSvg("text", {
      x: m.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "axis-text",
    });
    lbl.textContent = `${Math.round(val)} ${metricaCfg.unidad}`;
    svg.appendChild(lbl);
  }

  // 4. Rutas de Área, Media Móvil y Serie Principal
  const coords = serie.map((d, i) => ({
    ...d,
    x: scaleX(i),
    y: scaleY(d.valor),
    yMa: scaleY(d.mediaMovil),
    alerta: d.valor >= umbral,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${yBase.toFixed(1)} L ${coords[0].x.toFixed(1)} ${yBase.toFixed(1)} Z`;
  const maPath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.yMa.toFixed(1)}`).join(" ");

  svg.appendChild(
    elSvg("path", {
      d: areaPath,
      fill: "url(#areaGrad)",
      class: animate ? "svg-area-enter" : "",
    })
  );

  svg.appendChild(
    elSvg("path", {
      d: maPath,
      fill: "none",
      stroke: "var(--ma-color)",
      "stroke-width": 1.6,
      "stroke-dasharray": "4 4",
      opacity: "0.85",
      class: animate ? "svg-area-enter" : "",
    })
  );

  const mainLineEl = elSvg("path", {
    d: linePath,
    fill: "none",
    stroke: "var(--accent)",
    "stroke-width": 2.4,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  svg.appendChild(mainLineEl);

  // Animación fluida de trazado de izquierda a derecha
  if (animate && typeof mainLineEl.getTotalLength === "function") {
    const length = mainLineEl.getTotalLength();
    mainLineEl.style.strokeDasharray = `${length}`;
    mainLineEl.style.strokeDashoffset = `${length}`;
    mainLineEl.getBoundingClientRect();
    mainLineEl.style.transition = "stroke-dashoffset 620ms cubic-bezier(0.22, 1, 0.36, 1)";
    mainLineEl.style.strokeDashoffset = "0";
  }

  // 5. Línea de Umbral Gerencial
  svg.appendChild(
    elSvg("line", {
      x1: m.left,
      x2: W - m.right,
      y1: yUmbral,
      y2: yUmbral,
      stroke: "var(--warn)",
      "stroke-width": 1.5,
      "stroke-dasharray": "6 4",
    })
  );

  const pillW = 112;
  const pillX = W - m.right - pillW;
  const pillY = Math.max(m.top + 2, yUmbral - 22);
  svg.appendChild(
    elSvg("rect", {
      x: pillX,
      y: pillY,
      width: pillW,
      height: 18,
      rx: 4,
      fill: "var(--bg-surface)",
      stroke: "var(--warn)",
      "stroke-width": 1,
    })
  );
  const pillTxt = elSvg("text", {
    x: pillX + pillW / 2,
    y: pillY + 12.5,
    "text-anchor": "middle",
    fill: "var(--warn)",
    "font-size": "10",
    "font-weight": "700",
    "font-family": "var(--font-mono)",
  });
  pillTxt.textContent = `UMBRAL ${umbral} ${metricaCfg.unidad}`;
  svg.appendChild(pillTxt);

  // 6. Puntos de datos con entrada escalonada siguiendo la curva
  coords.forEach((c, idx) => {
    const delayStyle = animate ? `animation-delay:${Math.min(480, idx * 24)}ms` : "";
    const dotClass = animate ? "svg-dot-enter" : "";

    if (c.alerta) {
      svg.appendChild(
        elSvg("circle", {
          cx: c.x,
          cy: c.y,
          r: 7.5,
          fill: "var(--alert)",
          opacity: animate ? "0" : "0.2",
          class: dotClass,
          style: animate ? `${delayStyle};--target-op:0.2` : "",
        })
      );
      svg.appendChild(
        elSvg("circle", {
          cx: c.x,
          cy: c.y,
          r: 4,
          fill: "var(--alert)",
          stroke: "var(--bg-canvas)",
          "stroke-width": 1.5,
          class: dotClass,
          style: delayStyle,
        })
      );
    } else {
      svg.appendChild(
        elSvg("circle", {
          cx: c.x,
          cy: c.y,
          r: 2.4,
          fill: "var(--accent)",
          class: dotClass,
          style: delayStyle,
        })
      );
    }

    const paso = serie.length > 18 ? 3 : 2;
    if (idx % paso === 0 || idx === serie.length - 1) {
      const xl = elSvg("text", {
        x: c.x,
        y: H - 14,
        "text-anchor": "middle",
        class: "axis-text",
      });
      xl.textContent = c.hora;
      svg.appendChild(xl);
    }
  });

  // 7. Crosshair interactivo
  const crosshair = elSvg("line", {
    x1: m.left,
    x2: m.left,
    y1: m.top,
    y2: yBase,
    class: "crosshair-line",
  });
  const focusDot = elSvg("circle", {
    cx: 0,
    cy: 0,
    r: 5.5,
    fill: "var(--bg-canvas)",
    stroke: "var(--accent)",
    "stroke-width": 2.5,
    opacity: "0",
    "pointer-events": "none",
  });
  svg.appendChild(crosshair);
  svg.appendChild(focusDot);

  const slotW = innerW / Math.max(1, coords.length - 1);
  coords.forEach((c) => {
    const hit = elSvg("rect", {
      x: Math.max(m.left, c.x - slotW / 2),
      y: m.top,
      width: slotW,
      height: innerH,
      class: "hit-zone",
      tabindex: "0",
      "aria-label": `${c.hora} hrs: ${c.valor} ${metricaCfg.unidad}`,
    });

    const activar = () => {
      crosshair.setAttribute("x1", c.x);
      crosshair.setAttribute("x2", c.x);
      crosshair.classList.add("is-visible");

      focusDot.setAttribute("cx", c.x);
      focusDot.setAttribute("cy", c.y);
      focusDot.setAttribute("stroke", c.alerta ? "var(--alert)" : "var(--accent)");
      focusDot.setAttribute("opacity", "1");

      mostrarTooltip(c, umbral, metricaCfg, W, H);
    };

    const desactivar = () => {
      crosshair.classList.remove("is-visible");
      focusDot.setAttribute("opacity", "0");
      DOM.tooltip.hidden = true;
    };

    hit.addEventListener("mouseenter", activar);
    hit.addEventListener("focus", activar);
    hit.addEventListener("touchstart", activar, { passive: true });
    hit.addEventListener("mouseleave", desactivar);
    hit.addEventListener("blur", desactivar);
    svg.appendChild(hit);
  });
}

function mostrarTooltip(punto, umbral, metricaCfg, svgW, svgH) {
  const diff = (punto.valor - umbral).toFixed(1);
  const signo = Number(diff) >= 0 ? "+" : "";
  const badgeColor = punto.alerta ? "var(--alert)" : "var(--accent)";
  const estado = punto.alerta ? "Sobre umbral" : "Normal";

  DOM.tooltip.innerHTML = `
    <div class="tooltip__head">
      <span>${punto.hora} hrs</span>
      <span style="color:${badgeColor};font-size:0.7rem;">● ${estado}</span>
    </div>
    <div class="tooltip__row"><span>Valor horario</span><strong>${punto.valor} ${metricaCfg.unidad}</strong></div>
    <div class="tooltip__row"><span>Media móvil (3h)</span><strong>${punto.mediaMovil} ${metricaCfg.unidad}</strong></div>
    <div class="tooltip__row"><span>Desvío vs umbral</span><strong style="color:${badgeColor}">${signo}${diff} ${metricaCfg.unidad}</strong></div>
  `;

  DOM.tooltip.hidden = false;

  const stageW = DOM.chartStage.clientWidth;
  const stageH = DOM.chartStage.clientHeight;
  const pxX = (punto.x / svgW) * stageW;
  const pxY = (punto.y / svgH) * stageH;

  const tipW = DOM.tooltip.offsetWidth || 190;
  let left = pxX + 16;
  if (left + tipW > stageW - 10) left = pxX - tipW - 16;
  const top = Math.max(10, Math.min(stageH - 105, pxY - 24));

  DOM.tooltip.style.left = `${Math.max(8, left)}px`;
  DOM.tooltip.style.top = `${top}px`;
}

/* Notificación flotante de latencia */
function mostrarToastSync(origen, latenciaMs) {
  if (!DOM.syncToast) return;

  const etiquetas = {
    live: `Open-Meteo sincronizado (5 hubs RM) en <strong>${latenciaMs} ms</strong>`,
    cache: `Respuesta desde caché local en <strong>${latenciaMs} ms</strong>`,
    fallback: `Respaldo resiliente activado en <strong>${latenciaMs} ms</strong>`,
  };

  DOM.syncToast.className = `sync-toast sync-toast--${origen} is-visible`;
  DOM.syncToast.innerHTML = `<span class="sync-toast__dot"></span><span>${etiquetas[origen] || ""}</span>`;

  clearTimeout(STATE.toastTimer);
  STATE.toastTimer = setTimeout(() => {
    DOM.syncToast.classList.remove("is-visible");
  }, 2800);
}

/* --------------------------------------------------------------------------
 * 4. RENDER DEL DASHBOARD COMPLETO (Estado -> UI)
 * -------------------------------------------------------------------------- */
function actualizarStatusUI() {
  DOM.statusBadge.className = "status-dot-pill";
  if (STATE.origen === "live") {
    DOM.statusBadge.classList.add("status--live");
    DOM.statusText.textContent = `Live · ${STATE.latenciaMs} ms`;
    DOM.drawerOrigin.textContent = "Open-Meteo API en vivo (200 OK)";
  } else if (STATE.origen === "cache") {
    DOM.statusBadge.classList.add("status--cache");
    DOM.statusText.textContent = `Caché · ${STATE.latenciaMs} ms`;
    DOM.drawerOrigin.textContent = "localStorage (Caché vigente < 60s)";
  } else {
    DOM.statusBadge.classList.add("status--fallback");
    DOM.statusText.textContent = `Fallback · ${STATE.latenciaMs} ms`;
    DOM.drawerOrigin.textContent = "Respaldo local resiliente (sin red)";
  }

  if (DOM.drawerLatency) {
    DOM.drawerLatency.textContent = `${STATE.latenciaMs} ms`;
  }
  DOM.drawerEndpoint.textContent = STATE.endpointUrl;
}

function renderDashboard({ animate = true } = {}) {
  if (!Object.keys(STATE.hubsData).length) return;

  const metricaCfg = METRICAS[STATE.metrica];
  const hubActivo = HUBS.find((h) => h.id === STATE.hubId) || HUBS[0];

  const evaluacionHubs = HUBS.map((hub) => {
    const serie = normalizarSerie(STATE.hubsData[hub.id], STATE.metrica, STATE.ventana);
    const stats = analizarSerie(serie, STATE.umbral);
    return { hub, serie, stats };
  });

  const rankingOrdenado = [...evaluacionHubs].sort((a, b) => b.stats.riskScore - a.stats.riskScore);
  const actual = evaluacionHubs.find((item) => item.hub.id === hubActivo.id);
  const { serie, stats } = actual;
  const insight = construirInsights(hubActivo, metricaCfg, stats, STATE.umbral);

  DOM.umbralValue.textContent = `${STATE.umbral} ${metricaCfg.unidad}`;
  actualizarStatusUI();

  DOM.insightStrip.className = `insight-strip ${insight.clase}`;
  DOM.insightTag.textContent = insight.tag;
  DOM.insightHubLabel.textContent = `${hubActivo.nombre} · ${hubActivo.zona}`;
  DOM.lastUpdated.textContent = `Act. ${STATE.ultimaActualizacion} (${STATE.latenciaMs} ms)`;
  DOM.insightHeadline.textContent = insight.titular;
  DOM.insightBody.textContent = insight.cuerpo;

  DOM.dispatchWindows.innerHTML = `
    <div class="window-chip window-chip--safe">
      <span>Ventana Segura</span>
      <strong class="tabular">${stats.ventanaSegura}</strong>
    </div>
    <div class="window-chip ${stats.criticos.length ? "window-chip--alert" : ""}">
      <span>Ventana Restringida</span>
      <strong class="tabular">${stats.ventanaCritica}</strong>
    </div>
  `;

  const signo = stats.deltaPct >= 0 ? "+" : "";
  DOM.kpi1Label.textContent = `PICO ${metricaCfg.corto.toUpperCase()}`;
  DOM.kpi1Value.textContent = `${stats.max} ${metricaCfg.unidad}`;
  DOM.kpi1Sub.textContent = `Máximo a las ${stats.horaMax} hrs`;
  DOM.kpi1Delta.textContent = `${signo}${stats.deltaPct}% vs prom`;
  DOM.kpi1Delta.className = `kpi-badge ${stats.max >= STATE.umbral ? "kpi-badge--alert" : ""}`;
  renderSparkline(DOM.spark1, serie.map((d) => d.valor), stats.max >= STATE.umbral ? "var(--alert)" : "var(--accent)");

  DOM.kpi2Value.textContent = `${stats.promedio} ${metricaCfg.unidad}`;
  DOM.kpi2Range.textContent = `${stats.min}–${stats.max} ${metricaCfg.unidad}`;
  DOM.kpi2Sub.textContent = `Media móvil estabilizada (3h)`;
  renderSparkline(DOM.spark2, serie.map((d) => d.mediaMovil), "var(--ma-color)");

  DOM.kpi3Value.textContent = `${stats.criticos.length} / ${serie.length} hrs`;
  DOM.kpi3Sub.textContent = `Bloques ≥ ${STATE.umbral} ${metricaCfg.unidad}`;
  DOM.kpi3Pct.textContent = `${stats.pctExposicion}%`;
  DOM.kpi3Pct.className = `kpi-badge ${stats.pctExposicion >= 25 ? "kpi-badge--alert" : stats.pctExposicion > 0 ? "kpi-badge--warn" : ""}`;
  const barColor = stats.pctExposicion >= 25 ? "var(--alert)" : stats.pctExposicion > 0 ? "var(--warn)" : "var(--accent)";
  DOM.exposureMiniBar.innerHTML = `<div class="exposure-ring__fill" style="width:${Math.max(4, stats.pctExposicion)}%;background:${barColor}"></div>`;

  DOM.kpi4Value.textContent = `${stats.riskScore} / 100`;
  DOM.kpi4Sub.textContent = `Foco: ${metricaCfg.foco}`;
  DOM.kpi4State.textContent = stats.nivel;
  DOM.kpi4State.className = `kpi-badge ${stats.nivel === "CRÍTICO" ? "kpi-badge--alert" : stats.nivel === "ALERTA" ? "kpi-badge--warn" : ""}`;
  renderSparkline(DOM.spark4, rankingOrdenado.map((r) => r.stats.riskScore), barColor);

  DOM.chartTitle.textContent = `${metricaCfg.nombre} · ${hubActivo.nombre} (${metricaCfg.unidad})`;
  DOM.chartSubtitle.textContent = `${hubActivo.zona} · Comparativa contra umbral de ${STATE.umbral} ${metricaCfg.unidad}`;
  renderMainSvg(serie, STATE.umbral, metricaCfg, { animate });

  DOM.timelineCells.innerHTML = serie
    .map((p, i) => {
      const esAlerta = p.valor >= STATE.umbral;
      const mostrarHora = serie.length <= 18 || i % 2 === 0;
      return `
        <div class="t-cell ${esAlerta ? "t-cell--alert" : "t-cell--safe"}" title="${p.hora} hrs: ${p.valor} ${metricaCfg.unidad}">
          <div class="t-cell__bar"></div>
          <span class="t-cell__hour">${mostrarHora ? p.hora.slice(0, 2) : ""}</span>
        </div>
      `;
    })
    .join("");

  DOM.hubRankingList.innerHTML = rankingOrdenado
    .map(({ hub, stats: st }) => {
      const selected = hub.id === STATE.hubId;
      const color = st.nivel === "CRÍTICO" ? "var(--alert)" : st.nivel === "ALERTA" ? "var(--warn)" : "var(--accent)";
      return `
        <button type="button" class="hub-item ${selected ? "is-selected" : ""}" data-hub="${hub.id}" role="option" aria-selected="${selected}">
          <div class="hub-item__top">
            <span class="hub-item__name">${hub.nombre}<span class="hub-item__zone">${hub.zona}</span></span>
            <span class="hub-item__metric" style="color:${color}">${st.max} ${metricaCfg.unidad}</span>
          </div>
          <div class="hub-item__bar-row">
            <div class="risk-track">
              <div class="risk-fill" style="width:${st.riskScore}%;background:${color}"></div>
            </div>
            <span class="hub-item__score">${st.riskScore} · ${st.nivel}</span>
          </div>
        </button>
      `;
    })
    .join("");

  DOM.protocolTag.textContent = stats.nivel;
  DOM.actionList.innerHTML = insight.acciones
    .map((a) => `<li class="${a.priority ? "is-priority" : ""}">${a.texto}</li>`)
    .join("");

  const preview = {
    fuente: STATE.origen === "fallback" ? "Respaldo Local Resiliente" : "Open-Meteo Multi-Hub API",
    latencia_ms: STATE.latenciaMs,
    hub_seleccionado: `${hubActivo.nombre} (${hubActivo.zona})`,
    coordenadas: [hubActivo.lat, hubActivo.lon],
    variable_activa: metricaCfg.campo,
    umbral_gerencial: `${STATE.umbral} ${metricaCfg.unidad}`,
    kpis_calculados: {
      maximo: stats.max,
      hora_pico: stats.horaMax,
      promedio: stats.promedio,
      indice_riesgo: stats.riskScore,
      bloques_criticos: stats.criticos.length,
    },
    muestra_serie: serie.slice(0, 6),
  };
  DOM.jsonViewer.textContent = JSON.stringify(preview, null, 2);
}

/* Flujo de carga asíncrono */
async function cargarTodo({ forceRefresh = false, simularError = false, showToast = false } = {}) {
  DOM.loadingOverlay.hidden = false;
  DOM.btnRefresh.disabled = true;
  DOM.statusBadge.className = "status-dot-pill status--loading";
  DOM.statusText.textContent = "Sincronizando...";

  const { hubsData, origen, latenciaMs } = await fetchMultiHubConResiliencia({ forceRefresh, simularError });
  STATE.hubsData = hubsData;
  STATE.origen = origen;
  STATE.latenciaMs = latenciaMs;
  STATE.ultimaActualizacion = new Date().toLocaleTimeString("es-CL");

  DOM.loadingOverlay.hidden = true;
  DOM.btnRefresh.disabled = false;
  renderDashboard({ animate: true });

  if (showToast) {
    mostrarToastSync(origen, latenciaMs);
  }
}

/* --------------------------------------------------------------------------
 * 5. EVENTOS DE INTERACCIÓN Y ACCESIBILIDAD
 * -------------------------------------------------------------------------- */
function sincronizarSlider(metricaKey) {
  const cfg = METRICAS[metricaKey];
  DOM.rangeUmbral.min = cfg.min;
  DOM.rangeUmbral.max = cfg.max;
  DOM.rangeUmbral.value = cfg.umbralDefault;
  STATE.umbral = cfg.umbralDefault;
}

DOM.metricaGroup.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-metrica]");
  if (!btn) return;
  DOM.metricaGroup.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  STATE.metrica = btn.dataset.metrica;
  sincronizarSlider(STATE.metrica);
  renderDashboard({ animate: true });
});

DOM.ventanaGroup.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-ventana]");
  if (!btn) return;
  DOM.ventanaGroup.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  STATE.ventana = btn.dataset.ventana;
  renderDashboard({ animate: true });
});

// Sin animación de redibujado completo al arrastrar el slider para máxima fluidez
DOM.rangeUmbral.addEventListener("input", (e) => {
  STATE.umbral = Number(e.target.value);
  renderDashboard({ animate: false });
});

DOM.hubRankingList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-hub]");
  if (!item) return;
  STATE.hubId = item.dataset.hub;
  renderDashboard({ animate: true });
});

DOM.btnRefresh.addEventListener("click", () => cargarTodo({ forceRefresh: true, showToast: true }));
DOM.btnSimularFallo.addEventListener("click", () => cargarTodo({ simularError: true, showToast: true }));

DOM.btnPolling.addEventListener("click", () => {
  STATE.polling = !STATE.polling;
  DOM.btnPolling.setAttribute("aria-pressed", String(STATE.polling));
  if (STATE.polling) {
    DOM.pollingLabel.textContent = "Auto ON";
    STATE.pollingTimer = setInterval(() => cargarTodo({ forceRefresh: true, showToast: true }), 60000);
  } else {
    DOM.pollingLabel.textContent = "Auto 60s";
    clearInterval(STATE.pollingTimer);
  }
});

DOM.btnTheme.addEventListener("click", () => {
  const html = document.documentElement;
  const oscuro = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", oscuro ? "light" : "dark");
  DOM.btnTheme.textContent = oscuro ? "☾" : "☀";
});

function toggleDrawer(abrir) {
  DOM.drawer.classList.toggle("is-open", abrir);
  DOM.drawer.setAttribute("aria-hidden", String(!abrir));
  DOM.drawerBackdrop.hidden = !abrir;
}

DOM.btnOpenDrawer.addEventListener("click", () => toggleDrawer(true));
DOM.btnCloseDrawer.addEventListener("click", () => toggleDrawer(false));
DOM.drawerBackdrop.addEventListener("click", () => toggleDrawer(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleDrawer(false);
});

DOM.btnCopyJson.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(DOM.jsonViewer.textContent);
    DOM.btnCopyJson.textContent = "Copiado ✓";
    setTimeout(() => (DOM.btnCopyJson.textContent = "Copiar JSON"), 1600);
  } catch {
    DOM.btnCopyJson.textContent = "Error al copiar";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  sincronizarSlider(STATE.metrica);
  cargarTodo({ showToast: true });
});