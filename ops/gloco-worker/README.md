# Finance GLOCO worker runtime

This is an isolated Playwright runtime for the Finance Portal. The worker has no published ports. A temporary login browser is published only on host loopback port 6080 and uses the same isolated Docker bridge with container-to-container communication disabled. Both containers are limited to 1 CPU and 1.5 GiB RAM each.

The worker installs the matching Playwright package into its private state volume and then stays idle. The temporary login browser opens a blank page in a persistent profile so the owner can sign in directly; no password is collected by this app. Do not enable a scheduled job until the GLOCO login flow and a protected Finance import receiver are ready. The worker must upload aggregate-only results and must not retain patient-level identifiers or exported workbooks.

`state/` contains the Playwright runtime and, after sign-in, the GLOCO browser profile. Treat the profile as a password-equivalent credential and keep it owner-only. Never commit session files or `.env` files. The directory is owned by the container's unprivileged UID 1001.

To sign in, open an SSH tunnel from the owner's computer with `ssh -N -L 6080:127.0.0.1:6080 root@<VPS_HOST>`, then visit `http://localhost:6080/vnc.html?autoconnect=true&resize=remote` and navigate to the GLOCO login page. Do not enter credentials in chat. Stop the temporary login container after sign-in; the profile remains in `state/gloco-profile` for the worker.

The image and npm package versions are pinned so the browser binaries remain compatible with Playwright.
