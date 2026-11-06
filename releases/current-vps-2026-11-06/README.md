# CRM publicado en el VPS · 6 nov 2026

Esta carpeta conserva el frontend compilado que estaba publicado en `crm.hotelexpert.mx` el 6 de noviembre de 2026.

## Contenido

- `dist/`: HTML y recursos estáticos compilados que sirven la interfaz actual.
- SHA-256 de `dist/index.html`: `2e4d0454b268bc7637a9bc93c73c75d6ea861b9dcfb87556d5d34d45601cddfe`.
- El inicio ahora muestra el formulario de acceso existente mientras se consulta la sesión; conserva el diseño y los textos actuales del login.
- Publicado en el VPS con la etiqueta `bootform-20261106-r1`. El despliegue conserva una etiqueta de imagen Nginx para reversión.

## Nota sobre el código fuente

El VPS conserva esta distribución compilada, pero no los componentes fuente que la generaron. Por eso este respaldo permite recuperar y comparar la interfaz publicada, pero no sustituye el proyecto fuente ni se puede usar como entrada de una compilación. El código fuente editable debe sincronizarse por separado cuando se localice su repositorio.
