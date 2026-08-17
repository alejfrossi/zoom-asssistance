# Zoom Attendance Tracker

Extensión de Chrome (Manifest V3) que cruza la lista de participantes activos en una reunión de Zoom con un registro CSV y genera un reporte de asistencia descargable.

Sin servidor externo, sin Python, sin dependencias — todo corre en el navegador.

---

## Requisitos

- Google Chrome
- Reuniones de Zoom accedidas desde `zoom.us` en el navegador (no la app de escritorio)

---

## Instalación

1. Abrí `chrome://extensions/` en Chrome.
2. Activá el **Modo de desarrollador** (switch en la esquina superior derecha).
3. Hacé clic en **Cargar extensión sin comprimir** y seleccioná la carpeta `extension/`.
4. Fijá la extensión en la barra de Chrome para tenerla siempre a mano.

> Chrome puede mostrar el aviso "Las extensiones en modo de desarrollador están habilitadas" al iniciar. Es normal — cerralo o hacé clic en **Mantener**.

---

## Uso

1. Entrá a una reunión de Zoom en Chrome y abrí el panel de **Participantes**.
2. Hacé clic en el ícono de la extensión.
3. Cargá tu lista de alumnos en formato CSV (un nombre por fila, encabezado `Nombre` opcional).
4. Hacé clic en **Escanear y procesar asistencia**.
5. Revisá la tabla de resultados y hacé clic en **Descargar reporte CSV** para guardar el archivo.

### Formato del CSV

```
Nombre
Ana Perez
Juan Gomez
Maria Lopez
```

Los nombres con y sin tilde se tratan como equivalentes (`María López` coincide con `Maria Lopez`).

---

## Cómo funciona

La extensión inyecta un script en la pestaña activa de Zoom para extraer la lista de participantes del DOM. Luego normaliza los nombres (elimina diacríticos, sufijos de Zoom como `(yo)`, `(anfitrión)`, tokens numéricos) y aplica una coincidencia flexible por subconjunto de tokens — `Juan Gimenez` coincide con `Juan Pablo Gimenez` y viceversa. Los resultados se muestran en el popup y se exportan como CSV UTF-8 con asistencia y estado de cámara por alumno.

---

## Permisos

| Permiso | Propósito |
|---|---|
| `activeTab` | Leer la pestaña activa de Zoom |
| `scripting` | Inyectar el script de extracción de participantes |
| `https://*.zoom.us/*` | Restringir el acceso de host únicamente a Zoom |

---

## Estructura del proyecto

```
zoom-assistance/
    extension/
        manifest.json
        popup.html
        popup.js
        icons/
    lista_alumnos.csv     # lista de ejemplo
    INSTRUCCIONES.txt     # guía de instalación para el usuario final
```

---

## Solución de problemas

**No se detectan participantes** — Confirmá que el panel de Participantes esté abierto dentro del cliente web de Zoom, no en la app de escritorio. Si la extensión fue instalada recientemente, recargá la pestaña de Zoom e intentá nuevamente.

**Todos los alumnos figuran como ausentes** — Verificá que los nombres de pantalla en Zoom sean similares a los del CSV.

**El CSV no se abre correctamente en Excel** — Usá **Datos > Desde texto/CSV** en Excel, o hacé doble clic en el archivo y seleccioná el delimitador correcto.
