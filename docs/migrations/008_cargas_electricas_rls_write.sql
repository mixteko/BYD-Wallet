-- BYD Wallet v0.6.2 — Políticas RLS para escritura en cargas_electricas
-- La tabla ya existe; solo faltaban permisos INSERT/UPDATE/DELETE para anon.

CREATE POLICY "Allow insert cargas_electricas" ON public.cargas_electricas
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update cargas_electricas" ON public.cargas_electricas
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow delete cargas_electricas" ON public.cargas_electricas
  FOR DELETE TO anon, authenticated
  USING (true);
