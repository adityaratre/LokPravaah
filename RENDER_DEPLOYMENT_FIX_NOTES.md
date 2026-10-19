# Render deployment patch notes

- Added a runtime entrypoint that retains the existing Cloudflare/local startup but automatically selects Render startup on Render.
- Added a Render public ingress that binds to `0.0.0.0:$PORT` and routes public requests to internal loopback services.
- Removed the mandatory Cloudflare-domain check from the Render path; the Render external URL is the default base URL.
- Kept the control center and upstream apps private, and stripped spoofable internal-token headers at the public ingress.
- Optional Gmail/SMS observers no longer start on Render unless their enable flags are set.
- Updated Node requirement to 22.13+ because this project uses built-in `node:sqlite`.
- Added Render environment, health-check, and storage instructions.

**Important:** this prepares the existing gateway for deployment on Render, but does not make the system a regulated payment processor nor verify real UPI payments. Configure the receiving VPA, stable secrets, signed webhook, and persistent storage; test the end-to-end payment flow before accepting real donations.
