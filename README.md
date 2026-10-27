<div align="center">

# 🪞 MagicMirror

**Versión personalizada de la aplicación MagicMirror open source**

</div>
Esta es una versión creada por mí de la aplicación MagicMirror open source. En el proyecto se implementarán distintos módulos útiles, los cuales podrán verse después en un espejo que montaré.

---

## 📑 Índice

- [Dudas](#-dudas)
- [Cómo empezar (Windows)](#-cómo-empezar-windows)
- [Módulos](#-módulos)
- [Posibles implementaciones](#-posibles-implementaciones)

---

## ❓ Dudas

| Tema                    | Enlace / solución                                                         |
| ----------------------- | ------------------------------------------------------------------------- |
| Página MagicMirror      | https://magicmirror.builders/                                             |
| Instalar Node           | https://nodejs.org/es                                                     |
| Errores de firma online | `Get-ChildItem D:\Tools\nodejs -Recurse \| Unblock-File` o usar `npm.cmd` |

---

## 🚀 Cómo empezar (Windows)

**1. Instalar dependencias**

```bash
npm run install-mm:dev
```

**2. Instalar archivo de configuración**

```bash
cp config/config.js.sample config/config.js
```

> [!NOTE]
> Ahora mismo no hace falta, ya que hay uno creado.

**3. Comprobar**

```bash
npm run start:windows
```

---

## 🧩 Módulos

| Módulo                             | Para qué sirve                                          |
| ---------------------------------- | ------------------------------------------------------- |
| [Calendario](#-calendario)         | Muestra eventos y cumpleaños desde un calendario `.ics` |
| [Tiempo](#tiempo)                  | Tiempo actual y de los próximos días                    |
| [Magic Mover](#-magic-mover)       | Evita píxeles quemados moviendo el contenido            |
| [Today Events](#-today-events)     | Mensaje con las tareas del calendario de hoy            |
| [Spotify](#-spotify)               | Muestra la UI de Spotify al reproducir música           |
| [Remote Control](#-remote-control) | Permite de modificar MagicMirror desde una app          |

### 📅 Calendario

En el módulo de calendario he modificado la URL (desde `config.js`).

- El enlace debe ser `.ics` para que funcione y pueda mostrarlo.
- Los eventos deben estar en público para que se muestren también.
- Se permiten varios calendarios.
- Para que los cumpleaños aparezcan cada año mostrando el número de años, se debe añadir en `config.js` la etiqueta `repeatingCountTitle:` seguida del texto que queramos.

> [!CUMPLEAÑOS]
> Hay un error al mostrar "fechas de cumpleaños, años": al haber creado el evento este año, no lo muestra. Se debe añadir manualmente al archivo `/calendar/ics/archivo`, siguiendo la estructura que hay.

### Tiempo

El tiempo se muestra por coordenadas ajustables en el `config.js`. Ahora están puestas las de Maliaño, que se asemejan a las de Santander. Está configurado de modo que muestre el tiempo de ahora y el de los próximos días.

### 🔀 Magic Mover

Se ha implementado este módulo para prevenir píxeles muertos o quemados en la pantalla. Al mostrar todo el rato lo mismo podría suceder, y no queremos.

Lo que hace es que cada cierto tiempo el contenido se mueve unos píxeles, evitando que se use el mismo píxel durante meses:

| Ajuste               | Valor      |
| -------------------- | ---------- |
| Cada cuánto se mueve | 10 minutos |
| Cuánto se mueve      | 15 píxeles |

🔗 GitHub: https://github.com/Lavve/MMM-MagicMover

### 🎂 Today Events

He creado un nuevo módulo llamado **MMM-TodayEvents**, que saca un mensaje con las tareas del calendario asignadas a ese día.

> **Ejemplo:** si en el calendario tienes puesto que el 20 de agosto es el cumpleaños de alguien, ese día te saldrá un mensaje en pantalla recordándolo.

### 🎵 Spotify

He añadido el módulo **MMM-Spotify**, que permite ver la UI de Spotify cuando se está reproduciendo música. Solo es la UI, y hace falta instalar **Raspotify** y añadir altavoces para que el espejo pueda reproducir música.

> [IMPORTANTE]
> La cuenta debe ser **Premium**.

Pasos para configurarlo:

1. Entrar en https://developer.spotify.com/dashboard/
2. Crear una app.
3. Añadir la URL `http://127.0.0.1:8888/callback`.
4. Seleccionar "Web API".
5. Crear un archivo `.conf` como el que trae el módulo de ejemplo.

Además, he modificado el CSS para que tenga un estilo mejor, para que la UI de Spotify aparezca más pequeña y en la esquina de la derecha.

🔗 GitHub: https://github.com/skuethe/MMM-Spotify

### 📱 Remote Control

He añadido el modulo **MMM-Remote-Control**, esto permite acceder de forma externa (mediante una aplicacion) el espejo interactivo. Para esto debes estar conectado a la misma red y acceder a la url (Ip_de_raspberry:8080/remote.html) una vez abierto tendras la opcion de poder añadir la pagina como shortcut. La pagina tendra dos modos, dev y usuario donde se mostraran solo apartados útiles del dia a dia (encender,apagar,reiniciar,cambiar tonos...).

Los pasos de instalación son:

1. Clonarte el repo : "https://github.com/Jopyth/MMM-Remote-Control"
2. Dentro de la carpeta ejecutar el comando de instalación : "npm ci --omit=dev"
3. Añadir el modulo al config.js y configurar la ipWhitelist con tu ip : "::ffff:xxx.xxx.xx.0/120","xxx.xxx.xx.0/24" y establecer address como "0.0.0.0"

> [IMPORTANTE]
> Debes estar conectado a la misma red wifi para poder usarlo

---

## 💡 Posibles implementaciones

### Navegación y control

| Módulo                                                                  | Descripción                                                                                                                                   | Estado                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [MMM-pages](https://github.com/edward-shen/MMM-pages)                   | Reparte los módulos en varias páginas, por ejemplo una para la mañana y otra para la música. Por sí solo no permite cambiar de página a mano. | 🟢 Activo (octubre 2026)              |
| [MMM-page-indicator](https://github.com/edward-shen/MMM-page-indicator) | Puntitos en pantalla que indican en qué página estás y en los que puedes tocar para cambiar. Es el complemento táctil de MMM-pages.           | 🟡 Febrero 2026, en mantenimiento     |
| [MMM-Carousel](https://github.com/shbatm/MMM-Carousel)                  | Alternativa a pages. Agrupa módulos en diapositivas, con indicadores, botones de navegación y control por teclado.                            | 🟢 Activo (octubre 2026)              |
| [MMM-SmartTouch](https://github.com/EbenKouao/MMM-SmartTouch)           | Interfaz táctil con modo en espera (oculta todo y queda como un espejo normal) y menú lateral.                                                | 🔴 Último cambio en 2021              |
| [MMM-Gestures](https://github.com/thobach/MMM-Gestures)                 | Control por gestos de la mano. Necesita un sensor extra (APDS-9960 o uno de infrarrojos).                                                     | 🔴 Último cambio en diciembre de 2022 |

### Contenido

| Módulo                                                                       | Descripción                                                                                                                                                                       | Estado                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [MMM-Meteosat](https://github.com/FHFH2025/MMM-Meteosat)                     | Imágenes de satélite casi en tiempo real del servicio oficial de EUMETSAT, con la Tierra sobre fondo transparente, pensado para espejos oscuros. Elegante y encaja con tu diseño. | 🟢 Activo (julio 2026)              |
| [MMM-EasyPix](https://github.com/KristjanESPERANTO/MMM-EasyPix)              | Muestra fotos y GIF que dejas en una carpeta del módulo.                                                                                                                          | 🟢 Activo (septiembre 2026)         |
| [MMM-SpotifyConnectUI](https://github.com/CatoAntonsen/MMM-SpotifyConnectUI) | Muestra portada, artista y canción de Spotify Connect.                                                                                                                            | 🔴 Último cambio en febrero de 2017 |

---
