# Mural Interactivo

Aplicación web fullscreen para evento que construye el logo de la marca como fotomosaico en tiempo real. El frontend renderiza el mosaico sobre `canvas` y escucha assets procesados desde Supabase; un worker Node genera thumbnails cuadradas y metadatos visuales a partir de las imágenes originales.

## Stack

- `React + Vite + TypeScript` para la pantalla del evento
- `Supabase Realtime` para inserciones en vivo
- `sharp` para crear thumbnails y calcular color/luminosidad promedio
- `Vitest` para validar la lógica de asignación de tiles

## Scripts

- `npm run dev`: levanta la app en modo desarrollo
- `npm run build`: typecheck + build de producción
- `npm run preview`: sirve el build local
- `npm run test`: corre pruebas unitarias
- `npm run worker`: ejecuta el worker en modo polling continuo
- `npm run worker:once`: procesa una pasada y termina

## Variables de entorno

Copiá `.env.example` como `.env` y completá los valores.

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_ASSET_TABLE`
- `VITE_MOSAIC_FETCH_LIMIT`
- `VITE_MOSAIC_POLL_INTERVAL_MS`

### Worker

- `MOSAIC_SUPABASE_URL`
- `MOSAIC_SUPABASE_SERVICE_ROLE_KEY`
- `MOSAIC_SOURCE_TABLE`
- `MOSAIC_SOURCE_ID_COLUMN`
- `MOSAIC_SOURCE_IMAGE_URL_COLUMN`
- `MOSAIC_SOURCE_CREATED_AT_COLUMN`
- `MOSAIC_ASSET_TABLE`
- `MOSAIC_THUMB_BUCKET`
- `MOSAIC_THUMB_PATH_PREFIX`
- `MOSAIC_THUMB_SIZE`
- `MOSAIC_BATCH_SIZE`
- `MOSAIC_SOURCE_SCAN_LIMIT`
- `MOSAIC_POLL_INTERVAL_MS`

## Flujo esperado

1. La tabla fuente ya existente guarda la URL de la imagen original.
2. El worker lee las fotos nuevas o fallidas, genera un thumbnail `cover`, calcula `avg_r/g/b`, `luma` y sube el thumbnail a Storage.
3. El worker hace `upsert` en `public.mosaic_assets`.
4. El frontend escucha `mosaic_assets` en Realtime y rellena la mejor celda libre del logo para cada foto nueva.

## Supabase

El archivo [supabase/mosaic-assets.sql](./supabase/mosaic-assets.sql) crea la tabla sidecar, el bucket público de thumbnails y la publicación de Realtime. Adaptá la tabla fuente con las variables de entorno del worker, sin tener que tocar el frontend.

## Modo demo

Si `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` no están configuradas, la app entra automáticamente en modo demo local para que puedas validar la puesta visual del mural sin backend.

## Controles útiles

- `D`: muestra u oculta el overlay de debug

## Recomendación para evento

- Ejecutar la pantalla en Chrome o Edge en fullscreen
- Mantener el worker corriendo en paralelo
- Usar un bucket público solo para thumbnails optimizadas; las originales pueden seguir en el esquema actual
