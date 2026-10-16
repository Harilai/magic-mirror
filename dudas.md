 # - DUDAS -

# - Pagina magicmirror -
    https://magicmirror.builders/

# - instalar NODE - 
    https://nodejs.org/es 

# - Errores de firma Online -
    "Get-ChildItem D:\Tools\nodejs -Recurse | Unblock-File" 
    "npm.cmd" 

# - Como Empezar (Windows)-
## - Instalar dependencias -
    "npm run install-mm:dev"
## - Instalar Archivo Conf -
    "cp config/config.js.sample config/config.js" Ahora mismo no hace falta ya que hay uno creado.
## - Comprobar - 
    "npm run start:windows"

# - Modulos -
## - Calendario -
    En el modulo de calendario he modificado la url (desde config.js). El enlace debe ser ics para que funcione y pueda mostrarlo. Los eventos deben estar en publico para que se muestren tambien.

    Para que los cumples aparezcan cada año con mostrando el numero de años, se debe añadir en "config.js" la etiqueta "repeatingCountTitle :" seguido del texto que queramos.

    Se permiten varios Calendarios.
    
    Hay un error en mostrar "fechas de cumples, años" ya que al haber creado el evento este año no lo muestra, se debe añadir manualmente al archivo "/calendar/ics/archivo" siguiendo la estructura que esta.

## - Tiempo -
    El tiempo se muestra por coordenadas ajustables en el config.js. Ahora estan puestas las de maliaño que se asemejan a las de santander. Esta configurado de modo que te muestre el tiempo de ahora y el de los proximos dias.



# - Posibles Implementaciones -

## Navegación y control
    MMM-pages: reparte los módulos en varias páginas, por ejemplo una para la mañana y otra para la música. Por sí solo no permite cambiar de página a mano.
    https://github.com/edward-shen/MMM-pages · activo (octubre 2026)

    MMM-page-indicator: puntitos en pantalla que indican en qué página estás y en los que puedes tocar para cambiar. Es el complemento táctil de MMM-pages.
    https://github.com/edward-shen/MMM-page-indicator · febrero 2026, en mantenimiento

    MMM-Carousel: alternativa a pages. Agrupa módulos en diapositivas, con indicadores, botones de navegación y control por teclado.
    https://github.com/shbatm/MMM-Carousel · activo (octubre 2026)
    
    MMM-SmartTouch: interfaz táctil con modo en espera (oculta todo y queda como espejo normal) y menú lateral.
    https://github.com/EbenKouao/MMM-SmartTouch · último cambio en 2021

    MMM-Gestures: control por gestos de la mano. Necesita un sensor extra (APDS-9960 o uno de infrarrojos).
    https://github.com/thobach/MMM-Gestures · último cambio en diciembre de 2022

    MMM-Remote-Control: web para el móvil con la que apagas el espejo, enciendes o apagas la pantalla y muestras u ocultas módulos.
    https://github.com/Jopyth/MMM-Remote-Control · activo (octubre 2026)

## Cuidado de la pantalla
    MMM-MagicMover: evita que la pantalla se queme con contenido fijo.
    https://github.com/Lavve/MMM-MagicMover · activo (septiembre 2026)

    MMM-BurnIn: lo mismo, haciendo parpadear toda la pantalla.
    https://github.com/werthdavid/MMM-BurnIn · último cambio en 2021
    
## Contenido
    MMM-Meteosat: imágenes de satélite casi en tiempo real del servicio oficial de EUMETSAT, con la Tierra sobre fondo transparente pensado para espejos oscuros. Elegante y encaja con tu diseño.
    https://github.com/FHFH2025/MMM-Meteosat · activo (julio 2026)

    MMM-EasyPix: muestra fotos y GIFs que dejas en una carpeta del módulo.
    https://github.com/KristjanESPERANTO/MMM-EasyPix · activo (septiembre 2026)

    MMM-SpotifyConnectUI: muestra portada, artista y canción de Spotify Connect.
    https://github.com/CatoAntonsen/MMM-SpotifyConnectUI · último cambio en febrero de 2017


