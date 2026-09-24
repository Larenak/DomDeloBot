import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cloudflaredPath =
  process.env.CLOUDFLARED_BIN ||
  path.join(projectRoot, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
const children = [];
let shuttingDown = false;

function print(message) {
  process.stdout.write(`${message}\n`);
}

function loadProjectEnvironment() {
  const envPath = path.join(projectRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function requireLocalPrerequisites() {
  if (!process.env.MAX_BOT_TOKEN) {
    throw new Error('Добавьте MAX_BOT_TOKEN в .env или в переменные текущего терминала.');
  }
  if (!existsSync(path.join(projectRoot, 'node_modules'))) {
    throw new Error('Зависимости не установлены. Сначала выполните pnpm install --frozen-lockfile.');
  }
  if (!existsSync(cloudflaredPath)) {
    throw new Error(
      `Не найден cloudflared: ${cloudflaredPath}. Укажите путь через CLOUDFLARED_BIN.`,
    );
  }
}

function ensurePortIsFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Порт ${port} уже занят. Остановите ранее запущенный ДомДело и повторите.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function startChild(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: options.env || process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  child.once('error', (error) => {
    if (!shuttingDown) print(`[${label}] ${error.message}`);
  });
  children.push({ label, child });
  return child;
}

function startPnpm(label, args, options = {}) {
  if (process.platform === 'win32') {
    return startChild(
      label,
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', ['pnpm', ...args].join(' ')],
      options,
    );
  }
  return startChild(label, 'pnpm', args, options);
}

function runPnpm(args) {
  return new Promise((resolve, reject) => {
    const child = startPnpm('сборка', args);
    child.once('exit', (code) => {
      const index = children.findIndex((item) => item.child === child);
      if (index >= 0) children.splice(index, 1);
      if (code === 0) resolve();
      else reject(new Error(`Подготовка проекта завершилась с кодом ${code ?? 'unknown'}.`));
    });
  });
}

async function waitForHttp(url, label, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`${label} завершился до готовности (код ${child.exitCode ?? 'unknown'}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Сервис ещё запускается.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} не стал доступен за ${Math.round(timeoutMs / 1000)} секунд.`);
}

function startQuickTunnel() {
  const child = startChild(
    'туннель',
    cloudflaredPath,
    ['tunnel', '--url', 'http://127.0.0.1:5173', '--no-autoupdate'],
    { capture: true },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) reject(new Error('Cloudflare Tunnel не выдал HTTPS-адрес за 45 секунд.'));
    }, 45_000);
    const consume = (line) => {
      process.stdout.write(`[туннель] ${line}\n`);
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ child, url: match[0] });
      }
    };
    readline.createInterface({ input: child.stdout }).on('line', consume);
    readline.createInterface({ input: child.stderr }).on('line', consume);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (!settled) reject(new Error(`Cloudflare Tunnel завершился с кодом ${code ?? 'unknown'}.`));
    });
  });
}

function ensurePinggyKey() {
  const temporaryDirectory = path.join(projectRoot, 'tmp');
  const keyPath = path.join(temporaryDirectory, 'pinggy-dev-key');
  mkdirSync(temporaryDirectory, { recursive: true });
  if (existsSync(keyPath)) return keyPath;
  const result = spawnSync(
    'ssh-keygen',
    ['-q', '-t', 'ed25519', '-f', keyPath, '-N', ''],
    { cwd: projectRoot, stdio: 'pipe', windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error('Не удалось создать временный SSH-ключ для HTTPS-туннеля.');
  }
  return keyPath;
}

function startPinggyTunnel() {
  const keyPath = ensurePinggyKey();
  const knownHostsPath = path.join(projectRoot, 'tmp', 'pinggy-known-hosts');
  const child = startChild(
    'туннель',
    'ssh',
    [
      '-p',
      '443',
      '-tt',
      '-i',
      keyPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R0:127.0.0.1:5173',
      'qr@free.pinggy.io',
      'x:https',
    ],
    { capture: true },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopChild(child);
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error('Pinggy не выдал HTTPS-адрес за 30 секунд.')),
      30_000,
    );
    const consume = (line) => {
      process.stdout.write(`[туннель] ${line}\n`);
      const match = line.match(
        /https:\/\/[a-z0-9-]+\.(?:run\.pinggy-free\.link|free\.pinggy\.net|a\.pinggy\.link)/iu,
      );
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ child, url: match[0] });
      }
    };
    readline.createInterface({ input: child.stdout }).on('line', consume);
    readline.createInterface({ input: child.stderr }).on('line', consume);
    child.once('error', (error) => fail(error));
    child.once('exit', (code) => {
      if (!settled) fail(new Error(`Pinggy завершился с кодом ${code ?? 'unknown'}.`));
    });
  });
}

