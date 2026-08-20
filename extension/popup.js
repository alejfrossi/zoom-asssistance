// ============================================================
// Zoom Attendance Tracker — popup.js
// Toda la lógica corre en el browser. Sin servidor externo.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const processBtn = document.getElementById("processBtn");
  const statusDiv = document.getElementById("status");
  const fileInput = document.getElementById("csvFileInput");
  const resultSection = document.getElementById("resultSection");
  const resultBody = document.getElementById("resultBody");
  const downloadBtn = document.getElementById("downloadBtn");
  const summaryDiv = document.getElementById("summary");

  let reporteCSV = null; // Guardamos el CSV generado para el botón de descarga

  processBtn.addEventListener("click", async () => {
    if (fileInput.files.length === 0) {
      setStatus("warning", "Por favor, cargá el archivo CSV primero.");
      return;
    }

    setStatus("loading", "Escaneando participantes de Zoom...");
    resultSection.style.display = "none";
    downloadBtn.style.display = "none";
    reporteCSV = null;

    try {
      // 1. Obtener participantes de Zoom desde el DOM de la pestaña activa
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: scrapeZoomDataFull,
      });

      // Buscar el frame que devolvió datos reales
      let zoomData = null;
      for (const frameResult of injectionResults) {
        const r = frameResult.result;
        if (r && !r.error && Object.keys(r).length > 0) {
          zoomData = r;
          break;
        }
      }

      if (!zoomData) {
        const firstError = injectionResults.find(r => r.result && r.result.error);
        setStatus("warning", firstError
          ? firstError.result.error
          : "No se detectó la lista. Abrí el panel 'Participantes' en Zoom."
        );
        return;
      }

      setStatus("loading", `${Object.keys(zoomData).length} participantes detectados. Procesando CSV...`);

      // 2. Leer y parsear el CSV de la lista de alumnos
      const csvText = await leerArchivo(fileInput.files[0]);
      const alumnos = parsearCSV(csvText);

      if (alumnos.length === 0) {
        setStatus("warning", "El archivo CSV está vacío o no tiene el formato correcto.");
        return;
      }

      // 3. Procesar asistencia
      const { filas, resumen } = procesarAsistencia(alumnos, zoomData);

      // 4. Mostrar tabla de resultados en el popup
      renderTabla(filas);
      summaryDiv.textContent =
        `Presentes: ${resumen.presentes} | Ausentes: ${resumen.ausentes} | Total: ${resumen.total}`;
      resultSection.style.display = "block";

      // 5. Generar CSV en memoria
      reporteCSV = generarCSV(filas);
      downloadBtn.style.display = "block";

      setStatus("success", "¡Listo! Revisá el reporte y descargalo.");

    } catch (err) {
      console.error("[ZoomAttendance] Error:", err);
      setStatus("error", "Error inesperado: " + err.message);
    }
  });

  // Botón de descarga separado del procesamiento
  downloadBtn.addEventListener("click", () => {
    if (!reporteCSV) return;
    const blob = new Blob(["\uFEFF" + reporteCSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asistencia_procesada.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("success", "¡Archivo descargado!");
  });

  // ── Helpers de UI ──────────────────────────────────────────
  function setStatus(type, msg) {
    statusDiv.style.display = "flex";
    statusDiv.textContent = msg;
    statusDiv.className = "status " + type;
  }

  function renderTabla(filas) {
    resultBody.innerHTML = "";
    filas.slice(1).forEach(([nombre, asistencia, camara]) => {
      const tr = document.createElement("tr");
      const presente = asistencia === "Presente";
      const camOn = camara === "Encendida";
      tr.innerHTML = `
        <td class="nombre">${nombre}</td>
        <td class="${presente ? 'presente' : 'ausente'}">${presente ? "✓" : "✗"} ${asistencia}</td>
        <td class="${camOn ? 'cam-on' : 'cam-off'}">${camOn ? "🟢" : "🔴"} ${camara}</td>
      `;
      resultBody.appendChild(tr);
    });
  }
});

// ============================================================
// LÓGICA DE SCRAPING (se inyecta en la pestaña de Zoom)
// IMPORTANTE: scrapeZoomDataFull debe ser completamente auto-contenida
// porque chrome.scripting.executeScript con `func` inyecta UNA SOLA función
// sin acceso al scope externo. Toda la lógica auxiliar va DENTRO de ella.
// ============================================================

