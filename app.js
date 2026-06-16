// ── BYD Wallet — Dashboard JavaScript ─────────────────────────────────────
// Consume datos reales desde Supabase y renderiza el dashboard.

const { createClient } = supabase;

const supabaseClient = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

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

function formatDate(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── Data Loading ──────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    // 1. Load configuration
    const { data: configRows, error: configError } = await supabaseClient
      .from("configuracion")
      .select("*")
      .limit(1)
      .single();

    if (configError) {
      console.warn("Error cargando configuración:", configError.message);
    }

    const config = configRows || {};

    // 2. Load all recargas
    const { data: recargas, error: recargasError } = await supabaseClient
      .from("recargas")
      .select("*")
      .order("fecha", { ascending: false });

    if (recargasError) {
      console.error("Error cargando recargas:", recargasError.message);
      showError("No se pudieron cargar los datos de recargas.");
      return;
    }

    if (!recargas || recargas.length === 0) {
      showEmpty();
      return;
    }

    // 3. Compute KPIs
    const totalGasolina = recargas.reduce((sum, r) => sum + Number(r.costo_total_mxn || 0), 0);
    const totalLitros = recargas.reduce((sum, r) => sum + Number(r.litros || 0), 0);
    const numRecargas = recargas.length;

    const odometroActual = Math.max(...recargas.map((r) => Number(r.odometro_km || 0)));
    const odometroInicial = Number(config.odometro_inicial_km) || 0;
    const kmRecorridos = odometroActual - odometroInicial;
    const costoPorKm = kmRecorridos > 0 ? totalGasolina / kmRecorridos : 0;

    const precioPromedioLitros =
      recargas.reduce((sum, r) => sum + Number(r.precio_litro_mxn || 0), 0) / numRecargas;

    // 4. Render KPIs
    document.getElementById("odometro-valor").textContent = formatNumber(odometroActual, 0) + " km";
    document.getElementById("total-gastado-valor").textContent = formatCurrency(totalGasolina);
    document.getElementById("total-litros-valor").textContent = formatNumber(totalLitros, 1) + " L";
    document.getElementById("costo-km-valor").textContent = formatCurrency(costoPorKm) + " /km";
    document.getElementById("num-recargas-valor").textContent = formatNumber(numRecargas, 0);
    document.getElementById("precio-promedio-valor").textContent = formatCurrency(precioPromedioLitros) + " /L";

    // 5. Render history table
    const tbody = document.getElementById("historial-body");
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

    // 6. Hide loading / show content
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("dashboard-content").classList.remove("hidden");
  } catch (err) {
    console.error("Error inesperado:", err);
    showError("Ocurrió un error inesperado al cargar el dashboard.");
  }
}

// ── UI States ─────────────────────────────────────────────────────────────

function showEmpty() {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("dashboard-content").classList.add("hidden");
  document.getElementById("empty-state").classList.remove("hidden");
}

function showError(message) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("dashboard-content").classList.add("hidden");
  const errorEl = document.getElementById("error-state");
  errorEl.classList.remove("hidden");
  document.getElementById("error-message").textContent = message;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", loadDashboard);