function startLocalhostRunTunnel() {
  const knownHostsPath = path.join(projectRoot, 'tmp', 'localhost-run-known-hosts');
  const child = startChild(
    'туннель',
    'ssh',
    [
      '-T',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${knownHostsPath}`,
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      '80:127.0.0.1:5173',
      'nokey@localhost.run',
    ],
    { capture: true },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopChild(child);
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error('localhost.run не выдал HTTPS-адрес за 30 секунд.')),
      30_000,
    );
    const consume = (line) => {
      const match = line.match(/https:\/\/[a-z0-9-]+\.lhr\.life/iu);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        print(`[туннель] localhost.run: ${match[0]}`);
        resolve({ child, url: match[0] });
      }
    };
    readline.createInterface({ input: child.stdout }).on('line', consume);
    readline.createInterface({ input: child.stderr }).on('line', consume);
    child.once('error', (error) => fail(error));
    child.once('exit', (code) => {
      if (!settled) fail(new Error(`localhost.run завершился с кодом ${code ?? 'unknown'}.`));
    });
  });
}

async function startDevelopmentTunnel() {
  try {
    print('Открываю временный HTTPS-туннель через localhost.run…');
    return await startLocalhostRunTunnel();
  } catch (localhostRunError) {
    print(`localhost.run недоступен (${localhostRunError.message}). Пробую Pinggy…`);
    try {
      return await startPinggyTunnel();
    } catch (pinggyError) {
      print(
        `Pinggy недоступен (${pinggyError.message}). Пробую Cloudflare Tunnel…`,
      );
      return startQuickTunnel();
    }
  }
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of [...children].reverse()) stopChild(child);
  process.exit(exitCode);
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

async function main() {
  loadProjectEnvironment();
  requireLocalPrerequisites();
  await Promise.all([ensurePortIsFree(3000), ensurePortIsFree(5173)]);

  print('Подготавливаю локальное мини-приложение…');
  await runPnpm(['build:packages']);

  const web = startPnpm('web', ['--filter', '@domdelo/web', 'dev']);
  await waitForHttp('http://127.0.0.1:5173', 'Веб-приложение', web);

  const tunnel = await startDevelopmentTunnel();
  const serverEnvironment = {
    ...process.env,
    NODE_ENV: 'development',
    STORAGE_MODE: 'memory',
    DEMO_MODE: 'true',
    MAX_DELIVERY_MODE: 'polling',
    PUBLIC_BASE_URL: tunnel.url,
    MAX_MINI_APP_URL: tunnel.url,
    SESSION_SECRET:
      process.env.SESSION_SECRET || 'local-development-session-secret-change-before-production',
    NODE_EXTRA_CA_CERTS: path.join(
      projectRoot,
      'infra',
      'certs',
      'russian_trusted_root_ca.cer',
    ),
  };
  const server = startPnpm(
    'server',
    ['--filter', '@domdelo/server', 'dev'],
    { env: serverEnvironment },
  );
  await waitForHttp('http://127.0.0.1:3000/health/ready', 'API', server);
  await waitForHttp(tunnel.url, 'Публичное мини-приложение', tunnel.child, 60_000);
  await waitForHttp(`${tunnel.url}/health/ready`, 'Публичный HTTPS-адрес', tunnel.child, 60_000);

  print('');
  print('ДомДело готово к запуску из MAX.');
  print(`Mini App: ${tunnel.url}`);
  print('Откройте чат с ботом и отправьте /start, затем нажмите «Открыть ДомДело».');
  print('Адрес временный и изменится при следующем запуске. Для остановки нажмите Ctrl+C.');

  await new Promise((_, reject) => {
    for (const { label, child } of children) {
      child.once('exit', (code) => {
        if (!shuttingDown) reject(new Error(`${label} завершился с кодом ${code ?? 'unknown'}.`));
      });
    }
  });
}

main().catch((error) => {
  process.stderr.write(`\nНе удалось запустить ДомДело для MAX: ${error.message}\n`);
  shutdown(1);
});
