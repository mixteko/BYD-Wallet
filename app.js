// ── BYD Wallet — Dashboard JavaScript ─────────────────────────────────────
// Consume datos reales desde Supabase y renderiza el dashboard.

// ── Helpers ───────────────────────────────────────────────────────────────

function formatCurrency(amount) {
  return (
    "$" +
    Number(amount).toLocaleString("es-MX", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatNumber(value, decimals = 2) {
  return Number(value).toLocaleString("es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function normalizeDate(fecha) {
  if (!fecha) return null;
  const s = String(fecha).trim();

  // YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return date;
    }
    return null;
  }

  // DD/MM/YY
  const dmy2Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmy2Match) {
    const day = parseInt(dmy2Match[1], 10);
    const month = parseInt(dmy2Match[2], 10) - 1;
    let year = parseInt(dmy2Match[3], 10);
    year += year >= 50 ? 1900 : 2000;
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
    return null;
  }

  // DD/MM/YYYY
  const dmy4Match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy4Match) {
    const day = parseInt(dmy4Match[1], 10);
    const month = parseInt(dmy4Match[2], 10) - 1;
    const year = parseInt(dmy4Match[3], 10);
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
    return null;
  }

  return null;
}

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = normalizeDate(isoString);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── UI States ─────────────────────────────────────────────────────────────

function showError(message) {
  console.error("[BYD Wallet]", message);
  const loading = document.getElementById("loading");
  const content = document.getElementById("dashboard-content");
  const errorEl = document.getElementById("error-state");
  const errorMsg = document.getElementById("error-message");
  if (loading) loading.classList.add("hidden");
  if (content) content.classList.add("hidden");
  if (errorEl) errorEl.classList.remove("hidden");
  if (errorMsg) errorMsg.textContent = message;
}

function showEmpty() {
  const loading = document.getElementById("loading");
  const content = document.getElementById("dashboard-content");
  const emptyEl = document.getElementById("empty-state");
  if (loading) loading.classList.add("hidden");
  if (content) content.classList.add("hidden");
  if (emptyEl) emptyEl.classList.remove("hidden");
}

function showContent() {
  const loading = document.getElementById("loading");
  const content = document.getElementById("dashboard-content");
  if (loading) loading.classList.add("hidden");
  if (content) content.classList.remove("hidden");
}

// ── Validation ────────────────────────────────────────────────────────────

function validateConfig() {
  const url = SUPABASE_CONFIG?.url;
  const key = SUPABASE_CONFIG?.anonKey;

  if (!url || !key) {
    showError(
      "Falta la configuración de Supabase. Revisa config.js y asegúrate de que SUPABASE_URL y SUPABASE_ANON_KEY tengan valores reales."
    );
    return false;
  }

  if (url.includes("TU_PROYECTO") || key.includes("TU_ANON_KEY")) {
    showError(
      "Las credenciales de Supabase en config.js aún tienen valores placeholder. Reemplázalos con los de tu proyecto."
    );
    return false;
  }

  return true;
}

// ── Data Loading ──────────────────────────────────────────────────────────

