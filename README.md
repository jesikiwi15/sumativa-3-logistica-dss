# RM·OPS — Torre de Control Logística & Riesgo Climático (RM)

Aplicación web de **Soporte a la Decisión (DSS)** en tiempo real desarrollada para la **Evaluación Sumativa 3** de la asignatura *Visualización de Datos* (Ingeniería en Informática, INACAP Sede Maipú).

Transforma flujos JSON crudos desde la API pública de **Open-Meteo** en visualizaciones vectoriales **SVG puras**, indicadores contextualizados y recomendaciones gerenciales accionables para operaciones logísticas y cadena de frío en la Región Metropolitana.

---

## Demo en Vivo
> **[Ver aplicación publicada aquí] ()**

---

## Problema de Negocio y Decisión Gerencial

* **Caso de estudio:** Ruteo Inteligente y Riesgo Climático (Logística & Cadena de Suministro).
* **Cobertura:** Monitoreo simultáneo de 5 hubs estratégicos de la Región Metropolitana: **Maipú**, **Pudahuel (ENEA)**, **Quilicura**, **San Bernardo** y **Santiago Centro**.
* **Variables operativas:** Temperatura (`°C`, cadena de frío), Velocidad de Viento (`km/h`, flota y grúas) y Probabilidad de Precipitación (`%`, seguridad vial en última milla).
* **Decisión soportada:** Identificar ventanas horarias seguras y restringidas, reasignar carga perecible antes de los picos térmicos y priorizar contingencias según un ranking comparativo de riesgo (`0–100`).

---

## Arquitectura Técnica (Estado → Visualización)

La aplicación implementa un flujo unidireccional desacoplado en Vanilla JavaScript (ES6+), sin librerías externas de gráficos:

1. **Ingesta Asíncrona Multi-Hub (`fetch` + `async/await`):** Consulta las coordenadas de los 5 hubs en una sola petición HTTP a `api.open-meteo.com/v1/forecast` (sin API Key), con control de tiempo límite (`AbortController`), medición real de latencia (`ms`), caché en `localStorage` (TTL 60s) y **respaldo local automático (`fallback`)** ante fallos de red o límites 429.
2. **Normalización y Analítica:** Limpieza de nulos, segmentación por ventana operativa, cálculo de **Media Móvil de 3 horas**, variaciones porcentuales frente al promedio, porcentaje de exposición crítica e índice compuesto de riesgo logístico.
3. **Motor Gráfico SVG Puro y Responsivo:** Escalas lineales puras (`scaleLinear`), `viewBox` adaptable a móvil y proyector, banda de zona crítica sobre el umbral, *sparklines* en tarjetas KPI y *crosshair* interactivo con tooltips dinámicos.
4. **Data Storytelling Gerencial:** Titular ejecutivo dinámico, chips de ventana segura/restringida y protocolo priorizado que responde qué acción tomar según los datos vigentes.
5. **Trazabilidad Técnica:** Cajón deslizable (`{ } Payload`) que expone origen de datos, latencia, endpoint y JSON normalizado sin ensuciar la vista ejecutiva.

---

## Estructura del Proyecto

```text
sumativa3-logistica-dss/
├── index.html   # Estructura semántica HTML5, accesibilidad ARIA y drawer técnico
├── styles.css   # Sistema de diseño claro pastel + soporte modo oscuro con variables CSS
├── app.js       # Estado central, ingesta resiliente, analítica y motor SVG puro
└── README.md    # Documentación del proyecto