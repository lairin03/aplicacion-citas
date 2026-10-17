# Agenda Clara

Agenda y reservas en línea para profesionales que trabajan por citas, incluidos negocios de belleza, lashistas, consultorios y profesionales independientes. Interfaz y validaciones en español, Next.js App Router, TypeScript, Tailwind y Supabase.

## Requisitos

- Node.js 20.9 o superior.
- Proyecto Supabase con Auth por correo y contraseña.
- Aplicar, en orden, las migraciones `0001` a `0013` de `supabase/migrations/` desde el SQL Editor de Supabase.

## Ejecutar localmente

```powershell
npm install
Copy-Item .env.example .env.local
```

Completa `.env.local` con las claves del proyecto Supabase. `SUPABASE_SERVICE_ROLE_KEY` y `APP_RATE_LIMIT_HASH_SECRET` son secretos de servidor: no los prefijes con `NEXT_PUBLIC_` ni los incluyas en el navegador.

Para cobrar los planes, configura `APP_URL`, `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET` y `WOMPI_EVENTS_SECRET` con las credenciales del mismo ambiente de Wompi (pruebas o producción). Nunca expongas los secretos de integridad, eventos o service role en el navegador. Configura en el Dashboard de Wompi la URL de eventos `https://<tu-dominio>/api/webhooks/wompi`.

Los pagos de Básico y Profesional son mensuales y manuales: el cliente vuelve a `/planes` para renovar. El plan solo se activa después de validar la firma del evento `transaction.updated` y el monto en COP; el regreso del checkout por sí solo no confirma un pago. Wompi no ofrece en su documentación colombiana un programador mensual de suscripciones, así que esta versión no hace cobros automáticos ni guarda tarjetas.

### Aprobación de citas y notificaciones

Cada profesional tiene su propio correo, que se registra al crear el negocio o la sede y se puede editar en Configuración → Profesionales. Las solicitudes se envían a ese correo; las cuentas existentes deben completar el campo antes de aparecer como disponibles para nuevas reservas. Para enviar el correo, configura en las variables del servidor `RESEND_API_KEY` con una llave de Resend, `NOTIFICATION_FROM_EMAIL` con el remitente central verificado en Resend (por ejemplo, `Agenda Clara <citas@tu-dominio.com>`) y `APP_URL` con el dominio público HTTPS de la aplicación. `NOTIFICATION_FROM_EMAIL` es el remitente de Agenda Clara; el correo de cada profesional es el destinatario. El enlace de decisión vence en 24 horas, es de un solo uso y abre una página que pide confirmar la acción para evitar que los escáneres de enlaces de correo acepten una cita por accidente.

Cuando el profesional acepta, Agenda Clara envía la confirmación desde el número central usando WhatsApp Cloud API. Configura `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_CONFIRMATION_TEMPLATE` y `WHATSAPP_TEMPLATE_LANGUAGE` en las variables del servidor. Meta selecciona el número emisor mediante el `PHONE_NUMBER_ID`; no se envía un parámetro `from_number` aparte. Ese ID corresponde al número central registrado en WhatsApp Manager/Meta Developers. La plantilla aprobada debe tener cuatro variables de cuerpo en este orden: nombre de la cliente, nombre del negocio, fecha y hora, nombre del profesional. Meta debe aprobar la plantilla y el token debe tener permiso para enviar mensajes desde ese número central. En la reserva se solicita consentimiento para este mensaje. Si WhatsApp no está configurado o Meta rechaza el envío, la cita queda confirmada pero la página de respuesta avisa que el mensaje no se envió; el resultado queda registrado para soporte.

```powershell
npm run dev
```

Abre `http://localhost:3000`, crea una cuenta, configura el negocio en el onboarding y comparte `/b/<slug>`.

## Seguridad multi-tenant

- Todas las tablas de negocio incluyen `business_id`; `businesses` es la excepción y asocia `owner_id`.
- Las tablas de negocio aplican RLS y permiten acceso autenticado solo cuando `business_id` pertenece a un negocio cuyo `owner_id` coincide con `auth.uid()`.
- Las páginas y acciones del panel usan la sesión Supabase del usuario. Las páginas públicas consultan desde el servidor con `service_role`; esa clave nunca se expone al cliente.
- La función de reserva pública y el rate limit solo se pueden ejecutar con `service_role`.
- La restricción GiST de exclusión impide solapamientos por profesional incluso si dos reservas compiten al mismo tiempo. Las citas canceladas no bloquean el horario.

## Verificaciones

```powershell
npm run lint
npm run build
```

La prueba de aislamiento crea y elimina filas temporales en el negocio B y comprueba lectura/escritura desde A, acceso del dueño B y rechazo de una cita solapada. Requiere dos usuarios de prueba confirmados en Supabase, cada uno con un negocio creado mediante el onboarding:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL="https://<proyecto>.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
$env:TENANT_TEST_A_EMAIL="<correo-negocio-a>"
$env:TENANT_TEST_A_PASSWORD="<contraseña-a>"
$env:TENANT_TEST_B_EMAIL="<correo-negocio-b>"
$env:TENANT_TEST_B_PASSWORD="<contraseña-b>"
npm run test:tenant
```

Ejecuta la prueba únicamente contra un proyecto de prueba: crea y elimina registros temporales de citas, clientes, profesionales, servicios, bloqueos y rate limiting.

## Rutas MVP

- `/registro`, `/login`, `/onboarding`
- `/panel` (agenda diaria, semanal y mensual)
- El plan Profesional permite crear hasta 2 sedes y administrar hasta 3 profesionales por sede (6 en total). El límite se aplica en la base de datos; un cambio de plan o cupo no elimina sedes ni profesionales existentes.
- `/panel/historial`, `/panel/clientes`, `/panel/clientes/[id]`, `/panel/configuracion`
- `/b/[slug]` (reserva pública sin cuenta)
- `/api/public/availability` y `/api/public/bookings`
- `/appointment-decision` (aceptar o rechazar solicitudes de cita desde el correo)
- `/planes` (planes, pagos manuales Wompi y renovación)
- `/api/webhooks/wompi` (confirmación firmada de transacciones)
- `/panel/caja` y `/panel/reportes` (plan Profesional; pagos por cita, ingresos netos, citas y servicios)
- `/admin` y `/admin/suscripciones` (superadministración restringida a `delaranslairin9@gmail.com`, con correo confirmado)

Para activar el superusuario, registra en Supabase Auth la cuenta `delaranslairin9@gmail.com` y confirma su correo. La aplicación concede acceso administrativo solo a esa identidad autenticada; no se configura ni expone una contraseña desde el código. Desde el panel se consultan las suscripciones y se cambian plan/estado/fechas. Los topes de profesionales y sedes pueden heredarse del plan (campo vacío), personalizarse o quitarse (valor `0`). Desde la lista también se agrega una sede a cuentas Profesional y Empresarial; la acción valida la identidad superadmin y vuelve a comprobar los límites de la suscripción en la base de datos. La migración `0010` amplía los tipos de negocio y crea la función protegida para esa operación.

El superadministrador tiene acceso funcional equivalente al plan Profesional sin vencimiento ni límites de profesionales o sedes. Esta excepción se verifica tanto en el servidor como en la base de datos para el usuario autenticado con ese correo confirmado; no se aplica a otras cuentas ni se controla únicamente por el enlace de navegación.