async function loadDashboard() {
  console.log("[BYD Wallet] Iniciando carga del dashboard...");

  // 1. Validate config
  if (!validateConfig()) return;

  // 2. Validate supabase library loaded
  if (typeof supabase === "undefined" || !supabase.createClient) {
    showError(
      "La librería de Supabase no se cargó correctamente. Revisa la conexión a internet o el CDN en index.html."
    );
    return;
  }

  const { createClient } = supabase;
  const supabaseClient = createClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.anonKey
  );

  try {
    // 3. Load configuration
    console.log("[BYD Wallet] Cargando configuración...");
    const { data: configRows, error: configError } = await supabaseClient
      .from("configuracion")
      .select("*")
      .limit(1);

    if (configError) {
      console.warn("[BYD Wallet] Error cargando configuración:", configError.message);
      showError(
        "Error al cargar la configuración: " +
          configError.message +
          ". Verifica que la tabla 'configuracion' exista y tenga políticas RLS SELECT para anon."
      );
      return;
    }

    const config = (configRows && configRows[0]) || {};
    console.log("[BYD Wallet] Configuración cargada:", config);

    // 4. Load all recargas
    console.log("[BYD Wallet] Cargando recargas...");
    const { data: recargas, error: recargasError } = await supabaseClient
      .from("recargas")
      .select("*")
      .order("fecha", { ascending: false });

    if (recargasError) {
      console.error("[BYD Wallet] Error cargando recargas:", recargasError.message);
      showError(
        "Error al cargar las recargas: " +
          recargasError.message +
          ". Verifica que la tabla 'recargas' exista y tenga políticas RLS SELECT para anon."
      );
      return;
    }

    console.log("[BYD Wallet] Recargas cargadas:", recargas ? recargas.length : 0, "registros");

    if (!recargas || recargas.length === 0) {
      console.warn("[BYD Wallet] No hay recargas registradas.");
      showEmpty();
      return;
    }

    // 5. Compute KPIs
    const totalGasolina = recargas.reduce(
      (sum, r) => sum + Number(r.costo_total_mxn || 0),
      0
    );
    const totalLitros = recargas.reduce(
      (sum, r) => sum + Number(r.litros || 0),
      0
    );
    const numRecargas = recargas.length;

    const odometroActual = Math.max(
      ...recargas.map((r) => Number(r.odometro_km || 0))
    );
    const odometroInicial = Number(config.odometro_inicial_km) || 0;
    const kmRecorridos = odometroActual - odometroInicial;
    const costoPorKm = kmRecorridos > 0 ? totalGasolina / kmRecorridos : 0;

    const precioPromedioLitros =
      recargas.reduce((sum, r) => sum + Number(r.precio_litro_mxn || 0), 0) /
      numRecargas;

    console.log("[BYD Wallet] KPIs calculados:", {
      odometroActual,
      totalGasolina,
      totalLitros,
      costoPorKm,
      numRecargas,
      precioPromedioLitros,
    });

    // 6. Render KPIs
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
      else console.warn("[BYD Wallet] Elemento no encontrado:", id);
    };

    setText("odometro-valor", formatNumber(odometroActual, 0) + " km");
    setText("total-gastado-valor", formatCurrency(totalGasolina));
    setText("total-litros-valor", formatNumber(totalLitros, 1) + " L");
    setText("costo-km-valor", formatCurrency(costoPorKm) + " /km");
    setText("num-recargas-valor", formatNumber(numRecargas, 0));
    setText("precio-promedio-valor", formatCurrency(precioPromedioLitros) + " /L");

    // 7. Render history table
    const tbody = document.getElementById("historial-body");
    if (tbody) {
      tbody.innerHTML = "";

      recargas.forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td data-label="Fecha">${formatDate(r.fecha)}</td>
          <td data-label="Odómetro">${formatNumber(r.odometro_km, 0)} km</td>
          <td data-label="Litros">${formatNumber(r.litros, 2)} L</td>
          <td data-label="Precio/L">${formatCurrency(r.precio_litro_mxn)}</td>
          <td data-label="Total">${formatCurrency(r.costo_total_mxn)}</td>
          <td data-label="Gasolinera">${r.gasolinera || "—"}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      console.warn("[BYD Wallet] Elemento historial-body no encontrado");
    }

    // 8. Show content
    showContent();
    console.log("[BYD Wallet] Dashboard renderizado correctamente.");
  } catch (err) {
    console.error("[BYD Wallet] Error inesperado:", err);
    showError(
      "Ocurrió un error inesperado: " +
        (err.message || "desconocido") +
        ". Abre la consola del navegador (F12) para más detalles."
    );
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
// Esperar a que el DOM esté listo antes de ejecutar cualquier lógica.

document.addEventListener("DOMContentLoaded", function () {
  console.log("[BYD Wallet] DOM listo. Inicializando...");
  // Pequeño timeout para asegurar que el CDN de Supabase se haya cargado
  setTimeout(loadDashboard, 100);
});
