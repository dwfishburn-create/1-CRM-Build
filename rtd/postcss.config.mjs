// The RTD uses plain CSS (app/globals.css), no Tailwind. This file exists so
// the build never picks up the CRM's postcss.config.mjs from the repo root,
// which needs @tailwindcss/postcss — a package the RTD does not install.
const config = { plugins: {} };

export default config;
