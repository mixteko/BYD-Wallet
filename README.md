# BYD Wallet

Control de gastos, recargas y rendimiento para BYD King.

Aplicación web construida con Next.js 16, Supabase y Recharts. Diseño oscuro, datos en tiempo real.

## Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```

Abrir [http://localhost:3001](http://localhost:3001) en el navegador.

## Flujo de trabajo

1. Hacer cambios locales en `app/page.tsx` u otros archivos
2. Probar en http://localhost:3001
3. Commit en `main`
4. Push a `origin/main`

## Rama activa

```
main
```

## Versión

```
v0.6.5
```

## Legacy

Los archivos de la versión anterior (HTML plano con JavaScript vanilla y GitHub Pages blanco) están aislados en la carpeta `legacy-github-pages/`. Esa versión está deprecated y no se utiliza.

## Tecnologías

| Tecnología | Versión | Propósito |
|---|---|---|
| Next.js | 16 | Framework React (App Router) |
| React | 19 | UI |
| TypeScript | ~5 | Tipado estático |
| Tailwind CSS | 4 | Estilos utilitarios |
| Recharts | ~3.8 | Gráficos |
| Supabase | ~2.108 | Base de datos PostgreSQL |

## Documentación

Ver carpeta `docs/` para documentación técnica oficial del proyecto:

- `ARCHITECTURE.md` — Diagrama de flujo y estructura
- `DATABASE.md` — Esquema de Supabase
- `MODULES.md` — Módulos de la aplicación
- `CALCULATIONS.md` — Fórmulas y KPIs
- `PROJECT_CONTEXT.md` — Contexto general del proyecto
- `ROADMAP.md` — Planificación futura
