// Runtime entrypoint: Render uses a PORT-aware single-ingress router; local/Cloudflare
// deployments keep the existing tunnel/process-supervisor startup.
const onRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
if (onRender) {
  await import('./start-render.js');
} else {
  await import('./start-cloudflare.js');
}
