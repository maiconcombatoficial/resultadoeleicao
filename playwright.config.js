// Testes de fumaça do app: abrem o site num Chromium de celular e conferem as telas principais.
// Os dados do TSE vêm de tests/fixtures/tse (gravados com `npm run test:gravar`), para o teste não
// depender da internet nem mudar de resultado.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  webServer: { command: 'python3 -m http.server 8765', url: 'http://localhost:8765/index.html', reuseExistingServer: true },
  use: {
    baseURL: 'http://localhost:8765/',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    acceptDownloads: true,
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
})
