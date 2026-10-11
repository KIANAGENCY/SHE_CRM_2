# Hotel Expert CRM con Sara IA

La aplicación implementa el diseño de Figma y puede funcionar localmente como demostración o como CRM multiusuario conectado a Supabase.

## Requisitos incorporados

- Venta directa con Sara como ruta preferente. La muestra y la llamada son opcionales.
- Muestras vinculadas a la oportunidad, con seguimiento y resultado. Se puede continuar la compra sin esperar la prueba.
- Dashboard de pedidos, facturación registrada, nuevos clientes, prospectos y recompra.
- Expediente: nombre comercial, razón social, RFC, envío, contacto, celular, correo, puesto y preferencias.
- Catálogo de productos y registro explícito de aromas aprobados, con compatibilidad por producto.
- Cotizaciones con cantidades, aromas, condiciones, vigencia, descuento limitado por dirección y aceptación documentada.
- Pedido confirmado, autorización administrativa, producción, empaque, guía y entrega.
- Citas sin solapamientos por vendedor, tareas de recompra y reportes semanales/mensuales.
- Registro de avisos operativos e historial de acciones.
- Navegación responsive, búsqueda global, estados vacíos y errores visibles.
- Acceso por correo y contraseña, espacio de trabajo aislado y perfiles de Dirección, Administración, Ventas y Producción.

## Fuente y decisiones

Fuente primaria: documento del cliente «para CRM interno.docx», recuperado de la conversación «Subir CRM a GitHub». Se aplicó la aclaración posterior del usuario: Sara busca cerrar directamente, con muestra opcional.

El documento no proporciona catálogo de aromas, fichas técnicas, precios reales, cobertura, política de descuentos, horarios laborales ni definición completa de estados. Los productos y precios de demostración conservan las referencias que ya tenía Figma. Los aromas empiezan vacíos y el descuento permitido en cero hasta registrar una política. Los estados operativos conservan la autorización administrativa del diseño existente. Eli aparece en Figma como una vendedora humana; ese nombre se conserva. La IA se identifica como Sara IA.

## Alcance técnico

Frontend de React y TypeScript compilado con Vite. `src/domain.ts` separa las reglas del renderizado, `src/cloud.ts` integra Supabase Auth y Postgres, `src/data.ts` contiene datos ficticios para el arranque y `src/styles.css` reproduce la paleta y los componentes de Figma. Las rutas API y el middleware local también están escritos en TypeScript para Node.js.

Con Supabase configurado, las políticas RLS aíslan cada espacio de trabajo y validan el perfil en el servidor. Producción solo puede cambiar un pedido de «En producción» a «Empacado»; los demás flujos se limitan a Dirección, Administración y Ventas según su responsabilidad. Sin variables de Supabase, el selector de perfil conserva el modo de demostración local.

Sara utiliza respuestas deterministas de demostración. No hay modelo de IA conectado. No hay envío de WhatsApp, Instagram, Facebook, correo, cobro, facturación fiscal, lectura bancaria, inventario real ni calendario externo. Los avisos permanecen como «Pendiente de integración».

## Para activar operación real

1. Importar productos, aromas, fichas técnicas, precios, impuestos, cobertura y límites aprobados.
2. Conectar canales y agenda con credenciales del titular; añadir consentimiento y políticas de comunicación.
3. Implementar Sara sobre herramientas de negocio autorizadas, con confirmación del cliente, transferencia humana y auditoría.
4. Añadir funciones transaccionales para inventario, reservas e idempotencia de avisos.
5. Integrar producción, facturación y seguimiento logístico; verificar consistencia y permisos con datos de prueba.

## Correspondencia de pantallas

El archivo `docs/figma-snapshot.json` registra textos y nodos del diseño actualizado. `docs/figma-map.json` vincula cada pantalla con la ruta de la aplicación. Los detalles de cliente, oportunidad, pedido y muestra se abren en vistas o diálogos para reducir pasos. Las pantallas que dependen de servicios externos muestran su estado pendiente.
