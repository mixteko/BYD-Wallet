-- BYD Wallet v0.6.2 — Políticas RLS completas para cargas_electricas
-- Patrón idéntico a periodos_electricos (rol anon, app sin autenticación de usuario).
-- La tabla NO tiene columna user_id; no usar auth.uid().

ALTER TABLE public.cargas_electricas ENABLE ROW LEVEL SECURITY;

-- Idempotente: eliminar políticas previas si existen
DROP POLICY IF EXISTS "permitir lectura cargas electricas" ON public.cargas_electricas;
DROP POLICY IF EXISTS "Allow read cargas_electricas" ON public.cargas_electricas;
DROP POLICY IF EXISTS "Allow insert cargas_electricas" ON public.cargas_electricas;
DROP POLICY IF EXISTS "Allow update cargas_electricas" ON public.cargas_electricas;
DROP POLICY IF EXISTS "Allow delete cargas_electricas" ON public.cargas_electricas;

CREATE POLICY "Allow read cargas_electricas" ON public.cargas_electricas
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Allow insert cargas_electricas" ON public.cargas_electricas
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Allow update cargas_electricas" ON public.cargas_electricas
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow delete cargas_electricas" ON public.cargas_electricas
  FOR DELETE TO anon
  USING (true);