/**
 * Función principal de scraping con scroll automático.
 * Auto-contenida: no depende de ninguna función externa.
 * Recorre toda la lista virtualizada de Zoom haciendo scroll progresivo
 * y recolectando participantes en cada posición.
 */
async function scrapeZoomDataFull() {
  const data = {};

  // ── Helper interno: extraer items visibles en el DOM ────────────────────
  function scrapeVisibleItems() {
    let items = null;

    // Estrategia 1: contenedor por ID
    const container = document.getElementById("participants-ul");
    if (container) {
      items = container.querySelectorAll(".participants-li, [id^='participants-list-']");
    }
    // Estrategia 2: todo el documento
    if (!items || items.length === 0) {
      items = document.querySelectorAll(".participants-li, [id^='participants-list-']");
    }
    // Estrategia 3: por aria-label del contenedor de lista
    if (!items || items.length === 0) {
      const listContainer = document.querySelector(
        '[aria-label="Participants list"], [aria-label="Lista de participantes"]'
      );
      if (listContainer) {
        items = listContainer.querySelectorAll(
          ".participants-li, [id^='participants-list-'], [role='application']"
        );
      }
    }

    if (!items || items.length === 0) return false;

    items.forEach((el) => {
      // Nombre desde span de display
      const nameEl = el.querySelector(".participants-item__display-name");
      let name = nameEl ? nameEl.innerText.trim() : "";

      // Fallback: desde aria-label
      const aria = el.getAttribute("aria-label") || "";
      if (!name && aria) {
        name = aria.split(",")[0].replace(/\s*\([^)]*\)/g, "").trim();
      }

      if (!name) return;

      // Estado de cámara
      const ariaLower = aria.toLowerCase();
      const videoOffSvg  = el.querySelector('svg[class*="video-off"]');
      const videoOnSvg   = el.querySelector('svg[class*="video-on"]');
      const videoOffAria = ariaLower.includes("video off") || ariaLower.includes("video apagado");
      const videoOnAria  = ariaLower.includes("video on")  || ariaLower.includes("video encendido");

      let camera_on = true;
      if (videoOffSvg || videoOffAria) camera_on = false;
      else if (videoOnSvg || videoOnAria) camera_on = true;

      // Solo registra la primera aparición (no sobreescribe)
      if (!(name in data)) {
        data[name] = { camera_on };
      }
    });

    return true;
  }

  // ── Helper interno: encontrar contenedor scrolleable ────────────────────
  function findScrollContainer() {
    const candidates = [
      document.getElementById("participants-ul"),
      document.querySelector('[aria-label="Participants list"]'),
      document.querySelector('[aria-label="Lista de participantes"]'),
      document.querySelector(".participants-ul"),
      document.querySelector(".participants-list"),
      document.querySelector(".participant-list__container"),
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    // Búsqueda genérica: ancestro scrolleable del primer item
    const firstItem = document.querySelector(".participants-li, [id^='participants-list-']");
    if (firstItem) {
      let parent = firstItem.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight + 5) return parent;
        parent = parent.parentElement;
      }
    }
    return null;
  }

  // ── Lectura inicial (posición de scroll = 0) ────────────────────────────
  const foundInitial = scrapeVisibleItems();

  if (!foundInitial) {
    return {
      error: "No se detectó la lista de participantes. Abrí el panel 'Participantes' en Zoom."
    };
  }

  // ── Scroll automático para recorrer toda la lista virtualizada ──────────
  const scrollEl = findScrollContainer();

  if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {
    const scrollStep  = Math.max(scrollEl.clientHeight * 0.75, 100); // 75% del alto visible
    const maxScroll   = scrollEl.scrollHeight - scrollEl.clientHeight;
    const delayMs     = 120; // ms de espera para que el DOM virtualizado actualice

    let currentScroll = 0;
    while (currentScroll < maxScroll) {
      currentScroll = Math.min(currentScroll + scrollStep, maxScroll);
      scrollEl.scrollTop = currentScroll;
      await new Promise(r => setTimeout(r, delayMs));
      scrapeVisibleItems();
    }

    // Restaurar scroll al inicio para no desorientar al usuario
    scrollEl.scrollTop = 0;
    await new Promise(r => setTimeout(r, 80));
  }

  if (Object.keys(data).length === 0) {
    return {
      error: "No se detectó la lista de participantes. Abrí el panel 'Participantes' en Zoom."
    };
  }

  return data;
}

