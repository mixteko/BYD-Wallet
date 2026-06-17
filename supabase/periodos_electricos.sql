-- ============================================================================
-- BYD Wallet — Tabla: periodos_electricos
-- ============================================================================
-- Este módulo registra recibos bimestrales de energía eléctrica.
--
-- Propósito:
--   - Almacenar periodos de facturación eléctrica (recibos de CFE).
--   - Calcular automáticamente el costo promedio por kWh (costo_kwh_mxn).
--   - El costo calculado servirá como valor sugerido para calcular
--     el costo de las cargas EV en el frontend.
--   - Los datos provienen del recibo de CFE (consumo, tarifa, costo, folio).
--
-- Estado actual (jun 2026):
--   - Este SQL NO se ha ejecutado en Supabase todavía.
--   - El módulo convivirá inicialmente con Settings y no lo reemplaza.
--   - El campo costo_kwh_mxn se usa como referencia; el usuario podrá
--     mantener su valor manual en Settings si lo prefiere.
-- ============================================================================

CREATE TABLE periodos_electricos (
    -- Identificador único del periodo
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

    -- Fecha de inicio del periodo de facturación (ej. 2026-01-01)
    fecha_inicio DATE NOT NULL,

    -- Fecha de fin del periodo de facturación (ej. 2026-02-28)
    fecha_fin DATE NOT NULL,

    -- Consumo total del bimestre en kWh
    kwh_bimestre NUMERIC(10,2) NOT NULL,

    -- Costo total del recibo en MXN
    costo_total_mxn NUMERIC(10,2) NOT NULL,

    -- Costo promedio por kWh calculado automáticamente
    -- Fórmula: costo_total_mxn / kwh_bimestre
    -- Precisión de 4 decimales para cálculos precisos de cargas EV
    costo_kwh_mxn NUMERIC(10,4)
        GENERATED ALWAYS AS (costo_total_mxn / NULLIF(kwh_bimestre, 0)) STORED,

    -- Proveedor de electricidad (por defecto CFE)
    proveedor TEXT DEFAULT 'CFE',

    -- Tipo de tarifa eléctrica (ejemplo: 1, 1A, 1C, DAC)
    tarifa TEXT,

    -- Número o folio del recibo de CFE para futuras consultas y evitar duplicados
    numero_recibo TEXT,

    -- Notas adicionales opcionales
    notas TEXT,

    -- Fecha de creación del registro
    created_at TIMESTAMP DEFAULT NOW(),

    -- ── Constraints ────────────────────────────────────────────────────────

    -- La fecha de fin debe ser posterior o igual a la fecha de inicio
    CONSTRAINT periodos_electricos_fechas_check
        CHECK (fecha_fin >= fecha_inicio),

    -- El consumo debe ser mayor a cero
    CONSTRAINT periodos_electricos_kwh_check
        CHECK (kwh_bimestre > 0),

    -- El costo total no puede ser negativo
    CONSTRAINT periodos_electricos_costo_check
        CHECK (costo_total_mxn >= 0),

    -- Unicidad: evitar periodos duplicados con las mismas fechas
    CONSTRAINT periodos_electricos_unique
        UNIQUE (fecha_inicio, fecha_fin)
);

-- ── Índices ──────────────────────────────────────────────────────────────────

-- Índice para búsquedas por rango de fechas (útil para relacionar con cargas EV)
CREATE INDEX idx_periodos_electricos_fechas
    ON periodos_electricos (fecha_inicio, fecha_fin);

-- ── Comentarios ───────────────────────────────────────────────────────────────

COMMENT ON TABLE periodos_electricos IS
    'Registra recibos bimestrales de energía eléctrica. costo_kwh_mxn se calcula automáticamente. El módulo convive con Settings y no lo reemplaza. Los datos provienen del recibo de CFE.';

COMMENT ON COLUMN periodos_electricos.fecha_inicio IS
    'Fecha de inicio del periodo de facturación';

COMMENT ON COLUMN periodos_electricos.fecha_fin IS
    'Fecha de fin del periodo de facturación. Debe ser >= fecha_inicio';

COMMENT ON COLUMN periodos_electricos.kwh_bimestre IS
    'Consumo total del bimestre en kWh. Debe ser > 0';

COMMENT ON COLUMN periodos_electricos.costo_total_mxn IS
    'Costo total del recibo en MXN. Debe ser >= 0';

COMMENT ON COLUMN periodos_electricos.costo_kwh_mxn IS
    'Costo promedio por kWh calculado como costo_total_mxn / kwh_bimestre. Precisión 4 decimales. Sirve como valor sugerido para cargas EV.';

COMMENT ON COLUMN periodos_electricos.proveedor IS
    'Proveedor de electricidad. Por defecto CFE';

COMMENT ON COLUMN periodos_electricos.tarifa IS
    'Tipo de tarifa eléctrica (ejemplo: 1, 1A, 1C, DAC)';

COMMENT ON COLUMN periodos_electricos.numero_recibo IS
    'Número o folio del recibo de CFE. Útil para consultas y evitar duplicados.';

-- ============================================================================
-- Ejemplo de inserción:
--
-- INSERT INTO periodos_electricos
--   (fecha_inicio, fecha_fin, kwh_bimestre, costo_total_mxn,
--    proveedor, tarifa, numero_recibo, notas)
-- VALUES
--   ('2026-01-01', '2026-02-28', 450.00, 3000.00,
--    'CFE', '1C', 'CFE-2026-001234', 'Periodo enero-febrero 2026');
--
-- Esto generaría automáticamente:
--   costo_kwh_mxn = 3000.00 / 450.00 = 6.6667
-- ============================================================================
