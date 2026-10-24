<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

# backlog-pane

[English](README.md) · **Español**

Un tablero en vivo de [Backlog.md](https://github.com/MrLesk/Backlog.md) en un panel lateral
de Claude Code.

> **No oficial.** backlog-pane es un mod de la comunidad para Claude Code. No forma parte
> del proyecto Backlog.md ni de Anthropic, y ninguno de los dos lo respalda ni lo mantiene.
> Solo usa la CLI `backlog` que ya tienes instalada.

`/backlog` abre un panel junto a la conversación con tus tareas en una columna por estado.
El panel se mantiene al día con `backlog task list --json --watch`, así que se actualiza
cuando Claude, tú o tu equipo cambiáis una tarea. Arrastra una tarjeta para moverla, o abre
una tarea para editar su título, prioridad, criterios de aceptación, descripción y plan.
**Trabajar en esta tarea** y **Editar con Claude** dejan un prompt preparado en el cuadro
del prompt. El prompt **nunca se envía por ti**.

## Funciones

- **Tablero en vivo.** En la terminal y en la app de escritorio, una columna por estado en
  el orden de tu configuración, encabezada por el estado como una etiqueta de su color.
  Cada tarjeta es un recuadro con el borde del color de su estado, con su título (en dos
  líneas si las necesita), su ID y los criterios cumplidos; una tarjeta movida a otra
  columna toma el color de esa columna. Arrastra una tarjeta a otra columna para moverla,
  o usa el teclado (ver [Atajos](#atajos)). El estado final (normalmente *Done*) muestra solo sus tareas más
  recientes. VS Code y el móvil muestran las mismas tareas como una lista agrupada por
  estado, con el estado final plegado.
- **Estados, desde el panel.** **Estados…** muestra todos los estados con su número de
  tareas. Ahí añades uno y eliges dónde va, eliminas uno sin tareas, eliges el color de
  cada estado y marcas **Cerrado** en estados como *Cancelled*. Los cerrados salen
  atenuados y plegados como el estado final, y ◀/▶ y las flechas del tablero se los
  saltan; aun así puedes mover una tarea ahí con el selector de estado o arrastrándola.
- **Colores que siguen tu tema.** Los estados usan colores del tema, así que encajan con
  temas claros y oscuros. Si no eliges uno, el primer estado, uno tipo *In Progress* y el
  final tienen cada uno el suyo, y los demás se van turnando. Las tareas de prioridad alta llevan un **`!`**
  en el color de error, para que el significado no dependa solo del color.
- **Nueva tarea.** **+ Nueva tarea** abre un campo para el título. **Cancelar** lo cierra,
  y se cierra solo cuando la tarea se ha creado.
- **Mover una tarea.** En la vista de la tarea, **◀ estado anterior** y **estado
  siguiente ▶** (teclas `h` y `l`) la mueven un paso, en todas las superficies. El selector
  de estado salta a cualquiera.
- **Editar una tarea.** Título, prioridad (de `backlog config get priorities`, si no
  Alta/Media/Baja) y criterios de aceptación. Puedes marcar, añadir, editar y eliminar
  criterios; eliminar pide confirmación antes.
- **Textos largos.** Edita la descripción y el plan de implementación en un campo de varias
  líneas (Claude Code 2.1.301 o posterior), o en tu propio editor en versiones anteriores
  (ver [Editar textos largos](#editar-textos-largos)).
- **Trabajar en esta tarea** prepara este prompt, con el ID real de la tarea (sea cual sea
  el prefijo de tu proyecto):

  ```text
  Trabaja solo en BL-7. Investiga el código y escribe un plan de implementación en la tarea. Espera mi aprobación antes de programar.
  ```

- **Editar con Claude** prepara `Actualiza BL-7: ` con el cursor detrás, listo para que
  digas qué hay que cambiar.

  Los dos borradores sustituyen un cuadro del prompt vacío. Si el cuadro ya tiene texto,
  el borrador se añade debajo. No se envía nada.
- **Inglés y español.** El panel, el comando y los dos borradores. Ver la opción
  `language`.
- **Solo la CLI, con una excepción.** Cada cambio en una tarea ejecuta un comando `backlog`
  (`task edit`, `task create`); el mod nunca edita los archivos de las tareas. Backlog.md no
  tiene ningún comando que cambie la lista de estados, así que crear o eliminar uno
  reescribe solo la línea `statuses:` de la configuración de Backlog.md (ver
  [Estados](#estados)).
- **Errores claros.** El panel te avisa, con un botón **Reintentar**, cuando la CLI no está
  instalada, la carpeta no tiene un proyecto de Backlog.md o la lista en vivo falla una y
  otra vez.

## Atajos

Dale el teclado al panel con `ctrl+x` y luego `tab`, o haciendo clic en él. Tab pasa de un
control a otro y Esc vuelve al prompt.

| Dónde | Tecla o acción | Qué hace |
| --- | --- | --- |
| Tablero (terminal, escritorio) | Arrastrar una tarjeta a otra columna | Mueve la tarea allí. |
| Tablero (terminal, escritorio) | Clic en una tarjeta y luego en un hueco libre de otra columna | Mueve allí la tarjeta seleccionada. |
| Tablero | Otro clic en la tarjeta seleccionada | Abre la tarea. |
| Tablero | Clic en un hueco libre | Suelta la tarjeta seleccionada. Una tarjeta que has movido con el ratón se suelta sola, así que un clic posterior no puede volver a moverla. |
| Tablero, tras hacer clic en él | `←` / `→` | Mueve la tarjeta seleccionada a la siguiente columna abierta a la izquierda o a la derecha, saltándose las cerradas. |
| Tablero, tras hacer clic en él | `↑` / `↓` | Selecciona la tarjeta de arriba o de abajo. La primera tecla selecciona la primera tarjeta de la primera columna abierta. |
| Tablero, tras hacer clic en él | `Enter` | Abre la tarea seleccionada. |
| Tablero | `Esc` | Devuelve el teclado. |
| Vista de la tarea | `h` | Mueve la tarea al estado abierto anterior (◀). |
| Vista de la tarea | `l` | Mueve la tarea al estado abierto siguiente (▶). |
| Campo de varias líneas | `Enter` | Guarda. |
| Campo de varias líneas | `Mayús+Enter`, o `\` y luego `Enter` | Empieza una línea nueva. |

`h` y `l` funcionan mientras el panel tiene el teclado, no mientras escribes en el cuadro
del prompt.

## Estados

Los estados son de cada proyecto: Backlog.md los guarda en su configuración
(`backlog/config.yml`, o `backlog.config.yml` / `.backlog/config.yml`). El panel los lee con
`backlog config get statuses` y dibuja las columnas en ese orden. El último es el estado
final ("terminado"), la misma regla que usa Backlog.md.

**Estados…** (junto a **+ Nueva tarea**) abre su lista:

- **Añadir uno:** elige su **Posición** (al principio o después de cualquier estado; por
  defecto, antes del final), escribe su nombre y pulsa Enter. El nombre no puede estar
  vacío, repetir otro (aunque cambien las mayúsculas), tener comas, comillas o saltos de
  línea, ni pasar de 40 caracteres.
- **Eliminar uno:** **Eliminar** solo aparece junto a un estado sin tareas, y pide
  confirmación. El estado en el que empiezan las tareas nuevas
  (`backlog config get defaultStatus`) no se elimina, y un proyecto siempre conserva al
  menos dos.

Backlog.md no tiene un comando para esto, así que el panel:

1. busca la configuración como lo hace Backlog.md, desde la carpeta de la sesión hacia
   arriba;
2. reescribe solo su línea `statuses:` y deja el resto de líneas como estaban;
3. ejecuta `backlog config get statuses` y, si Backlog.md no lee exactamente la lista
   nueva, deja el archivo como estaba y lo avisa.

Cada fila tiene además:

- **Color:** uno de los colores del tema (Azul, Azul acero, Verde azulado, Verde, Ámbar,
  Naranja, Rojo, Morado, Lavanda, Gris) o **Automático**, el que le daría el panel. La
  etiqueta del estado, el borde de sus tarjetas y su muestra lo toman al momento. En el
  móvil se van cambiando con un botón.
- **Cerrado:** un estado cerrado sale plegado y atenuado, y ◀/▶ y las flechas del tablero
  se lo saltan. El estado final siempre es final, así que no tiene casilla.

Los colores y los estados cerrados se guardan **por proyecto**, en el almacén que Claude
Code da al mod (por el archivo de configuración del proyecto), porque la configuración de
Backlog.md no tiene sitio para ellos. Son solo tuyos: no van en el repositorio, así que tu
equipo no los comparte, y un proyecto movido a otra carpeta empieza de cero. La opción
`closedStatuses` (más abajo) solo es el valor inicial de un proyecto en el que nunca se ha
marcado ninguna casilla **Cerrado**.

## Editar textos largos

**Claude Code 2.1.301 o posterior:** **Editar**, junto a *Descripción* o *Plan de
implementación*, abre un campo de 8 líneas. Enter guarda con `backlog task edit <id> -d …`
o `--plan …`.

**Versiones anteriores:** ahí `Input` no tiene `rows`, y un dibujo que lo pide puede
rechazarse o mostrarse como un campo de una sola línea. Por eso el panel no lo pide ahí y
muestra **Abrir en el editor** en su lugar. Escribe el texto en un archivo de tu carpeta
temporal (`TMPDIR`, `TEMP` o `TMP`) y abre tu editor con él. Cuando el editor termina, el
panel vuelve a leer el archivo y lo guarda. El editor es el primero de estos:

1. `backlog config get defaultEditor`
2. `VISUAL`
3. `EDITOR`
4. Notepad, en Windows

**El editor tiene que seguir abierto hasta que cierres el archivo**; si no, el panel lee el
archivo antes de que hayas escrito nada. Los editores de terminal (`vim`, `nano`) ya lo
hacen. Un editor gráfico necesita su opción de espera:

```bash
backlog config set defaultEditor "code --wait"
```

El panel espera hasta diez minutos. Pasado ese tiempo, la edición no se aplica.

## Capturas

<!-- Sustituir por capturas reales: docs/screenshots/terminal-board.png,
     docs/screenshots/terminal-task.png, docs/screenshots/desktop-board.png -->

_Las capturas llegarán pronto. Mientras tanto, esta es una vista previa en texto del panel
en la terminal:_

```text
[ + Nueva tarea ] [ Estados… ]

 Cancelled  1     To Do  1         In Progress  1   Done  2

╭─────────────╮  ╭─────────────╮  ╭─────────────╮  ╭─────────────╮
│ Old export  │  │ ! Rate      │  │ ! Write the │  │ Add login   │
│ idea        │  │   limiting… │  │   JSON str… │  │ page        │
│ TASK-5      │  │ TASK-3      │  │ TASK-1 · 1… │  │ TASK-2      │
╰─────────────╯  ╰─────────────╯  ╰─────────────╯  ╰─────────────╯
                                                   ╭─────────────╮
                                                   │ Dark mode   │
                                                   │ TASK-4      │
                                                   ╰─────────────╯

Arrastra una tarjeta a otra columna, o haz clic en ella y pulsa
←/→ para moverla, ↑/↓ para elegir otra, Enter para abrirla.
```

_Es el panel acoplado en una terminal de 150 columnas (Claude Code 2.1.310). En pantalla
cada estado es una etiqueta de su color y el borde de cada tarjeta toma el color de su
estado; la tarjeta seleccionada tiene el borde grueso, y la columna sobre la que arrastras
una tarjeta muestra un hueco discontinuo donde caerá._

Los nombres de los estados y de las tareas son los de tu proyecto; el panel no los traduce.

## Requisitos

- **Claude Code 2.1.295 o posterior**, con mods: la CLI, o la pestaña Code de la app Claude
  Desktop. Las versiones anteriores no pueden dibujar las filas de tareas (los botones con
  contenido llegaron en 2.1.295). El campo de varias líneas necesita 2.1.301; antes, el
  editor externo lo sustituye. Desarrollado con 2.1.310 y comprobado con 2.1.296 (ver
  *Desarrollo*). `plugin.json` no tiene un campo para la versión mínima, así que solo se
  indica aquí.
- **La CLI de Backlog.md** en el equipo, con salida JSON (`schemaVersion` 1). Probado con
  1.55.3.

  ```bash
  npm i -g backlog.md
  ```

  `bun add -g backlog.md` y `brew install backlog-md` también sirven.
- Un proyecto inicializado con `backlog init`. El panel usa la carpeta de trabajo de la
  sesión.

## Instalación

En el prompt de una sesión de Claude Code en la terminal:

```text
/plugin install backlog-pane --marketplace ezmg/backlog-pane
```

Responde `y` para añadir el marketplace y elige un ámbito (el de usuario es el
predeterminado).

Desde una shell:

```bash
claude plugin install backlog-pane --marketplace ezmg/backlog-pane
```

**Claude Desktop (pestaña Code).** Ahí `/plugin` no funciona. Haz clic en **+** junto al
cuadro del prompt, luego **Plugins**, **Add marketplace** con `ezmg/backlog-pane` y después
**Add plugin**. Un mod que instalas desde la terminal en el ámbito de usuario también se
carga en las sesiones locales de la app de escritorio.

## Uso

1. Abre una sesión en una carpeta que tenga un proyecto de Backlog.md.
2. Ejecuta `/backlog`.
3. Arrastra tarjetas entre columnas, o haz clic dos veces en una tarjeta para abrirla. En
   VS Code y en el móvil, toca una tarea de la lista.
4. En una tarea, cambia el estado, el título, la prioridad, los criterios, la descripción o
   el plan. O pulsa **Trabajar en esta tarea** o **Editar con Claude**, y revisa el
   borrador antes de pulsar Enter.

Para cerrar el panel, haz clic en su marca de cierre o pulsa `ctrl+x` y luego `x`. Al
cerrarlo se detiene el proceso `--watch`.

### Opciones

| Opción | Predeterminado | Qué hace |
| --- | --- | --- |
| `backlogPath` | *(vacío)* | Ruta completa al ejecutable `backlog`. Si está vacía, el mod prueba `backlog` en el PATH. En Windows, después prueba los binarios nativos que npm y bun instalan de forma global. |
| `doneLimit` | `5` | Cuántas de las tareas más recientes del estado final (y de cada estado cerrado) muestra el tablero, y la lista cuando ese grupo está desplegado. |
| `closedStatuses` | *(vacío)* | Opcional. Estados que empiezan como cerrados en un proyecto en el que nunca has marcado una casilla **Cerrado** en **Estados…**, separados por comas (por ejemplo `Cancelled`). En cuanto marcas o desmarcas una, el proyecto guarda su propia lista. |
| `language` | `auto` | `en` (inglés), `es` (español) o `auto`. Con `auto`, el mod usa lo primero de esta lista que esté definido: el ajuste `language` de Claude Code (texto libre como `Español`, `Spanish` o `English`), luego `LC_ALL`, `LC_MESSAGES`, `LANG` y por último el idioma del sistema. Si no hay ninguno, usa inglés. Cualquier idioma que no sea español se muestra en inglés. |

Se cambian en los ajustes del plugin, en `/plugin`. En una sesión que carga el mod desde una
carpeta, aparecen como filas en `/config` y se guardan en tus ajustes de usuario
(`~/.claude/settings.json`, en `pluginConfigs`), no en los del proyecto.

## Dónde funciona

| Dónde | Qué obtienes |
| --- | --- |
| Terminal (`claude`) | Todo, con el tablero de arrastrar y soltar. A pantalla completa, el panel se acopla junto a la conversación a partir de 110 columnas; si no, se abre encima del prompt. |
| Claude Desktop, pestaña Code | Todo, con el tablero de arrastrar y soltar. |
| VS Code, extensión de Claude Code | Todo menos el tablero: las tareas son una lista agrupada por estado. No probado a mano. |
| Móvil (Remote Control) | Ver tareas; moverlas con ◀/▶ o con un botón por estado; cambiar la prioridad con botones; marcar y eliminar criterios; los dos borradores. El móvil no tiene campos de texto, así que ahí no puedes crear tareas, editar títulos, añadir o editar criterios ni editar textos largos. |
| `claude -p`, Agent SDK, sin superficie | `/backlog` responde con el tablero en texto. |

Si el tablero no consigue dibujarse en una superficie, el panel muestra la lista en su lugar
hasta que el mod se recarga.

**No es para GitHub Copilot.** backlog-pane es un mod de Claude Code: solo funciona dentro
de Claude Code, con la API que Claude Code da a los mods (el panel lateral, `/backlog`, el
cuadro del prompt). GitHub Copilot no tiene esa API, así que ahí el mod no hace nada. La
fila de VS Code de arriba se refiere a la extensión de Claude Code para VS Code. Puede
convivir con Copilot en el mismo VS Code, y el panel solo aparece en las sesiones de Claude
Code. Para llegar a tus tareas desde Copilot, usa el servidor MCP que trae el propio
Backlog.md. Eso es independiente de este mod y no tiene panel.

### macOS

El mod no tiene código específico para macOS. Funciona en la terminal (`claude`) y en la
app de escritorio. Todavía no se ha probado a mano en un Mac: los tests se ejecutan en
Linux. Tres cosas a tener en cuenta:

- **Encontrar `backlog`.** En una terminal, el `backlog` de `brew install backlog-md` o de
  `npm i -g backlog.md` está en el PATH. Claude Desktop abierto desde el Dock puede no tener
  `/opt/homebrew/bin` (ni la carpeta global de npm) en su PATH, y entonces el panel dice que
  no encuentra la CLI. Pon en `backlogPath` lo que devuelva `which backlog`.
- **Un editor, antes de 2.1.301.** Antes de Claude Code 2.1.301, la descripción y el plan
  se abren en tu editor (ver [Editar textos largos](#editar-textos-largos)). macOS no tiene
  un editor por defecto al que el mod pueda recurrir, así que configura uno, una sola vez:

  ```bash
  backlog config set defaultEditor "code --wait"
  ```

  También sirven `VISUAL` o `EDITOR`. Desde 2.1.301, el texto se edita en el panel y no
  hace falta editor.
- **Arrastrar en una terminal** necesita Claude Code a pantalla completa y una terminal que
  envíe los eventos del ratón (Terminal.app, iTerm2, Ghostty, kitty, WezTerm). La app de
  escritorio no necesita nada. Si arrastrar no funciona, haz clic en el tablero y usa las
  flechas.

## Cómo funciona

| Acción | Comando que ejecuta |
| --- | --- |
| Lista en vivo | `backlog task list --json --watch` (un proceso por panel, que se detiene al cerrarlo) |
| Orden de los estados | `backlog config get statuses` |
| Prioridades | `backlog config get priorities` |
| Detalles de la tarea | `backlog task view <id> --json` |
| Cambiar el estado (selector, ◀ ▶, tablero) | `backlog task edit <id> --status <estado>` |
| Crear / eliminar un estado | Reescribe la línea `statuses:` de la configuración de Backlog.md y lo comprueba con `backlog config get statuses` (la única escritura fuera de la CLI) |
| Estado en el que empiezan las tareas nuevas | `backlog config get defaultStatus` |
| Crear una tarea | `backlog task create <título>` |
| Renombrar | `backlog task edit <id> -t <título>` |
| Cambiar la prioridad | `backlog task edit <id> --priority <prioridad>` |
| Marcar / desmarcar un criterio | `backlog task edit <id> --check-ac <n>` / `--uncheck-ac <n>` |
| Añadir un criterio | `backlog task edit <id> --ac <texto>` |
| Eliminar un criterio | `backlog task edit <id> --remove-ac <n>` |
| Editar un criterio | `backlog task edit <id> --acceptance-criteria <1.º> --acceptance-criteria <2.º> …` (la lista entera, en orden), y después `--check-ac <n>` si estaba marcado |
| Descripción / plan | `backlog task edit <id> -d <texto>` / `--plan <texto>` |
| Editor | `backlog config get defaultEditor`, y luego el editor con un archivo temporal |

Los comandos de edición se comprobaron con Backlog.md 1.55.3. Al reescribir la lista de
criterios se conservan las marcas de los criterios cuyo texto no ha cambiado.

Los comandos se lanzan sin shell, con cada valor como un argumento propio, así que los
textos con comillas, `&`, `$` o saltos de línea son seguros. La salida de `--watch` es una
serie de documentos JSON con formato. El mod los recompone se corte como se corte la
salida. Si el proceso termina, se reinicia con esperas crecientes (1 s, 2 s, 4 s, 8 s).
Tras 5 fallos seguidos, el panel muestra el error y un botón **Reintentar**.

## Limitaciones conocidas

- **No se puede quitar una prioridad.** `backlog task edit` pone una prioridad pero no
  tiene forma de quitarla, así que **Ninguna** solo aparece mientras la tarea no tiene
  prioridad.
- **El editor externo tiene que bloquear** hasta que cierres el archivo (`code --wait`, no
  `code`). Los editores que vuelven enseguida dejan el texto sin cambios. En Windows, un
  lanzador `.cmd` (como el `code` de VS Code) no se puede iniciar sin shell. Indica la ruta
  completa al `.exe`, por ejemplo
  `backlog config set defaultEditor "\"C:\Program Files\Microsoft VS Code\Code.exe\" --wait"`.
- El panel espera al editor externo hasta diez minutos, y el archivo temporal se queda en
  la carpeta temporal después.
- Los títulos del tablero ocupan dos líneas como máximo, así que los largos se cortan. Con
  muchos estados en un panel estrecho, las columnas se estrechan (12 celdas como mínimo).
- **Estados:** el panel escribe la lista en la forma que usa `backlog init`
  (`statuses: ["To Do", "Done"]`). Una lista escrita con un elemento por línea pasa a esa
  única línea, y un comentario en esas líneas se pierde. Los recuentos no incluyen
  borradores ni tareas archivadas, así que se puede eliminar un estado que use una tarea
  archivada. El panel no reordena ni renombra estados existentes: para eso, edita la
  configuración.
- **Todavía no:** aprobación del plan, sincronización automática cuando Claude termina,
  hitos y la definición de terminado. No se muestran subtareas, dependencias, etiquetas ni
  responsables.
- La lista en vivo cubre lo que devuelve `task list`, así que no se muestran los borradores
  ni las tareas archivadas.
- Los estados y las prioridades se leen cuando empieza la vigilancia. Si los cambias en la
  configuración, pulsa **Reintentar** o vuelve a abrir el panel.
- El estado final cuenta como "terminado" porque es el último en `statuses`, la misma regla
  que usa Backlog.md.
- En la pantalla principal de la terminal (sin pantalla completa), el panel se abre encima
  del prompt en vez de acoplarse al lado.
- Los modos móvil y sin interfaz son mínimos a propósito (ver *Dónde funciona*).
- La API de mods está en acceso anticipado y puede cambiar entre versiones de Claude Code.
- **Windows:** si no se puede iniciar ni `backlog` del PATH ni una instalación global de
  npm/bun, pon en `backlogPath` la ruta completa de `backlog.exe`.

## Desarrollo

```text
.claude-plugin/plugin.json        manifiesto y opciones
.claude-plugin/marketplace.json   hace que este repositorio se pueda instalar
.claude-plugin/icon.png           el icono del plugin
hooks/register.tsx                comando, panel, bucle de vigilancia y acciones
hooks/board.tsx                   el módulo de superficie Client del tablero (terminal, escritorio)
hooks/cli.ts                      funciones puras: comandos, lector del flujo JSON, agrupación, colores, editor
hooks/i18n.ts                     textos en inglés y español, detección del idioma
types/index.d.ts                  el contrato de $.state, las props del tablero, las formas de Backlog.md
tests/                            suites de claude plugin test (fixtures.ts es el mundo simulado, con una configuración falsa)
```

Ejecuta el mod desde una copia de trabajo para una sesión:

```bash
git clone https://github.com/ezmg/backlog-pane.git
```

```bash
claude --plugin-dir ./backlog-pane
```

Compruébalo:

```bash
claude plugin validate --strict .
```

```bash
claude plugin test .
```

```bash
tsc -p .
```

`tsc` necesita los tipos de la API que el motor escribe en `.claude-plugin/types/` cuando
carga el mod desde una carpeta (por ejemplo con `--plugin-dir`).

Para comprobar una versión anterior de Claude Code sin instalarla de forma global,
instálala en una carpeta temporal y ejecuta su `claude` desde ahí:

```bash
npm i --prefix /tmp/cc296 @anthropic-ai/claude-code@2.1.296
```

```bash
/tmp/cc296/node_modules/.bin/claude plugin test .
```

Los tests se ejecutan con el kit de pruebas de Claude Code, con una CLI `backlog` simulada.
Cubren:

- el lector del flujo, la agrupación, los colores y cada línea de comando;
- la detección del idioma y los dos idiomas;
- la disposición, el puntero y las teclas del tablero, y la lista de respaldo;
- los estados cerrados, y crear y eliminar estados (con la reescritura de la configuración y su comprobación);
- el color de cada estado y su casilla **Cerrado**, guardados por proyecto, y las tarjetas con el color de su estado;
- cada control de edición, el campo de varias líneas y el editor externo;
- los dos borradores;
- los estados de CLI ausente, proyecto sin inicializar, vigilancia que falla y sin
  interfaz.

Se ejecutan en las superficies terminal, escritorio, VS Code y móvil donde aplica cada una,
y dan el mismo resultado sea cual sea el idioma del equipo. Con 2.1.296, los seis tests que
simulan 2.1.301 o posterior (el campo de varias líneas) fallan, como es de esperar: ese kit
no dibuja `rows`.

## Licencia

[MIT](LICENSE)