// ============================================================
// LÓGICA DE PROCESAMIENTO (corre en el contexto del popup)
// ============================================================

/** Lee un File como texto, detectando encoding automáticamente */
function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    // Intentar utf-8 primero, luego latin-1 si falla
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, "UTF-8");
  });
}

/** Parsea un CSV y devuelve array de nombres (sin header) */
function parsearCSV(text) {
  const lineas = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lineas.length === 0) return [];
  // Detectar si la primera línea es header (ej. "Nombre")
  const primeraLinea = lineas[0].toLowerCase().replace(/"/g, "");
  const tieneHeader = primeraLinea === "nombre" || primeraLinea === "name" || primeraLinea === "alumno";
  return tieneHeader ? lineas.slice(1) : lineas;
}

/**
 * Normaliza un nombre para comparación:
 * - Quita tildes/diacríticos
 * - Minúsculas, espacios limpios
 * - Remueve sufijos de Zoom: (yo), (anfitrión), (host), etc.
 */
function normalizar(nombre) {
  if (!nombre) return "";
  return nombre
    .normalize("NFD")                          // descomponer caracteres
    .replace(/[\u0300-\u036f]/g, "")           // quitar diacríticos
    .toLowerCase()
    .replace(/\s*\((yo|anfitri[oó]n|coanfitri[oó]n|host|co-host|me|guest|invitado)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Devuelve los tokens de un nombre normalizado (solo letras y números,
 * descartando tokens que sean puramente numéricos — ej. IDs de Zoom).
 */
function tokenizar(nombreNorm) {
  return nombreNorm
    .split(/\s+/)
    .filter(t => t.length > 0 && !/^\d+$/.test(t)); // descarta tokens solo numéricos
}

/**
 * Matching flexible entre el nombre del alumno y un nombre de Zoom.
 *
 * Reglas:
 * 1. Match exacto (normalizado) → presente.
 * 2. Subset de tokens: si todos los tokens del nombre más corto están
 *    contenidos en los tokens del nombre más largo → presente.
 *    Cubre casos como:
 *      - Lista: "Juan Gimenez"      ↔ Zoom: "Juan Pablo Gimenez"
 *      - Lista: "Juan Pablo Gimenez" ↔ Zoom: "Juan Gimenez"
 *      - Lista: "Juan Gimenez"      ↔ Zoom: "Juan Gimenez 4821"
 */
function coinciden(claveAlumno, claveZoom) {
  if (claveAlumno === claveZoom) return true;

  const tokensAlumno = tokenizar(claveAlumno);
  const tokensZoom   = tokenizar(claveZoom);

  if (tokensAlumno.length === 0 || tokensZoom.length === 0) return false;

  // El conjunto más pequeño debe estar contenido en el más grande
  const [menores, mayores] = tokensAlumno.length <= tokensZoom.length
    ? [tokensAlumno, tokensZoom]
    : [tokensZoom, tokensAlumno];

  return menores.every(t => mayores.includes(t));
}

/** Compara la lista de alumnos contra los datos de Zoom y genera el reporte */
function procesarAsistencia(alumnos, zoomData) {
  // Normalizar las claves de zoomData una sola vez
  const zoomEntries = Object.entries(zoomData).map(([nombre, info]) => ({
    claveNorm: normalizar(nombre),
    info,
  }));

  const filas = [["Nombre", "Asistencia", "Cámara"]];
  let presentes = 0, ausentes = 0;

  for (const alumno of alumnos) {
    const nombre = alumno.replace(/^"|"$/g, "").trim(); // quitar comillas si las hay
    if (!nombre) continue;

    const claveAlumno = normalizar(nombre);

    // Buscar coincidencia exacta primero, luego subset de tokens
    const match = zoomEntries.find(({ claveNorm }) => coinciden(claveAlumno, claveNorm));

    if (match) {
      presentes++;
      filas.push([nombre, "Presente", match.info.camera_on ? "Encendida" : "Apagada"]);
    } else {
      ausentes++;
      filas.push([nombre, "Ausente", "Apagada"]);
    }
  }

  return { filas, resumen: { presentes, ausentes, total: presentes + ausentes } };
}

/** Convierte un array de filas en un string CSV válido */
function generarCSV(filas) {
  return filas
    .map(fila => fila.map(celda => `"${celda.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}
