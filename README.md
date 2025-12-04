# Jabră

Reproductor de música ligero (desktop/móvil) con un servidor Express sencillo para contar reproducciones y estado de dispositivos. Este repositorio está optimizado para pesar poco: no se suben archivos de audio, se referencian URLs o un único archivo de prueba.

## Requisitos
- Node.js 16+ (recomendado 18+)
- No necesitas paquetes globales

## Instalación
Abre una terminal en la carpeta del proyecto e instala las dependencias:

```bash
npm install

## Ejecución
Inicia el servidor:
```

```bash
npm start
```

Por defecto el servidor corre en el puerto 3000. Para cambiar el puerto (por ejemplo, 5000), establece la variable de entorno y luego inicia:

```bash
set PORT=5000
 ```

```bash
npm start
 ```

Abre http://localhost:3000 (o el puerto que elijas) en tu navegador.

## Estructura del proyecto
- server.js — Servidor Express y endpoints JSON
- index.html — Página de redirección que selecciona mobile/desktop/tv
- index.desktop.html , index.mobile.html , index.tv.html — Variantes de UI
- js/app.js — Lógica del cliente (player, polling de dispositivos, sincronización de layout)
- json/songs.json — Metadatos de canciones (IDs, títulos, artistas, URLs)
- json/playcounts.server.json — Estado generado por el servidor; ignorado por Git
- json/devices.server.json — Estado generado por el servidor; ignorado por Git
- css/* , img/* — Estilos e imágenes
## Cómo trabajar con json/songs.json
El archivo json/songs.json debe seguir la misma estructura JSON para cada canción. La idea es usar una sola canción de prueba colocada en la carpeta media y registrarla en el JSON.

- Coloca tu archivo de audio en media/ (por ejemplo: media/mi_cancion.mp3 ).
- Registra esa canción en json/songs.json siguiendo esta estructura:
```json
[
  {
    "id": "song-001",
    "title": "Mi Canción",
    "artist": "Autor",
    "album": null,
    "genre": null,
    "duration": 0,
    "cover": null,
    "url": "media/mi_cancion.mp3"
  }
]
 ```

Notas:

- id : cadena única para identificar la canción.
- title y artist : texto visible en la app.
- duration : puede ser 0 si no lo conoces; la app mostrará el tiempo al reproducir.
- cover : opcional; si no tienes portada, deja null .
- url : ruta relativa al archivo dentro de media/ .
Si más adelante quieres usar múltiples canciones, repite el mismo formato (un objeto por canción dentro del arreglo). Para mantener el repositorio liviano, es preferible usar archivos pequeños o URLs externas.

## Mantener el repositorio liviano
- Evita subir audios pesados. Si es posible, usa URLs externas en json/songs.json .
- Los archivos de estado del servidor están ignorados por Git:
  - json/playcounts.server.json

  - json/devices.server.json
