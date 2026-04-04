import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { finished } from 'stream/promises';
import { getCodeExecutionConfig } from '@/lib/config';

const IMAGE_CHECK_TTL_MS = 60 * 60 * 1000; // 1 hour

type SandboxRuntimeState = {
  activeContainers: Set<Docker.Container>;
  imagePulls: Map<string, Promise<void>>;
  lastImageCheck: Map<string, number>;
  shutdownHandlersRegistered: boolean;
};

const globalSandbox = globalThis as typeof globalThis & {
  __codeExecutionDockerState?: SandboxRuntimeState;
};

const sandboxState =
  globalSandbox.__codeExecutionDockerState ??
  (globalSandbox.__codeExecutionDockerState = {
    activeContainers: new Set<Docker.Container>(),
    imagePulls: new Map<string, Promise<void>>(),
    lastImageCheck: new Map<string, number>(),
    shutdownHandlersRegistered: false,
  });

function createDockerClient(): Docker {
  const { dockerHost } = getCodeExecutionConfig();

  if (dockerHost.startsWith('unix://')) {
    return new Docker({ socketPath: dockerHost.replace('unix://', '') });
  }

  const url = new URL(dockerHost);
  return new Docker({
    protocol: url.protocol.replace(':', '') as 'https' | 'http',
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
  });
}

export type ExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  oomKilled: boolean;
  error?: string;
};

export async function checkDockerAvailable(): Promise<boolean> {
  try {
    const docker = createDockerClient();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

async function pullImage(docker: Docker, imageName: string): Promise<void> {
  const pullPromise = (async () => {
    const stream = await docker.pull(imageName);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    sandboxState.lastImageCheck.set(imageName, Date.now());
  })();

  sandboxState.imagePulls.set(imageName, pullPromise);
  try {
    await pullPromise;
  } finally {
    sandboxState.imagePulls.delete(imageName);
  }
}

export async function ensureImage(imageName: string): Promise<void> {
  const docker = createDockerClient();

  const inFlight = sandboxState.imagePulls.get(imageName);
  if (inFlight) {
    await inFlight;
    return;
  }

  const lastCheck = sandboxState.lastImageCheck.get(imageName) ?? 0;
  const isStale = Date.now() - lastCheck > IMAGE_CHECK_TTL_MS;

  try {
    await docker.getImage(imageName).inspect();

    if (isStale) {
      pullImage(docker, imageName).catch(() => {});
    }
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    await pullImage(docker, imageName);
  }
}

export async function executeCode(code: string): Promise<ExecutionResult> {
  const config = getCodeExecutionConfig();
  const docker = createDockerClient();
  const memoryBytes = config.memoryMb * 1024 * 1024;

  const container = await docker.createContainer({
    Image: config.dockerImage,
    Cmd: ['node', '-e', code],
    User: '1000:1000',
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: false,
    NetworkDisabled: true,
    StopTimeout: config.timeoutSeconds * 3,
    Env: [
      `NODE_OPTIONS=--max-old-space-size=${Math.floor(config.memoryMb * 0.75)}`,
    ],
    HostConfig: {
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      NetworkMode: 'none',
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: 500_000_000,
      PidsLimit: 32,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m,mode=1777' },
      Ulimits: [{ Name: 'nofile', Soft: 64, Hard: 64 }],
    },
  });

  sandboxState.activeContainers.add(container);

  try {
    const attachStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    const maxChars = config.maxOutputChars;

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stdoutLen < maxChars) {
        const sliced = text.slice(0, maxChars - stdoutLen);
        stdoutChunks.push(sliced);
        stdoutLen += sliced.length;
      }
    });

    stderrStream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stderrLen < maxChars) {
        const sliced = text.slice(0, maxChars - stderrLen);
        stderrChunks.push(sliced);
        stderrLen += sliced.length;
      }
    });

    docker.modem.demuxStream(attachStream, stdoutStream, stderrStream);

    await container.start();

    let timedOut = false;
    const timeoutMs = config.timeoutSeconds * 1000;
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<{ StatusCode: number }>((resolve) => {
      timeoutHandle = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill({ signal: 'SIGKILL' });
        } catch {}
        resolve({ StatusCode: 137 });
      }, timeoutMs);
    });

    const result = await Promise.race([container.wait(), timeoutPromise]);
    clearTimeout(timeoutHandle!);
    const exitCode = result.StatusCode;

    let oomKilled = false;
    try {
      const info = await container.inspect();
      oomKilled = info.State?.OOMKilled ?? false;
    } catch {}

    try {
      await finished(attachStream);
    } catch {}

    const stdout = stdoutChunks.join('');
    const stderr = stderrChunks.join('');
    const truncatedNote = (len: number) =>
      len >= maxChars ? `\n[...truncated at ${maxChars} characters]` : '';

    return {
      stdout: stdout + truncatedNote(stdoutLen),
      stderr: stderr + truncatedNote(stderrLen),
      exitCode: timedOut ? 137 : exitCode,
      timedOut,
      oomKilled,
    };
  } finally {
    sandboxState.activeContainers.delete(container);
    try {
      await container.remove({ force: true });
    } catch {}
  }
}

export function cleanupContainers(): void {
  for (const container of sandboxState.activeContainers) {
    try {
      container.kill({ signal: 'SIGKILL' }).catch(() => {});
    } catch {}
    try {
      container.remove({ force: true }).catch(() => {});
    } catch {}
  }
  sandboxState.activeContainers.clear();
}

if (
  typeof process !== 'undefined' &&
  !sandboxState.shutdownHandlersRegistered
) {
  const shutdown = () => {
    cleanupContainers();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  sandboxState.shutdownHandlersRegistered = true;
}
